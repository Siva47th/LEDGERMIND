import os
import sys
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime
from flask import Flask, jsonify, request, Response
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

# Load environment variables
load_dotenv()

app = Flask(__name__)
# Enable CORS for frontend connectivity
CORS(app, expose_headers=["Content-Disposition"])

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


@app.route("/api/dashboard/stats", methods=["GET"])
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

        conn.close()

        return jsonify({
            "current_balance": current_balance,
            "total_income": total_income,
            "total_expenses": total_expenses,
            "total_transactions": total_transactions,
            "risk_status": risk_status,
            "category_spend": category_spend
        }), 200

    except Exception as e:
        return jsonify({"error": f"Failed to fetch stats: {e}"}), 500


@app.route("/api/transactions", methods=["GET"])
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
                "created_at": row["created_at"]
            })

        conn.close()
        return jsonify(transactions), 200

    except Exception as e:
        return jsonify({"error": f"Failed to fetch transactions: {e}"}), 500


@app.route("/api/transactions/upload", methods=["POST"])
def upload_transaction():
    """
    Handles file upload, triggers OCR + NLP (including transaction type classification),
    persists in database, and returns the parsed result.
    Balance is NOT stored — it's always calculated live.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "Empty filename"}), 400

    try:
        # Save file to temp upload folder securely
        filename = secure_filename(file.filename)
        temp_path = os.path.join(UPLOAD_FOLDER, filename)
        file.save(temp_path)
        print(f"[API Upload] File saved to {temp_path}")

        # 1. Run OCR/Direct PDF Ingestion
        extracted_text = extract_text_from_file(temp_path)

        # 2. Run NLP Field Extraction (now includes transaction_type classification)
        parsed_fields = extract_fields(extracted_text)
        vendor_or_client = parsed_fields["vendor"]
        amount = parsed_fields["amount"]
        date_str = parsed_fields["date"]
        category = parsed_fields["category"]
        transaction_type = parsed_fields["transaction_type"]

        # 3. Check for duplicates (same vendor/client, amount, date, transaction_type)
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

        # 4. Compute system outcome based on balance AFTER this transaction
        current_bal = get_current_balance()
        if transaction_type in ("income", "return_in"):
            projected_balance = current_bal + amount
        else:
            projected_balance = current_bal - amount
        outcome_label = "healthy" if projected_balance >= BALANCE_ALERT_THRESHOLD else "strained"

        # 5. Save to database
        cursor.execute("""
            INSERT INTO transactions (vendor_or_client, amount, transaction_type, category, date, outcome_label)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (vendor_or_client, amount, transaction_type, category, date_str, outcome_label))
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

        # 7. Trigger forecasting dataset regeneration
        print("[API Upload] Rebuilding daily cashflow simulation...")
        generate_historical_cashflow()

        # Clean up temporary uploaded file
        try:
            os.remove(temp_path)
            print(f"[API Upload] Cleaned up temporary file: {temp_path}")
        except Exception as err:
            print(f"[API Upload] Failed to delete temp file: {err}")

        # 7. Return the parsed result with live-calculated balance
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


@app.route("/api/transactions/manual", methods=["POST"])
def add_manual_transaction():
    """
    Accepts a manual transaction entry (income or expense):
    - Inserts it directly into SQLite with the correct transaction_type
    - Triggers cashflow timeline regeneration
    - Returns the record with live-calculated balance
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing payload"}), 400

        vendor_or_client = data.get("vendor_or_client", "Cash Transaction")
        amount = float(data.get("amount", 0.0))
        date_str = data.get("date")
        category = data.get("category", "Miscellaneous")
        transaction_type = data.get("transaction_type", "expense")
        user_notes = data.get("user_notes", "")

        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")

        if amount <= 0:
            return jsonify({"error": "Amount must be positive"}), 400

        # Validate transaction_type
        valid_types = ("income", "expense", "return_in", "return_out")
        if transaction_type not in valid_types:
            return jsonify({"error": f"Invalid transaction_type. Must be one of: {valid_types}"}), 400

        # Compute system outcome based on projected balance
        current_bal = get_current_balance()
        if transaction_type in ("income", "return_in"):
            projected_balance = current_bal + amount
        else:
            projected_balance = current_bal - amount
        outcome_label = "healthy" if projected_balance >= BALANCE_ALERT_THRESHOLD else "strained"

        # 1. Save to database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO transactions (vendor_or_client, amount, transaction_type, category, date, outcome_label, user_notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (vendor_or_client, amount, transaction_type, category, date_str, outcome_label, user_notes))
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

        # 3. Re-trigger forecasting CSV regeneration
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
            add_case_memory(
                txn_id=txn["id"],
                vendor_or_client=txn.get("vendor_or_client", ""),
                amount=float(txn.get("amount", 0.0)),
                transaction_type=txn.get("transaction_type", "expense"),
                category=txn.get("category", "Miscellaneous"),
                notes=user_notes,
                outcome=outcome_val
            )

        print(f"[API Notes] Updating notes for ID {txn_id}. Rebuilding daily cashflow & synced ChromaDB...")
        generate_historical_cashflow()

        return jsonify({"success": True, "message": "Transaction notes updated and synced to case memory successfully"}), 200
    except Exception as e:
        print(f"[API Notes Error] Failed to update notes: {e}")
        return jsonify({"error": f"Failed to save transaction notes: {str(e)}"}), 500


@app.route("/api/transactions/<int:txn_id>/outcome", methods=["PUT"])
def update_transaction_outcome(txn_id):
    """
    Updates the user_outcome label for a transaction.
    This is a custom user-set label (e.g., 'Productive', 'Wasteful', 'Necessary')
    that is separate from the system-computed outcome_label, and syncs to ChromaDB.
    """
    try:
        data = request.json
        if not data:
            return jsonify({"error": "Missing payload"}), 400

        user_outcome = data.get("user_outcome", "")

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE transactions SET user_outcome = ? WHERE id = ?", (user_outcome, txn_id))
        conn.commit()

        cursor.execute("SELECT * FROM transactions WHERE id = ?", (txn_id,))
        row = cursor.fetchone()
        conn.close()

        if row:
            txn = dict(row)
            outcome_val = user_outcome if user_outcome else txn.get("outcome_label", "healthy")
            add_case_memory(
                txn_id=txn["id"],
                vendor_or_client=txn.get("vendor_or_client", ""),
                amount=float(txn.get("amount", 0.0)),
                transaction_type=txn.get("transaction_type", "expense"),
                category=txn.get("category", "Miscellaneous"),
                notes=txn.get("user_notes", ""),
                outcome=outcome_val
            )

        print(f"[API Outcome] Updated user_outcome for transaction #{txn_id} to '{user_outcome}' and synced to ChromaDB")
        return jsonify({"success": True, "message": f"Outcome label updated to '{user_outcome}' and indexed in case memory"}), 200
    except Exception as e:
        print(f"[API Outcome Error] Failed to update outcome: {e}")
        return jsonify({"error": f"Failed to update outcome label: {str(e)}"}), 500


@app.route("/api/transactions/<int:txn_id>/type", methods=["PUT"])
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
def delete_transaction(txn_id):
    """
    Deletes a transaction record from SQLite by ID.
    Triggers daily cashflow timeline regeneration.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM transactions WHERE id = ?", (txn_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({"error": f"Transaction #{txn_id} not found"}), 404

        cursor.execute("DELETE FROM transactions WHERE id = ?", (txn_id,))
        conn.commit()
        conn.close()

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
def advisor_query():
    """
    RAG Fusion Reasoning Engine Endpoint:
    Accepts payload: { "query": "Should I purchase 5 laptops for Rs. 75,000?" }
    Retrieves vector case memory, forecasts cashflow, applies adaptive blending,
    and returns LLM explainable recommendation.
    """
    try:
        data = request.json
        if not data or not data.get("query"):
            return jsonify({"error": "Missing 'query' string in request body"}), 400

        user_query = data.get("query")
        top_k = int(data.get("top_k", 4))
        language = data.get("language", "en")

        result = generate_advisor_recommendation(user_query=user_query, top_k=top_k, language=language)
        return jsonify(result), 200
    except Exception as e:
        print(f"[API Advisor Error] Fusion reasoning failed: {e}")
        return jsonify({"error": f"Advisor fusion engine failed: {str(e)}"}), 500


@app.route("/api/tts", methods=["GET"])
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
