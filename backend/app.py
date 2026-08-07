import os
import sqlite3
from flask import Flask, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
# Enable CORS for all routes to facilitate frontend development on different ports
CORS(app)

DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), DB_NAME)

def check_db_health():
    """Checks if the SQLite database is reachable and the invoices table exists."""
    try:
        conn = sqlite3.connect(DB_PATH)
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
    """
    Health check endpoint returning backend status and database health.
    Useful for verification during setup and CI.
    """
    db_status = check_db_health()
    
    status_code = 200
    if db_status != "connected":
        status_code = 500
        
    return jsonify({
        "status": "ok" if db_status == "connected" else "unhealthy",
        "message": "FinSense API is up and running",
        "database": db_status,
        "environment": os.getenv("FLASK_ENV", "production")
    }), status_code

if __name__ == "__main__":
    # Run Flask server locally on port 5000
    port = int(os.getenv("PORT", 5000))
    debug_mode = os.getenv("FLASK_ENV") == "development"
    print(f"Starting Flask server on port {port} (debug={debug_mode})...")
    app.run(host="0.0.0.0", port=port, debug=debug_mode)
