import os
import sys
import sqlite3
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

# Ensure the parent directory is in the path for importing modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from ocr.pipeline import extract_text_from_file
from nlp.extractor import extract_fields

# Load environment variables
load_dotenv()

app = Flask(__name__)
# Enable CORS for frontend connectivity
CORS(app)

DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), DB_NAME)
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_uploads")

# Create temporary upload folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

STARTING_BALANCE = 100000.0  # Rs. 1,00,000.00
BALANCE_ALERT_THRESHOLD = 10000.0  # Rs. 10,000.00

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def check_db_health():
    """Checks if the SQLite database is reachable and the invoices table exists."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'")
        table_exists = cursor.fetchone() is not None
        conn.close()
        return "connected" if table_exists else "invoices_table_missing"
    except Exception as e:
        print(f"Database health check failed: {e}")
        return "error"

@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint returning backend status and database health."""
    db_status = check_db_health()
    status_code = 200 if db_status == "connected" else 500
    return jsonify({
        "status": "ok" if db_status == "connected" else "unhealthy",
        "message": "FinSense API is up and running",
        "database": db_status,
        "environment": os.getenv("FLASK_ENV", "production")
    }), status_code

@app.route("/api/dashboard/stats", methods=["GET"])
def get_dashboard_stats():
    """
    Exposes aggregated statistics for the frontend dashboard cards and charts:
    - Current cash balance (last running balance)
    - Total expenses (sum of all amounts)
    - Total number of invoices processed
    - Financial risk status (outcome of the latest transaction)
    - Category spend breakdown (Recharts format)
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # 1. Get running statistics (most recent chronological invoice determines balance/risk)
        cursor.execute("""
            SELECT cash_balance_at_time, outcome_label 
            FROM invoices 
            ORDER BY date DESC, id DESC 
            LIMIT 1
        """)
        latest = cursor.fetchone()
        
        # 2. Get total invoices count and total amount spent
        cursor.execute("SELECT COUNT(*), SUM(amount) FROM invoices")
        count_row = cursor.fetchone()
        
        total_invoices = count_row[0] if count_row else 0
        total_spent = count_row[1] if count_row and count_row[1] is not None else 0.0
        
        current_balance = latest["cash_balance_at_time"] if latest else STARTING_BALANCE
        risk_status = latest["outcome_label"] if latest else "healthy"
        
        # 3. Get category spend breakdown
        cursor.execute("SELECT category, SUM(amount) as total FROM invoices GROUP BY category")
        categories_rows = cursor.fetchall()
        
        # Convert category rows to format suitable for Recharts pie chart: [{ name: 'Education', value: 34500.00 }, ...]
        category_spend = []
        for cat in categories_rows:
            category_spend.append({
                "name": cat["category"],
                "value": cat["total"]
            })
            
        conn.close()
        
        return jsonify({
            "current_balance": current_balance,
            "total_spent": total_spent,
            "total_invoices": total_invoices,
            "risk_status": risk_status,
            "category_spend": category_spend
        }), 200
        
    except Exception as e:
        return jsonify({"error": f"Failed to fetch stats: {e}"}), 500

@app.route("/api/invoices", methods=["GET"])
def get_invoices():
    """
    Fetches invoice records from SQLite.
    Supports filtering by category and search keyword (vendor name).
    Sorts by date descending (newest first).
    """
    try:
        category = request.args.get("category")
        search = request.args.get("search")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        query = "SELECT * FROM invoices WHERE 1=1"
        params = []
        
        if category and category != "All":
            query += " AND category = ?"
            params.append(category)
            
        if search:
            query += " AND vendor LIKE ?"
            params.append(f"%{search}%")
            
        # Sort by date descending
        query += " ORDER BY date DESC, id DESC"
        
        cursor.execute(query, params)
        rows = cursor.fetchall()
        
        invoices = []
        for row in rows:
            invoices.append({
                "id": row["id"],
                "vendor": row["vendor"],
                "amount": row["amount"],
                "category": row["category"],
                "date": row["date"],
                "cash_balance_at_time": row["cash_balance_at_time"],
                "outcome_label": row["outcome_label"],
                "created_at": row["created_at"]
            })
            
        conn.close()
        return jsonify(invoices), 200
        
    except Exception as e:
        return jsonify({"error": f"Failed to fetch invoices: {e}"}), 500

@app.route("/api/invoices/upload", methods=["POST"])
def upload_invoice():
    """
    Handles file upload, triggers OCR + NLP, calculates running balance, 
    persists in database, and returns the parsed result.
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
        
        # 2. Run NLP Field Extraction
        parsed_fields = extract_fields(extracted_text)
        vendor = parsed_fields["vendor"]
        amount = parsed_fields["amount"]
        date_str = parsed_fields["date"]
        category = parsed_fields["category"]
        
        # 3. Calculate running ledger balance
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Get the balance from the most chronologically recent invoice in the database
        cursor.execute("SELECT cash_balance_at_time FROM invoices ORDER BY date DESC, id DESC LIMIT 1")
        latest_row = cursor.fetchone()
        
        latest_balance = latest_row["cash_balance_at_time"] if latest_row else STARTING_BALANCE
        new_balance = latest_balance - amount
        
        # Set outcome label
        outcome = "healthy" if new_balance >= BALANCE_ALERT_THRESHOLD else "strained"
        
        # 4. Save to database
        cursor.execute("""
            INSERT INTO invoices (vendor, amount, category, date, cash_balance_at_time, outcome_label)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (vendor, amount, category, date_str, new_balance, outcome))
        
        conn.commit()
        
        # Fetch the newly created invoice row ID
        new_id = cursor.lastrowid
        conn.close()
        
        # Clean up temporary uploaded file
        try:
            os.remove(temp_path)
            print(f"[API Upload] Cleaned up temporary file: {temp_path}")
        except Exception as err:
            print(f"[API Upload] Failed to delete temp file: {err}")
            
        return jsonify({
            "id": new_id,
            "vendor": vendor,
            "amount": amount,
            "category": category,
            "date": date_str,
            "cash_balance_at_time": new_balance,
            "outcome_label": outcome,
            "raw_text_preview": extracted_text[:300] + "..." if len(extracted_text) > 300 else extracted_text
        }), 201
        
    except Exception as e:
        print(f"[API Upload Error] Ingestion failed: {e}")
        return jsonify({"error": f"Failed to ingest invoice: {str(e)}"}), 500

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug_mode = os.getenv("FLASK_ENV") == "development"
    print(f"Starting Flask server on port {port}...")
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
