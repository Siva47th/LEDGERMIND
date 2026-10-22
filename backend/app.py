import os
import sys
import uuid
import json
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime
from flask import Flask, jsonify, request, Response, g
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

# Ensure the parent directory is in the path for importing modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from ocr.pipeline import extract_text_from_file
from nlp.extractor import extract_fields
from forecasting.engine import get_forecasts
from forecasting.generate_data import generate_historical_cashflow
from case_memory.vector_store import (
    add_case_memory,
    query_similar_cases,
    get_all_cases,
    seed_initial_cases
)
from fusion_engine.rag_engine import generate_advisor_recommendation
from evaluation.fraud_detector import detect_transaction_anomalies
from evaluation.benchmark_suite import run_full_benchmark_suite
from auth import (
    auth_required,
    register_user,
    login_user,
    get_user_profile,
    change_user_password,
    decode_token,
    revoke_token,
    log_audit_event,
    get_recent_audit_logs,
    get_security_health_status,
    sanitize_text
)

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Request payload limit: 16 MB max to protect against Denial-of-Service / Memory Exhaustion attacks
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# Enable CORS for frontend connectivity
CORS(app, expose_headers=["Content-Disposition"], supports_credentials=True)

# Allowed file extensions for OCR upload
ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'bmp'}


def get_client_ip():
    """Extracts the true client IP address, respecting reverse proxies safely."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "127.0.0.1"


def validate_file_signature(file_stream, ext):
    """
    Verifies magic byte headers to prevent disguised executable or malicious file execution.
    """
    pos = file_stream.tell()
    header = file_stream.read(16)
    file_stream.seek(pos)

    if ext == 'pdf':
        return header.startswith(b'%PDF')
    elif ext in ('jpg', 'jpeg'):
        return header.startswith(b'\xff\xd8\xff')
    elif ext == 'png':
        return header.startswith(b'\x89PNG\r\n\x1a\n')
    elif ext == 'webp':
        return len(header) >= 12 and header.startswith(b'RIFF') and header[8:12] == b'WEBP'
    elif ext == 'bmp':
        return header.startswith(b'BM')
    elif ext == 'tiff':
        return header.startswith(b'II*\x00') or header.startswith(b'MM\x00*')
    return False


# =============================================================================
# HTTP SECURITY HEADERS MIDDLEWARE — Defense-in-Depth
# =============================================================================
@app.after_request
def apply_security_headers(response):
    """Injects industry-standard HTTP security headers on all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(self), camera=()'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "img-src 'self' data: blob: https:; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' data: https://fonts.gstatic.com; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "connect-src 'self' http://localhost:* https:; "
        "frame-ancestors 'none';"
    )
    return response


DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), DB_NAME)
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_uploads")

# Create temporary upload folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Read starting balance from .env (single source, not hardcoded in multiple files)
STARTING_BALANCE = float(os.getenv("STARTING_BALANCE", 250000.0))
BALANCE_ALERT_THRESHOLD = 10000.0  # Rs. 10,000.00


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def check_db_health():
    """Checks if the SQLite database is reachable and the transactions table exists."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'")
        table_exists = cursor.fetchone() is not None
        conn.close()
        return "connected" if table_exists else "transactions_table_missing"
    except Exception as e:
        print(f"Database health check failed: {e}")
        return "error"


# =============================================================================
# LIVE BALANCE CALCULATION — Single Source of Truth
# =============================================================================
# Balance is NEVER stored in the database. It is always calculated from:
#   balance = starting_balance + Σ(income) + Σ(return_in) - Σ(expense) - Σ(return_out)
# This eliminates any possibility of sync drift between stored values.
# =============================================================================

def get_current_balance():
    """
    Calculates the current cash balance live from all transactions.
    This is the single source of truth — balance is never stored separately.

    Formula:
        balance = starting_balance + Σ(income) + Σ(return_in) - Σ(expense) - Σ(return_out)
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            COALESCE(SUM(CASE WHEN transaction_type IN ('income', 'return_in') THEN amount ELSE 0 END), 0) as total_in,
            COALESCE(SUM(CASE WHEN transaction_type IN ('expense', 'return_out') THEN amount ELSE 0 END), 0) as total_out
        FROM transactions
    """)
    row = cursor.fetchone()
    conn.close()

    total_in = row["total_in"] if row else 0.0
    total_out = row["total_out"] if row else 0.0

    return STARTING_BALANCE + total_in - total_out


def get_balance_at_date(target_date):
    """
    Reconstructs the cash balance at a specific historical date.
    Used by forecasting and case memory to understand balance trajectory.

    Formula:
        balance_at(date) = starting_balance + Σ(transactions where txn_date <= date, signed per type)
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            COALESCE(SUM(CASE WHEN transaction_type IN ('income', 'return_in') THEN amount ELSE 0 END), 0) as total_in,
            COALESCE(SUM(CASE WHEN transaction_type IN ('expense', 'return_out') THEN amount ELSE 0 END), 0) as total_out
        FROM transactions
        WHERE date <= ?
    """, (target_date,))
    row = cursor.fetchone()
    conn.close()

    total_in = row["total_in"] if row else 0.0
    total_out = row["total_out"] if row else 0.0

    return STARTING_BALANCE + total_in - total_out


# =============================================================================
# API ROUTES
# =============================================================================

@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint returning backend status and database health."""
    db_status = check_db_health()
    status_code = 200 if db_status == "connected" else 500
    return jsonify({
        "status": "ok" if db_status == "connected" else "unhealthy",
        "message": "LedgerMind API is up and running",
        "database": db_status,
        "environment": os.getenv("FLASK_ENV", "production")
    }), status_code


# =============================================================================
# AUTHENTICATION ROUTES — Public (no @auth_required)
# =============================================================================

@app.route("/api/auth/register", methods=["POST"])
def api_register():
    """
    Registers a new user account with bcrypt-hashed password.
    Accepts: { username, password, full_name (optional) }
    Returns: { success, user, token } — auto-login after registration.
    
    Security: Password is hashed with bcrypt (12 rounds, auto-salt)
    before storage. Plaintext password is NEVER saved.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing request body"}), 400

        username = data.get("username", "").strip()
        password = data.get("password", "")
        full_name = data.get("full_name", "").strip()
        client_ip = get_client_ip()

        result = register_user(username, password, full_name, ip_address=client_ip)

        if result["success"]:
            return jsonify(result), 201
        else:
            return jsonify(result), 400
    except Exception as e:
        print(f"[API Auth Error] Registration failed: {e}")
        return jsonify({"error": f"Registration failed: {str(e)}"}), 500


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    """
    Authenticates a user with bcrypt password verification and brute-force protection.
    Accepts: { username, password }
    Returns: { success, user, token }
    
    Security:
      - Max 5 failed attempts per 15 minutes before temporary lockout (HTTP 429)
      - Timing-safe bcrypt comparison
      - Generic error message to prevent username enumeration
      - Full audit event logging
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing request body"}), 400

        username = data.get("username", "").strip()
        password = data.get("password", "")
        client_ip = get_client_ip()

        result = login_user(username, password, ip_address=client_ip)

        if result["success"]:
            return jsonify(result), 200
        else:
            # Check if this failure was due to lockout
            is_locked = "locked" in result.get("error", "").lower()
            return jsonify(result), 429 if is_locked else 401
    except Exception as e:
        print(f"[API Auth Error] Login failed: {e}")
        return jsonify({"error": f"Login failed: {str(e)}"}), 500


@app.route("/api/auth/logout", methods=["POST"])
@auth_required
def api_logout():
    """
    Terminates the user session by revoking the JWT token immediately.
    Adds cryptographic hash to token_blacklist table and logs audit event.
    """
    try:
        user = g.current_user
        token = getattr(g, "current_token", None)
        if token:
            revoke_token(token, user["user_id"])

        client_ip = get_client_ip()
        log_audit_event(
            user_id=user["user_id"],
            username=user["username"],
            action="AUTH_LOGOUT",
            entity_type="user",
            entity_id=str(user["user_id"]),
            details="User logged out and session token was revoked",
            ip_address=client_ip
        )
        return jsonify({"success": True, "message": "Successfully signed out and session revoked"}), 200
    except Exception as e:
        return jsonify({"error": f"Logout failed: {str(e)}"}), 500


@app.route("/api/auth/profile", methods=["GET"])
@auth_required
def api_profile():
    """
    Returns the authenticated user's profile information.
    Requires valid JWT token in Authorization header.
    Password hash is NEVER included in the response.
    """
    user = g.current_user
    profile = get_user_profile(user["user_id"])
    if profile:
        return jsonify(profile), 200
    return jsonify({"error": "Profile not found"}), 404


@app.route("/api/auth/change-password", methods=["PUT"])
@auth_required
def api_change_password():
    """
    Changes the authenticated user's password.
    Accepts: { current_password, new_password }
    Requires verification of current password before allowing change.
    New password is hashed with fresh bcrypt salt before storage.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing request body"}), 400

        current_password = data.get("current_password", "")
        new_password = data.get("new_password", "")
        client_ip = get_client_ip()

        user = g.current_user
        result = change_user_password(user["user_id"], current_password, new_password, ip_address=client_ip)

        if result["success"]:
            return jsonify(result), 200
        else:
            return jsonify(result), 400
    except Exception as e:
        return jsonify({"error": f"Password change failed: {str(e)}"}), 500


@app.route("/api/auth/verify", methods=["GET"])
@auth_required
def api_verify_token():
    """
    Verifies that the current JWT token is still valid.
    Used by the frontend to check authentication state on page load.
    Returns the authenticated user info if token is valid.
    """
    user = g.current_user
    return jsonify({
        "valid": True,
        "user": user
    }), 200


# =============================================================================
# SECURITY & COMPLIANCE ENDPOINTS — Auditing, Verification, Health Check
# =============================================================================

@app.route("/api/security/status", methods=["GET"])
@auth_required
def api_security_status():
    """
    Returns live cryptographic status, database integrity check,
    rate limiter counters, and system totals.
    """
    status = get_security_health_status()
    return jsonify(status), 200


@app.route("/api/security/audit-logs", methods=["GET"])
@auth_required
def api_audit_logs():
    """
    Returns the latest audit trail logs for financial compliance & security review.
    """
    try:
        limit = int(request.args.get("limit", 50))
        limit = min(max(limit, 1), 200)
        logs = get_recent_audit_logs(limit)
        return jsonify({
            "total_returned": len(logs),
            "audit_logs": logs
        }), 200
    except Exception as e:
        return jsonify({"error": f"Failed to retrieve audit logs: {str(e)}"}), 500


# =============================================================================
# PROTECTED API ROUTES — All require @auth_required
# =============================================================================

@app.route("/api/dashboard/stats", methods=["GET"])
@auth_required
def get_dashboard_stats():
    """
    Exposes aggregated statistics for the frontend dashboard cards and charts:
    - Current cash balance (live-calculated from transactions)
    - Total income and total expenses (separate sums by transaction_type)
    - Total number of transactions
    - Financial risk status (based on current balance vs threshold)
    - Category spend breakdown (expenses only, for Recharts pie chart)
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # 1. Live-calculated balance (single source of truth)
        current_balance = get_current_balance()
        risk_status = "healthy" if current_balance >= BALANCE_ALERT_THRESHOLD else "strained"

        # 2. Get transaction counts and sums by type
        cursor.execute("""
            SELECT 
                COUNT(*) as total_count,
                COALESCE(SUM(CASE WHEN transaction_type IN ('income', 'return_in') THEN amount ELSE 0 END), 0) as total_income,
                COALESCE(SUM(CASE WHEN transaction_type IN ('expense', 'return_out') THEN amount ELSE 0 END), 0) as total_expenses
            FROM transactions
        """)
        count_row = cursor.fetchone()

        total_transactions = count_row["total_count"] if count_row else 0
        total_income = count_row["total_income"] if count_row else 0.0
        total_expenses = count_row["total_expenses"] if count_row else 0.0

        # 3. Get category spend breakdown (expenses only — income shouldn't appear in spend chart)
        cursor.execute("""
            SELECT category, SUM(amount) as total 
            FROM transactions 
            WHERE transaction_type IN ('expense', 'return_out')
            GROUP BY category
        """)
        categories_rows = cursor.fetchall()

        # Convert to Recharts pie chart format: [{ name: 'Education', value: 34500.00 }, ...]
        category_spend = []
        for cat in categories_rows:
            category_spend.append({
                "name": cat["category"],
                "value": cat["total"]
            })

        # 4. Count transactions pending outcome review (new deferred outcome lifecycle)
        cursor.execute("""
            SELECT COUNT(*) as pending_count
            FROM transactions
            WHERE outcome_label = 'pending' AND (user_outcome IS NULL OR user_outcome = '')
        """)
        pending_row = cursor.fetchone()
        pending_review_count = pending_row["pending_count"] if pending_row else 0

        conn.close()

        return jsonify({
            "current_balance": current_balance,
            "total_income": total_income,
            "total_expenses": total_expenses,
            "total_transactions": total_transactions,
            "risk_status": risk_status,
            "category_spend": category_spend,
            "pending_review_count": pending_review_count
        }), 200

    except Exception as e:
        return jsonify({"error": f"Failed to fetch stats: {e}"}), 500


@app.route("/api/transactions", methods=["GET"])
@auth_required
def get_transactions():
    """
    Fetches transaction records from SQLite.
    Supports filtering by category, transaction_type, and search keyword (vendor/client name).
    Sorts by date descending (newest first).
    """
    try:
        category = request.args.get("category")
        search = request.args.get("search")
        txn_type = request.args.get("transaction_type")

        conn = get_db_connection()
        cursor = conn.cursor()

        query = "SELECT * FROM transactions WHERE 1=1"
        params = []

        if category and category != "All":
            query += " AND category = ?"
            params.append(category)

        if txn_type and txn_type != "All":
            query += " AND transaction_type = ?"
            params.append(txn_type)

        if search:
            query += " AND vendor_or_client LIKE ?"
            params.append(f"%{search}%")

        # Sort by date descending
        query += " ORDER BY date DESC, id DESC"

        cursor.execute(query, params)
        rows = cursor.fetchall()

        transactions = []
        for row in rows:
            transactions.append({
                "id": row["id"],
                "vendor_or_client": row["vendor_or_client"],
                "amount": row["amount"],
                "transaction_type": row["transaction_type"],
                "category": row["category"],
                "date": row["date"],
                "outcome_label": row["outcome_label"] if row["outcome_label"] else "",
                "user_notes": row["user_notes"] if row["user_notes"] else "",
                "user_outcome": row["user_outcome"] if row["user_outcome"] else "",
                "outcome_date": row["outcome_date"] if "outcome_date" in row.keys() and row["outcome_date"] else "",
                "outcome_notes": row["outcome_notes"] if "outcome_notes" in row.keys() and row["outcome_notes"] else "",
                "created_at": row["created_at"]
            })

        conn.close()
        return jsonify(transactions), 200

    except Exception as e:
        return jsonify({"error": f"Failed to fetch transactions: {e}"}), 500


@app.route("/api/transactions/pending-review", methods=["GET"])
@auth_required
def get_pending_review_transactions():
    """
    Returns all transactions that still have outcome_label = 'pending' and no user_outcome set.
    Sorted oldest-first so users review the oldest unresolved spends first.
    This is the core 'come back later and evaluate' workflow.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM transactions
            WHERE outcome_label = 'pending' AND (user_outcome IS NULL OR user_outcome = '')
            ORDER BY date ASC, id ASC
        """)
        rows = cursor.fetchall()
        conn.close()

        pending = []
        for row in rows:
            pending.append({
                "id": row["id"],
                "vendor_or_client": row["vendor_or_client"],
                "amount": row["amount"],
                "transaction_type": row["transaction_type"],
                "category": row["category"],
                "date": row["date"],
                "outcome_label": row["outcome_label"],
                "user_notes": row["user_notes"] if row["user_notes"] else "",
                "user_outcome": row["user_outcome"] if row["user_outcome"] else "",
                "outcome_date": row["outcome_date"] if "outcome_date" in row.keys() and row["outcome_date"] else "",
                "outcome_notes": row["outcome_notes"] if "outcome_notes" in row.keys() and row["outcome_notes"] else "",
                "created_at": row["created_at"]
            })

        return jsonify({
            "total_pending": len(pending),
            "transactions": pending
        }), 200
    except Exception as e:
        return jsonify({"error": f"Failed to fetch pending review transactions: {e}"}), 500


@app.route("/api/transactions/search", methods=["GET"])
@auth_required
def search_transactions():
    """
    Advanced search endpoint for finding old invoices by:
    - vendor name (partial match)
    - date range (date_from, date_to)
    - amount range (amount_min, amount_max)
    - category
    - outcome status (pending / reviewed / all)
    Enables the 'find that invoice from months ago' workflow.
    """
    try:
        vendor = request.args.get("vendor", "").strip()
        date_from = request.args.get("date_from", "").strip()
        date_to = request.args.get("date_to", "").strip()
        amount_min = request.args.get("amount_min", "").strip()
        amount_max = request.args.get("amount_max", "").strip()
        category = request.args.get("category", "").strip()
        outcome_status = request.args.get("outcome_status", "all").strip().lower()

        conn = get_db_connection()
        cursor = conn.cursor()

        query = "SELECT * FROM transactions WHERE 1=1"
        params = []

        if vendor:
            query += " AND vendor_or_client LIKE ?"
            params.append(f"%{vendor}%")

        if date_from:
            query += " AND date >= ?"
            params.append(date_from)

        if date_to:
            query += " AND date <= ?"
            params.append(date_to)

        if amount_min:
            try:
                params.append(float(amount_min))
                query += " AND amount >= ?"
            except ValueError:
                pass

        if amount_max:
            try:
                params.append(float(amount_max))
                query += " AND amount <= ?"
            except ValueError:
                pass

        if category and category != "All":
            query += " AND category = ?"
            params.append(category)

        if outcome_status == "pending":
            query += " AND outcome_label = 'pending' AND (user_outcome IS NULL OR user_outcome = '')"
        elif outcome_status == "reviewed":
            query += " AND (outcome_label != 'pending' OR (user_outcome IS NOT NULL AND user_outcome != ''))"

        query += " ORDER BY date DESC, id DESC"

        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        results = []
        for row in rows:
            results.append({
                "id": row["id"],
                "vendor_or_client": row["vendor_or_client"],
                "amount": row["amount"],
                "transaction_type": row["transaction_type"],
                "category": row["category"],
                "date": row["date"],
                "outcome_label": row["outcome_label"] if row["outcome_label"] else "",
                "user_notes": row["user_notes"] if row["user_notes"] else "",
                "user_outcome": row["user_outcome"] if row["user_outcome"] else "",
                "outcome_date": row["outcome_date"] if "outcome_date" in row.keys() and row["outcome_date"] else "",
                "outcome_notes": row["outcome_notes"] if "outcome_notes" in row.keys() and row["outcome_notes"] else "",
                "created_at": row["created_at"]
            })

        return jsonify({
            "total_results": len(results),
            "transactions": results
        }), 200
    except Exception as e:
        return jsonify({"error": f"Failed to search transactions: {e}"}), 500


@app.route("/api/transactions/upload", methods=["POST"])
@auth_required
def upload_transaction():
    """
    Handles file upload, validates extension & magic bytes, triggers OCR + NLP,
    persists in database with user ownership, and records audit trail.
    Ensures safe temporary file cleanup in all execution branches.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({"error": "Empty filename"}), 400

    raw_filename = secure_filename(file.filename)
    if not raw_filename or '.' not in raw_filename:
        return jsonify({"error": "Invalid filename format"}), 400

    ext = raw_filename.rsplit('.', 1)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": f"File format '.{ext}' is not permitted. Allowed formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        }), 400

    # Cryptographic / signature magic bytes check to block spoofed malicious files
    if not validate_file_signature(file.stream, ext):
        return jsonify({
            "error": "File signature mismatch: The uploaded file does not match its expected format."
        }), 400

    # Unique collision-proof filename with UUID prefix
    safe_filename = f"upload_{uuid.uuid4().hex[:12]}_{raw_filename}"
    temp_path = os.path.join(UPLOAD_FOLDER, safe_filename)

    try:
        file.save(temp_path)
        print(f"[API Upload] File saved safely to {temp_path}")

        # 1. Run OCR/Direct PDF Ingestion
        extracted_text = extract_text_from_file(temp_path)

        # 2. Run NLP Field Extraction
        parsed_fields = extract_fields(extracted_text)
        vendor_or_client = sanitize_text(parsed_fields.get("vendor", "Unknown Vendor"), 150)
        try:
            amount = float(parsed_fields.get("amount", 0.0))
        except (ValueError, TypeError):
            amount = 0.0
        date_str = parsed_fields.get("date", datetime.today().strftime('%Y-%m-%d'))
        category = sanitize_text(parsed_fields.get("category", "General"), 80)
        transaction_type = parsed_fields.get("transaction_type", "expense")
        user_id = g.current_user["user_id"]

        # 3. Check for duplicates
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, vendor_or_client, amount, transaction_type, category, date, outcome_label 
            FROM transactions 
            WHERE vendor_or_client = ? AND amount = ? AND date = ? AND transaction_type = ?
        """, (vendor_or_client, amount, date_str, transaction_type))
        existing_txn = cursor.fetchone()

        if existing_txn:
            conn.close()
            print(f"[API Upload] Exact duplicate transaction detected for {vendor_or_client} on {date_str} (ID {existing_txn['id']}). Skipping duplicate insert.")
            return jsonify({
                "id": existing_txn["id"],
                "vendor_or_client": existing_txn["vendor_or_client"],
                "amount": existing_txn["amount"],
                "transaction_type": existing_txn["transaction_type"],
                "category": existing_txn["category"],
                "date": existing_txn["date"],
                "current_balance": get_current_balance(),
                "outcome_label": existing_txn["outcome_label"],
                "duplicate_detected": True,
                "raw_text_preview": extracted_text[:300] + "..." if len(extracted_text) > 300 else extracted_text
            }), 200

        # 4. New uploads start with 'pending' outcome
        outcome_label = "pending"

        # 5. Save to database with user_id
        cursor.execute("""
            INSERT INTO transactions (vendor_or_client, amount, transaction_type, category, date, outcome_label, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (vendor_or_client, amount, transaction_type, category, date_str, outcome_label, user_id))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()

        # 6. Index into ChromaDB vector case memory
        add_case_memory(
            txn_id=new_id,
            vendor_or_client=vendor_or_client,
            amount=amount,
            transaction_type=transaction_type,
            category=category,
            notes="",
            outcome=outcome_label
        )

        # 7. Audit log event
        log_audit_event(
            user_id=user_id,
            username=g.current_user["username"],
            action="TRANSACTION_UPLOAD_OCR",
            entity_type="transaction",
            entity_id=str(new_id),
            details=f"Uploaded invoice '{raw_filename}' -> {vendor_or_client} (Rs. {amount:,.2f})",
            ip_address=get_client_ip()
        )

        # 8. Trigger forecasting dataset regeneration
        print("[API Upload] Rebuilding daily cashflow simulation...")
        generate_historical_cashflow()

        return jsonify({
            "id": new_id,
            "vendor_or_client": vendor_or_client,
            "amount": amount,
            "transaction_type": transaction_type,
            "category": category,
            "date": date_str,
            "current_balance": get_current_balance(),
            "outcome_label": outcome_label,
            "duplicate_detected": False,
            "raw_text_preview": extracted_text[:300] + "..." if len(extracted_text) > 300 else extracted_text
        }), 201

    except Exception as e:
        print(f"[API Upload Error] Ingestion failed: {e}")
        return jsonify({"error": f"Failed to ingest transaction: {str(e)}"}), 500
    finally:
        # Guarantee cleanup of temporary uploaded file in all paths
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
                print(f"[API Upload] Cleaned up temporary file: {temp_path}")
            except Exception as err:
                print(f"[API Upload] Failed to delete temp file: {err}")


@app.route("/api/transactions/manual", methods=["POST"])
@auth_required
def add_manual_transaction():
    """
    Accepts a manual transaction entry with strict input sanitization:
    - Validates amount range, date format, and bounds
    - Associates transaction with authenticated user_id
    - Records tamper-evident audit log
    - Triggers cashflow timeline regeneration
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing payload"}), 400

        vendor_or_client = sanitize_text(data.get("vendor_or_client", "Cash Transaction"), 150)
        try:
            amount = float(data.get("amount", 0.0))
        except (ValueError, TypeError):
            return jsonify({"error": "Amount must be a valid number"}), 400

        if amount <= 0 or amount > 1_000_000_000:
            return jsonify({"error": "Amount must be positive and under Rs. 1,000,000,000"}), 400

        date_str = data.get("date")
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")
        else:
            try:
                datetime.strptime(date_str, "%Y-%m-%d")
            except ValueError:
                return jsonify({"error": "Invalid date format. Expected YYYY-MM-DD"}), 400

        category = sanitize_text(data.get("category", "Miscellaneous"), 80)
        transaction_type = data.get("transaction_type", "expense")
        user_notes = sanitize_text(data.get("user_notes", ""), 1000)
        user_id = g.current_user["user_id"]

        # Validate transaction_type
        valid_types = ("income", "expense", "return_in", "return_out")
        if transaction_type not in valid_types:
            return jsonify({"error": f"Invalid transaction_type. Must be one of: {valid_types}"}), 400

        outcome_label = "pending"

        # 1. Save to database with user_id
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO transactions (vendor_or_client, amount, transaction_type, category, date, outcome_label, user_notes, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (vendor_or_client, amount, transaction_type, category, date_str, outcome_label, user_notes, user_id))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()

        # 2. Index into ChromaDB vector case memory
        add_case_memory(
            txn_id=new_id,
            vendor_or_client=vendor_or_client,
            amount=amount,
            transaction_type=transaction_type,
            category=category,
            notes=user_notes,
            outcome=outcome_label
        )

        # 3. Record audit event
        log_audit_event(
            user_id=user_id,
            username=g.current_user["username"],
            action="TRANSACTION_MANUAL_CREATE",
            entity_type="transaction",
            entity_id=str(new_id),
            details=f"Created {transaction_type} of Rs. {amount:,.2f} for '{vendor_or_client}'",
            ip_address=get_client_ip()
        )

        # 4. Re-trigger forecasting CSV regeneration
        print("[API Manual] Rebuilding daily cashflow simulation...")
        generate_historical_cashflow()

        return jsonify({
            "id": new_id,
            "vendor_or_client": vendor_or_client,
            "amount": amount,
            "transaction_type": transaction_type,
            "category": category,
            "date": date_str,
            "current_balance": get_current_balance(),
            "outcome_label": outcome_label,
            "user_notes": user_notes
        }), 201

    except Exception as e:
        print(f"[API Manual Error] Add manual transaction failed: {e}")
        return jsonify({"error": f"Failed to record manual transaction: {str(e)}"}), 500


@app.route("/api/transactions/<int:txn_id>/notes", methods=["PUT"])
@auth_required
def update_transaction_notes(txn_id):
    """
    Updates the user_notes / spend experience of any transaction in the ledger
    and syncs the updated memory into ChromaDB vector store.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing payload"}), 400

        user_notes = data.get("user_notes", "")

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE transactions SET user_notes = ? WHERE id = ?", (user_notes, txn_id))
        conn.commit()

        cursor.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,))
        row = cursor.fetchone()
        conn.close()

        if row:
            txn = dict(row)
            outcome_val = txn.get("user_outcome") or txn.get("outcome_label", "healthy")
            out_note = (txn.get("outcome_notes") or "").strip()
            if user_notes and out_note:
                notes_combined = f"{user_notes} | Outcome: {out_note}"
            elif user_notes:
                notes_combined = user_notes
            else:
                notes_combined = out_note

            add_case_memory(
                txn_id=txn["id"],
                vendor_or_client=txn.get("vendor_or_client", ""),
                amount=float(txn.get("amount", 0.0)),
                transaction_type=txn.get("transaction_type", "expense"),
                category=txn.get("category", "Miscellaneous"),
                notes=notes_combined,
                outcome=outcome_val
            )

        print(f"[API Notes] Updating notes for ID {txn_id}. Rebuilding daily cashflow & synced ChromaDB...")
        generate_historical_cashflow()

        return jsonify({"success": True, "message": "Transaction notes updated and synced to case memory successfully"}), 200
    except Exception as e:
        print(f"[API Notes Error] Failed to update notes: {e}")
        return jsonify({"error": f"Failed to save transaction notes: {str(e)}"}), 500


@app.route("/api/transactions/<int:txn_id>/outcome", methods=["PUT"])
@auth_required
def update_transaction_outcome(txn_id):
    """
    Records the user's real-world outcome evaluation for a transaction.
    Accepts: user_outcome (the label), outcome_notes (what happened), outcome_date (when evaluated).
    When user sets a real outcome, also updates outcome_label from 'pending' to the chosen value.
    Syncs the updated outcome into ChromaDB vector case memory for AI learning.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing payload"}), 400

        outcome_date = data.get("outcome_date", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))

        conn = get_db_connection()
        cursor = conn.cursor()

        # Fetch existing record first
        cursor.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({"error": f"Transaction #{txn_id} not found"}), 404

        txn = dict(row)

        # Do not wipe existing outcome if user is only updating notes
        if "user_outcome" in data and data["user_outcome"]:
            final_user_outcome = str(data["user_outcome"]).strip()
            outcome_label_map = {
                "Healthy": "healthy",
                "Strained": "strained",
                "Profitable": "profitable",
                "Wasteful": "wasteful",
                "Break-even": "break-even"
            }
            new_outcome_label = outcome_label_map.get(final_user_outcome, final_user_outcome.lower())
        else:
            final_user_outcome = txn.get("user_outcome", "")
            new_outcome_label = txn.get("outcome_label", "pending")

        # Do not wipe existing notes if user is only updating outcome
        if "outcome_notes" in data and data["outcome_notes"] is not None:
            final_outcome_notes = str(data["outcome_notes"]).strip()
        else:
            final_outcome_notes = txn.get("outcome_notes", "")

        cursor.execute("""
            UPDATE transactions 
            SET user_outcome = ?, outcome_notes = ?, outcome_date = ?, outcome_label = ?
            WHERE id = ?
        """, (final_user_outcome, final_outcome_notes, outcome_date, new_outcome_label, txn_id))
        conn.commit()
        conn.close()

        # Combine initial notes with outcome notes for rich vector case memory
        init_note = (txn.get("user_notes") or "").strip()
        if init_note and final_outcome_notes:
            notes_combined = f"{init_note} | Outcome details: {final_outcome_notes}"
        elif final_outcome_notes:
            notes_combined = final_outcome_notes
        else:
            notes_combined = init_note

        outcome_val = final_user_outcome if final_user_outcome else new_outcome_label
        add_case_memory(
            txn_id=txn["id"],
            vendor_or_client=txn.get("vendor_or_client", ""),
            amount=float(txn.get("amount", 0.0)),
            transaction_type=txn.get("transaction_type", "expense"),
            category=txn.get("category", "Miscellaneous"),
            notes=notes_combined,
            outcome=outcome_val
        )

        print(f"[API Outcome] Updated outcome for transaction #{txn_id}: user_outcome='{final_user_outcome}', notes='{final_outcome_notes[:50]}...', synced to ChromaDB")
        return jsonify({
            "success": True,
            "message": f"Outcome recorded as '{final_user_outcome}' with notes and indexed in case memory",
            "outcome_label": new_outcome_label,
            "user_outcome": final_user_outcome,
            "outcome_notes": final_outcome_notes,
            "outcome_date": outcome_date
        }), 200
    except Exception as e:
        print(f"[API Outcome Error] Failed to update outcome: {e}")
        return jsonify({"error": f"Failed to update outcome label: {str(e)}"}), 500


@app.route("/api/transactions/<int:txn_id>/type", methods=["PUT"])
@auth_required
def update_transaction_type(txn_id):
    """
    Updates the transaction_type (income/expense/return_in/return_out) of any transaction.
    Re-calculates system outcome labels and triggers daily cashflow simulation rebuild.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing payload"}), 400

        new_type = data.get("transaction_type")
        valid_types = ("income", "expense", "return_in", "return_out")
        if new_type not in valid_types:
            return jsonify({"error": f"Invalid transaction_type. Must be one of {valid_types}"}), 400

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE transactions SET transaction_type = ? WHERE id = ?", (new_type, txn_id))
        conn.commit()
        conn.close()

        print(f"[API Type Update] Transaction #{txn_id} type updated to '{new_type}'. Rebuilding cashflow...")
        generate_historical_cashflow()

        return jsonify({
            "success": True,
            "message": f"Transaction #{txn_id} updated to '{new_type}'",
            "current_balance": get_current_balance()
        }), 200
    except Exception as e:
        print(f"[API Type Update Error] Failed to update type: {e}")
        return jsonify({"error": f"Failed to update transaction type: {str(e)}"}), 500


@app.route("/api/transactions/<int:txn_id>", methods=["DELETE"])
@auth_required
def delete_transaction(txn_id):
    """
    Deletes a transaction record from SQLite by ID with audit logging.
    Triggers daily cashflow timeline regeneration.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({"error": f"Transaction #{txn_id} not found"}), 404

        txn_record = dict(row)
        cursor.execute("DELETE FROM transactions WHERE id = ?", (txn_id,))
        conn.commit()
        conn.close()

        # Audit log of transaction deletion
        log_audit_event(
            user_id=g.current_user["user_id"],
            username=g.current_user["username"],
            action="TRANSACTION_DELETE",
            entity_type="transaction",
            entity_id=str(txn_id),
            details=f"Deleted transaction #{txn_id}: {txn_record.get('vendor_or_client')} (Rs. {float(txn_record.get('amount', 0)):,.2f})",
            ip_address=get_client_ip()
        )

        # Also remove from ChromaDB vector store to prevent orphaned case memories
        try:
            from case_memory.vector_store import get_vector_store
            _, col = get_vector_store()
            col.delete(ids=[f"txn_{txn_id}"])
            print(f"[API Delete] Removed txn_{txn_id} from ChromaDB vector store.")
        except Exception as chroma_err:
            print(f"[API Delete] ChromaDB cleanup warning (non-critical): {chroma_err}")

        print(f"[API Delete] Deleted transaction #{txn_id}. Rebuilding cashflow...")
        generate_historical_cashflow()

        return jsonify({
            "success": True,
            "message": f"Transaction #{txn_id} deleted successfully",
            "current_balance": get_current_balance()
        }), 200
    except Exception as e:
        print(f"[API Delete Error] Failed to delete transaction #{txn_id}: {e}")
        return jsonify({"error": f"Failed to delete transaction: {str(e)}"}), 500


@app.route("/api/invoices/<int:txn_id>/pdf", methods=["GET"])
@auth_required
def download_invoice_pdf(txn_id):
    """
    Generates and streams an authentic, high-quality PDF Tax Invoice / Expense Voucher
    directly to the user with proper Content-Disposition and application/pdf headers.
    """
    try:
        import io
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,))
        row = cursor.fetchone()
        conn.close()

        if not row:
            return jsonify({"error": f"Transaction #{txn_id} not found"}), 404

        txn = dict(row)
        vendor = txn.get("vendor_or_client", "Entity")
        amount = float(txn.get("amount", 0.0))
        txn_type = txn.get("transaction_type", "expense")
        category = txn.get("category", "General")
        date_str = txn.get("date", datetime.today().strftime('%Y-%m-%d'))
        notes = txn.get("user_notes", "")
        outcome = txn.get("user_outcome", "")
        health = txn.get("outcome_label", "Healthy")

        is_income = txn_type in ["income", "return_in"]
        doc_title = "TAX INVOICE / RECEIPT" if is_income else "EXPENSE VOUCHER / BILL"
        invoice_no = f"INV-{txn_id:05d}"
        clean_vendor = "".join(c for c in vendor if c.isalnum() or c in (' ', '_', '-')).strip().replace(' ', '_')
        filename = f"LedgerMind_Invoice_{invoice_no}_{clean_vendor}.pdf"

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=36,
            leftMargin=36,
            topMargin=36,
            bottomMargin=36
        )

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle('TitleStyle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=22, textColor=colors.HexColor('#4338ca'), leading=26)
        sub_style = ParagraphStyle('SubStyle', parent=styles['Normal'], fontName='Helvetica', fontSize=9, textColor=colors.HexColor('#64748b'), leading=12)
        badge_style = ParagraphStyle('BadgeStyle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=10, textColor=colors.HexColor('#166534' if is_income else '#b91c1c'), alignment=2, leading=14)
        inv_no_style = ParagraphStyle('InvNoStyle', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=12, textColor=colors.HexColor('#0f172a'), alignment=2, leading=16)
        meta_label_style = ParagraphStyle('MetaLabel', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor('#64748b'), leading=10)
        meta_val_style = ParagraphStyle('MetaVal', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=13, textColor=colors.HexColor('#0f172a'), leading=16)
        meta_sub_style = ParagraphStyle('MetaSub', parent=styles['Normal'], fontName='Helvetica', fontSize=9, textColor=colors.HexColor('#475569'), leading=12)
        table_head_style = ParagraphStyle('THead', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=9, textColor=colors.white, leading=11)
        table_cell_style = ParagraphStyle('TCell', parent=styles['Normal'], fontName='Helvetica', fontSize=9, textColor=colors.HexColor('#0f172a'), leading=12)
        table_amt_style = ParagraphStyle('TAmt', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=10, textColor=colors.HexColor('#0f172a'), alignment=2, leading=13)
        total_lbl_style = ParagraphStyle('TotLbl', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=10, textColor=colors.HexColor('#475569'), leading=12)
        total_val_style = ParagraphStyle('TotVal', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=14, textColor=colors.HexColor('#166534' if is_income else '#b91c1c'), alignment=2, leading=16)
        footer_style = ParagraphStyle('Footer', parent=styles['Normal'], fontName='Helvetica', fontSize=8, textColor=colors.HexColor('#94a3b8'), alignment=1, leading=11)

        story = []

        # 1. Header Table
        header_data = [
            [
                Paragraph("<b>LedgerMind AI</b>", title_style),
                Paragraph(f"<b>{doc_title}</b>", badge_style)
            ],
            [
                Paragraph("Intelligent Financial Operating System", sub_style),
                Paragraph(f"<b>{invoice_no}</b>", inv_no_style)
            ]
        ]
        header_table = Table(header_data, colWidths=[280, 240])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ]))
        story.append(header_table)
        story.append(Spacer(1, 15))
        story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor('#e2e8f0'), spaceAfter=15))

        # 2. Metadata Box
        meta_data = [
            [
                Paragraph("RECEIVED FROM (CLIENT)" if is_income else "PAID TO (VENDOR / ENTITY)", meta_label_style),
                Paragraph("TRANSACTION DATE", meta_label_style)
            ],
            [
                Paragraph(vendor, meta_val_style),
                Paragraph(date_str, meta_val_style)
            ],
            [
                Paragraph(f"Category: <b>{category}</b>", meta_sub_style),
                Paragraph(f"System Health: <b>{health}</b>", meta_sub_style)
            ]
        ]
        meta_table = Table(meta_data, colWidths=[280, 240])
        meta_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#e2e8f0')),
            ('PADDING', (0,0), (-1,-1), 8),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        story.append(meta_table)
        story.append(Spacer(1, 20))

        # 3. Item Table
        item_data = [
            [
                Paragraph("<b>Description / Entity</b>", table_head_style),
                Paragraph("<b>Category</b>", table_head_style),
                Paragraph("<b>Type</b>", table_head_style),
                Paragraph("<b>Amount (INR)</b>", ParagraphStyle('TRHead', parent=table_head_style, alignment=2))
            ],
            [
                Paragraph(f"<b>{vendor}</b>" + (f"<br/><font color='#64748b' size=7.5><i>Note: {notes}</i></font>" if notes else ""), table_cell_style),
                Paragraph(category, table_cell_style),
                Paragraph(txn_type.upper(), table_cell_style),
                Paragraph(f"Rs. {amount:,.2f}", table_amt_style)
            ]
        ]
        item_table = Table(item_data, colWidths=[220, 100, 90, 110])
        item_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#4338ca')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('BACKGROUND', (0,1), (-1,1), colors.HexColor('#f8fafc')),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#e2e8f0')),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
            ('PADDING', (0,0), (-1,-1), 8),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ]))
        story.append(item_table)
        story.append(Spacer(1, 15))

        # 4. Total Outlay Box
        total_data = [
            [
                Paragraph(f"Total {'Received' if is_income else 'Outlay'}:", total_lbl_style),
                Paragraph(f"Rs. {amount:,.2f}", total_val_style)
            ]
        ]
        total_table = Table(total_data, colWidths=[120, 140])
        total_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
            ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#e2e8f0')),
            ('PADDING', (0,0), (-1,-1), 10),
            ('ALIGN', (0,0), (0,0), 'LEFT'),
            ('ALIGN', (1,0), (1,0), 'RIGHT'),
        ]))
        
        wrapper_table = Table([[Paragraph("", styles['Normal']), total_table]], colWidths=[260, 260])
        wrapper_table.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('ALIGN', (1,0), (1,0), 'RIGHT'),
        ]))
        story.append(wrapper_table)
        story.append(Spacer(1, 15))

        # 5. Outcome Badge if present
        if outcome:
            outcome_data = [[Paragraph(f"<b>Decision Outcome Label:</b> {outcome}", ParagraphStyle('OutStyle', parent=styles['Normal'], fontName='Helvetica', fontSize=9, textColor=colors.HexColor('#3730a3')))]]
            outcome_table = Table(outcome_data, colWidths=[520])
            outcome_table.setStyle(TableStyle([
                ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#eef2ff')),
                ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#c7d2fe')),
                ('PADDING', (0,0), (-1,-1), 8),
            ]))
            story.append(outcome_table)
            story.append(Spacer(1, 25))
        else:
            story.append(Spacer(1, 35))

        # 6. Footer
        story.append(HRFlowable(width="100%", thickness=0.75, color=colors.HexColor('#e2e8f0'), spaceAfter=10))
        story.append(Paragraph(f"Generated automatically by LedgerMind Financial Operating System on {datetime.today().strftime('%B %d, %Y')}.<br/>This authentic digital PDF document serves as an offline verifiable financial record.", footer_style))

        doc.build(story)
        buffer.seek(0)
        pdf_bytes = buffer.getvalue()

        return Response(
            pdf_bytes,
            mimetype="application/pdf",
            headers={
                "Content-Type": "application/pdf",
                "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{filename}',
                "Access-Control-Expose-Headers": "Content-Disposition",
                "Cache-Control": "public, max-age=3600"
            }
        )
    except Exception as e:
        print(f"[API Invoice PDF Error] Failed to generate PDF for txn #{txn_id}: {e}")
        return jsonify({"error": f"Failed to generate invoice PDF: {str(e)}"}), 500


@app.route("/api/transactions/deduplicate", methods=["POST"])
@auth_required
def deduplicate_transactions():
    """
    Scans the database for duplicate transactions (same vendor_or_client, amount, date)
    and removes excess duplicate rows, keeping only the earliest inserted record.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        # Find duplicate IDs to delete (keep smallest ID for each (vendor_or_client, amount, date) group)
        cursor.execute("""
            DELETE FROM transactions 
            WHERE id NOT IN (
                SELECT MIN(id) 
                FROM transactions 
                GROUP BY vendor_or_client, amount, date, transaction_type
            )
        """)
        deleted_count = cursor.rowcount
        conn.commit()
        conn.close()

        print(f"[API Deduplicate] Removed {deleted_count} duplicate transaction records.")
        generate_historical_cashflow()

        return jsonify({
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Successfully removed {deleted_count} duplicate record(s).",
            "current_balance": get_current_balance()
        }), 200
    except Exception as e:
        print(f"[API Deduplicate Error] Deduplication failed: {e}")
        return jsonify({"error": f"Failed to deduplicate transactions: {str(e)}"}), 500


@app.route("/api/balance", methods=["GET"])
@auth_required
def get_balance():
    """
    Returns the current live-calculated balance and starting balance.
    Useful for frontend components that need just the balance without full stats.
    """
    current = get_current_balance()
    return jsonify({
        "starting_balance": STARTING_BALANCE,
        "current_balance": current,
        "risk_status": "healthy" if current >= BALANCE_ALERT_THRESHOLD else "strained"
    }), 200


@app.route("/api/forecast", methods=["GET"])
@auth_required
def get_cashflow_forecast():
    """
    Triggers the Prophet + ARIMA forecasting models and returns:
    - Historical daily balances (last 60 days)
    - Prophet 30-day future predictions (with lower/upper boundaries)
    - ARIMA 30-day future predictions
    - Model MAPE metrics
    - Risk alert indicators if cash is predicted to cross below Rs. 10,000
    """
    try:
        forecast_data = get_forecasts()

        # Scan Prophet forecast for risk events
        risk_events = []
        alert = False
        first_risk_date = None

        for row in forecast_data["prophet"]:
            # If the predicted mean crosses below threshold
            if row["balance"] < BALANCE_ALERT_THRESHOLD:
                alert = True
                risk_events.append(row["date"])
                if not first_risk_date:
                    first_risk_date = row["date"]

        forecast_data["alert"] = {
            "has_risk": alert,
            "first_risk_date": first_risk_date,
            "risk_days_count": len(risk_events)
        }

        return jsonify(forecast_data), 200
    except Exception as e:
        print(f"[API Forecast Error] Model execution failed: {e}")
        return jsonify({"error": f"Failed to compute cash flow forecast: {str(e)}"}), 500


@app.route("/api/cases", methods=["GET", "POST"])
@auth_required
def manage_cases():
    """
    GET: Returns all indexed small-business case memories from ChromaDB.
    POST: Manually creates a new case memory directly in ChromaDB vector store.
    """
    if request.method == "POST":
        try:
            data = request.json or {}
            vendor = data.get("vendor_or_client", "Manual Case")
            amount = float(data.get("amount", 0.0))
            txn_type = data.get("transaction_type", "expense")
            category = data.get("category", "Miscellaneous")
            outcome = data.get("outcome", "healthy")
            notes = data.get("notes", "")

            import time
            case_id = int(time.time() * 1000)

            success = add_case_memory(
                txn_id=case_id,
                vendor_or_client=vendor,
                amount=amount,
                transaction_type=txn_type,
                category=category,
                notes=notes,
                outcome=outcome
            )

            if not success:
                return jsonify({"error": "Failed to index case memory into ChromaDB"}), 500

            return jsonify({
                "success": True,
                "message": "Case memory created and indexed in ChromaDB successfully",
                "case": {
                    "id": f"txn_{case_id}",
                    "vendor_or_client": vendor,
                    "amount": amount,
                    "transaction_type": txn_type,
                    "category": category,
                    "outcome": outcome,
                    "notes": notes
                }
            }), 201
        except Exception as e:
            print(f"[API Create Case Error] {e}")
            return jsonify({"error": f"Failed to create case memory: {str(e)}"}), 500

    # GET request
    try:
        cases = get_all_cases()
        return jsonify({
            "total_count": len(cases),
            "cases": cases
        }), 200
    except Exception as e:
        print(f"[API Cases Error] Failed to fetch case memories: {e}")
        return jsonify({"error": f"Failed to fetch case memories: {str(e)}"}), 500



@app.route("/api/cases/query", methods=["POST"])
@auth_required
def query_cases():
    """
    Performs semantic vector search across all indexed case memories in ChromaDB.
    Accepts payload: { "query": "buying new development laptops for business", "top_k": 3 }
    Returns top relevant cases with similarity scores and outcome states.
    """
    try:
        data = request.json
        if not data or not data.get("query"):
            return jsonify({"error": "Missing 'query' string parameter in request body"}), 400

        query_text = data.get("query")
        top_k = int(data.get("top_k", 3))

        matched_cases = query_similar_cases(query_text=query_text, top_k=top_k)

        return jsonify({
            "query": query_text,
            "match_count": len(matched_cases),
            "matches": matched_cases
        }), 200
    except Exception as e:
        print(f"[API Cases Query Error] Semantic search failed: {e}")
        return jsonify({"error": f"Semantic vector search failed: {str(e)}"}), 500


@app.route("/api/advisor/query", methods=["POST"])
@auth_required
def advisor_query():
    """
    RAG Fusion Reasoning Engine Endpoint with Multi-Turn Persistent Chat History:
    Accepts payload: { "query": "Should I purchase 5 laptops for Rs. 75,000?", "language": "en" }
    Retrieves vector case memory, forecasts cashflow, applies adaptive blending,
    generates explainable advice, persists turn into advisor_chats, and logs an audit trail.
    """
    try:
        data = request.json
        if not data or not data.get("query"):
            return jsonify({"error": "Missing 'query' string in request body"}), 400

        user_query = data.get("query")
        top_k = int(data.get("top_k", 4))
        language = data.get("language", "en")

        user_id = g.current_user["user_id"] if (hasattr(g, 'current_user') and g.current_user) else 1
        username = g.current_user.get("username", "admin") if (hasattr(g, 'current_user') and g.current_user) else "admin"

        # Retrieve prior conversation turns for multi-turn conversational reasoning
        recent_history = []
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS advisor_chats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL DEFAULT 1,
                    query TEXT NOT NULL,
                    language TEXT DEFAULT 'en',
                    verdict TEXT,
                    risk_level TEXT,
                    response_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("""
                SELECT query, language, verdict, risk_level, response_json
                FROM advisor_chats
                WHERE user_id = ?
                ORDER BY id DESC LIMIT 4
            """, (user_id,))
            rows = cursor.fetchall()
            for r in reversed(rows):
                try:
                    r_obj = json.loads(r["response_json"])
                except Exception:
                    r_obj = {}
                recent_history.append({
                    "query": r["query"],
                    "verdict": r["verdict"],
                    "risk_level": r["risk_level"],
                    "response": r_obj
                })
            conn.close()
        except Exception as h_err:
            print(f"[Advisor History Context Warning] {h_err}")

        # Also support client-provided history if provided
        if data.get("history") and isinstance(data.get("history"), list):
            recent_history = data.get("history")

        result = generate_advisor_recommendation(
            user_query=user_query, 
            top_k=top_k, 
            language=language, 
            chat_history=recent_history
        )

        verdict = result.get("verdict", "Evaluated")
        risk_level = result.get("risk_level", "Medium")
        response_json_str = json.dumps(result, ensure_ascii=False)

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS advisor_chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 1,
                query TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                verdict TEXT,
                risk_level TEXT,
                response_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            INSERT INTO advisor_chats (user_id, query, language, verdict, risk_level, response_json)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (user_id, user_query, language, verdict, risk_level, response_json_str))
        conn.commit()
        chat_id = cursor.lastrowid
        cursor.execute("SELECT created_at FROM advisor_chats WHERE id = ?", (chat_id,))
        row = cursor.fetchone()
        created_at = row["created_at"] if row else datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        conn.close()

        result["id"] = chat_id
        result["user_id"] = user_id
        result["created_at"] = created_at
        result["query"] = user_query
        result["language"] = language

        # Audit the consultation event
        log_audit_event(
            user_id=user_id,
            username=username,
            action="ADVISOR_CONSULTATION",
            entity_type="advisor_chat",
            entity_id=str(chat_id),
            details=f"Query: {user_query[:60]}... | Verdict: {verdict} | Risk: {risk_level}",
            ip_address=get_client_ip()
        )

        return jsonify(result), 200
    except Exception as e:
        print(f"[API Advisor Error] Fusion reasoning failed: {e}")
        return jsonify({"error": f"Advisor fusion engine failed: {str(e)}"}), 500


@app.route("/api/advisor/history", methods=["GET"])
@auth_required
def get_advisor_history():
    """
    Retrieves chronological multi-turn chat history for the authenticated user.
    """
    try:
        user_id = g.current_user["user_id"] if (hasattr(g, 'current_user') and g.current_user) else 1
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS advisor_chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL DEFAULT 1,
                query TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                verdict TEXT,
                risk_level TEXT,
                response_json TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()

        cursor.execute("""
            SELECT id, user_id, query, language, verdict, risk_level, response_json, created_at
            FROM advisor_chats
            WHERE user_id = ?
            ORDER BY id ASC
        """, (user_id,))
        rows = cursor.fetchall()
        conn.close()

        history = []
        for r in rows:
            try:
                resp_obj = json.loads(r["response_json"])
            except Exception:
                resp_obj = {}
            history.append({
                "id": r["id"],
                "user_id": r["user_id"],
                "query": r["query"],
                "language": r["language"] or "en",
                "verdict": r["verdict"],
                "risk_level": r["risk_level"],
                "created_at": r["created_at"],
                "response": resp_obj
            })

        return jsonify({
            "total_messages": len(history),
            "history": history
        }), 200
    except Exception as e:
        print(f"[API Advisor History Error] Retrieval failed: {e}")
        return jsonify({"error": f"Failed to retrieve advisor history: {str(e)}"}), 500


@app.route("/api/advisor/history", methods=["DELETE"])
@auth_required
def clear_advisor_history():
    """
    Clears all chat history or deletes a specific message by id query param (?id=X).
    """
    try:
        user_id = g.current_user["user_id"] if (hasattr(g, 'current_user') and g.current_user) else 1
        username = g.current_user.get("username", "admin") if (hasattr(g, 'current_user') and g.current_user) else "admin"
        target_id = request.args.get("id")

        conn = get_db_connection()
        cursor = conn.cursor()
        if target_id:
            cursor.execute("DELETE FROM advisor_chats WHERE id = ? AND user_id = ?", (target_id, user_id))
            action_desc = f"ADVISOR_MESSAGE_DELETED_{target_id}"
            details_str = f"Deleted advisor message #{target_id}"
        else:
            cursor.execute("DELETE FROM advisor_chats WHERE user_id = ?", (user_id,))
            action_desc = "ADVISOR_HISTORY_CLEARED"
            details_str = f"Cleared full advisor chat history for user {username}"
        conn.commit()
        conn.close()

        log_audit_event(
            user_id=user_id,
            username=username,
            action=action_desc,
            entity_type="advisor_chat",
            entity_id=str(target_id or "all"),
            details=details_str,
            ip_address=get_client_ip()
        )

        return jsonify({
            "message": "Advisor chat history updated successfully",
            "deleted_id": target_id
        }), 200
    except Exception as e:
        print(f"[API Advisor Clear History Error] Deletion failed: {e}")
        return jsonify({"error": f"Failed to clear advisor history: {str(e)}"}), 500


@app.route("/api/tts", methods=["GET"])
@auth_required
def text_to_speech_proxy():
    """
    High-Fidelity Neural Text-to-Speech Streaming Endpoint.
    Accepts: /api/tts?text=...&lang=ta
    Streams raw MP3 audio directly to client browser with audio/mpeg content-type.
    """
    text = request.args.get("text", "").strip()
    lang = request.args.get("lang", "ta").strip()
    if not text:
        return jsonify({"error": "Missing 'text' query parameter"}), 400

    try:
        safe_text = text[:200]
        url = f"https://translate.google.com/translate_tts?ie=UTF-8&q={urllib.parse.quote(safe_text)}&tl={lang}&client=tw-ob"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://translate.google.com/'
        })
        with urllib.request.urlopen(req, timeout=8) as resp:
            audio_data = resp.read()
            return Response(audio_data, mimetype="audio/mpeg", headers={
                "Content-Type": "audio/mpeg",
                "Cache-Control": "public, max-age=86400"
            })
    except Exception as e:
        print(f"[API TTS Error] TTS generation failed: {e}")
        return jsonify({"error": f"TTS generation failed: {str(e)}"}), 500


@app.route("/api/transactions/anomalies", methods=["GET"])
@auth_required
def get_anomalies():
    """
    Triggers the Fraud & Anomaly Detection engine (Isolation Forest + Statistical Z-score)
    and returns transactions tagged with anomaly risk flags and explanations.
    """
    try:
        anomalies = detect_transaction_anomalies()
        flagged_count = sum(1 for a in anomalies if a.get("is_anomaly"))
        return jsonify({
            "total_analyzed": len(anomalies),
            "flagged_count": flagged_count,
            "anomalies": anomalies
        }), 200
    except Exception as e:
        print(f"[API Anomalies Error] Anomaly detection failed: {e}")
        return jsonify({"error": f"Failed to run anomaly detection: {str(e)}"}), 500


@app.route("/api/settings", methods=["GET", "PUT"])
@auth_required
def manage_settings():
    """
    Gets or updates system settings:
    - STARTING_BALANCE
    - BALANCE_ALERT_THRESHOLD
    - GEMINI_MODEL
    """
    global STARTING_BALANCE, BALANCE_ALERT_THRESHOLD
    try:
        if request.method == "PUT":
            data = request.json or {}
            if "starting_balance" in data:
                STARTING_BALANCE = float(data["starting_balance"])
                os.environ["STARTING_BALANCE"] = str(STARTING_BALANCE)
            if "balance_alert_threshold" in data:
                BALANCE_ALERT_THRESHOLD = float(data["balance_alert_threshold"])
            if "gemini_model" in data:
                os.environ["GEMINI_MODEL"] = str(data["gemini_model"])

            # Rebuilding cashflow simulation to reflect new starting balance
            generate_historical_cashflow()

            return jsonify({
                "success": True,
                "message": "System settings updated successfully",
                "starting_balance": STARTING_BALANCE,
                "balance_alert_threshold": BALANCE_ALERT_THRESHOLD,
                "gemini_model": os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
                "current_balance": get_current_balance()
            }), 200

        # GET request
        return jsonify({
            "starting_balance": STARTING_BALANCE,
            "balance_alert_threshold": BALANCE_ALERT_THRESHOLD,
            "gemini_model": os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
            "current_balance": get_current_balance()
        }), 200
    except Exception as e:
        print(f"[API Settings Error] Settings management failed: {e}")
        return jsonify({"error": f"Failed to manage settings: {str(e)}"}), 500


@app.route("/api/evaluation/metrics", methods=["GET"])
@auth_required
def get_evaluation_metrics():
    """
    Runs quantitative system benchmarks (NLP F1-score, Forecasting MAPE, Vector Precision@K)
    and returns formatted evaluation metrics for viva & project reporting.
    """
    try:
        benchmark_data = run_full_benchmark_suite()
        return jsonify(benchmark_data), 200
    except Exception as e:
        print(f"[API Evaluation Error] Benchmark execution failed: {e}")
        return jsonify({"error": f"Failed to run quantitative evaluation: {str(e)}"}), 500


if __name__ == "__main__":
    # Ensure initial vector cases are seeded
    try:
        seed_initial_cases()
    except Exception as e:
        print(f"[Case Memory Warning] Initial seed check error: {e}")

    port = int(os.getenv("PORT", 5000))
    debug_mode = os.getenv("FLASK_ENV") == "development"
    print(f"Starting Flask server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
