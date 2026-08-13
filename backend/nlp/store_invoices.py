import os
import sqlite3
import sys
import pandas as pd
from datetime import datetime

# Add workspace directory to python path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.nlp.extractor import extract_fields

DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), DB_NAME)

STARTING_BALANCE = 250000.0  # Assumed starting balance of the business (₹2,50,000.00)
BALANCE_ALERT_THRESHOLD = 10000.0  # Alert threshold for business strain (₹10,000.00)

def parse_and_store_invoices():
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    extracted_text_dir = os.path.join(base_dir, "invoices", "extracted_text")
    
    print("=" * 60)
    print("FINSENSE - DATABASE SYNC & RUNNING BALANCE ENGINE")
    print("=" * 60)
    print(f"Database target:        {DB_PATH}")
    print("=" * 60)
    
    # Establish connection to SQLite
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # 1. Fetch current invoices from the database
    cursor.execute("SELECT id, vendor, amount, category, date, user_outcome FROM invoices")
    db_rows = cursor.fetchall()
    
    extracted_records = []
    
    if len(db_rows) > 0:
        print(f"Loaded {len(db_rows)} invoice records from database ledger.")
        for row in db_rows:
            extracted_records.append({
                "id": row["id"],
                "vendor": row["vendor"],
                "amount": row["amount"],
                "category": row["category"],
                "date": row["date"],
                "user_outcome": row["user_outcome"] if row["user_outcome"] else ""
            })
    else:
        print("Database is empty. Bootstrapping from OCR raw text files...")
        if os.path.exists(extracted_text_dir):
            text_files = [f for f in os.listdir(extracted_text_dir) if f.endswith("_raw.txt")]
            for filename in text_files:
                file_path = os.path.join(extracted_text_dir, filename)
                with open(file_path, "r", encoding="utf-8") as f:
                    raw_text = f.read()
                fields = extract_fields(raw_text)
                cursor.execute("""
                    INSERT INTO invoices (vendor, amount, category, date, cash_balance_at_time, outcome_label)
                    VALUES (?, ?, ?, ?, 0.0, 'healthy')
                """, (fields["vendor"], fields["amount"], fields["category"], fields["date"]))
                conn.commit()
                new_id = cursor.lastrowid
                extracted_records.append({
                    "id": new_id,
                    "vendor": fields["vendor"],
                    "amount": fields["amount"],
                    "category": fields["category"],
                    "date": fields["date"]
                })
                print(f"Parsed & bootstrapped '{filename}' -> Date: {fields['date']}, Amt: Rs.{fields['amount']:.2f}")

    if not extracted_records:
        print("No invoices to process.")
        conn.close()
        return
        
    # Sort chronologically (date ascending)
    extracted_records.sort(key=lambda x: x["date"])
    
    # Load daily cashflow balances if CSV exists
    csv_balances = {}
    csv_path = os.path.join(base_dir, "data", "synthetic", "historical_cashflow.csv")
    if os.path.exists(csv_path):
        try:
            df = pd.read_csv(csv_path)
            for _, row in df.iterrows():
                csv_balances[str(row["date"])] = float(row["balance"])
        except Exception as e:
            print(f"Failed to read historical cashflow CSV: {e}")
            
    running_balance = STARTING_BALANCE
    print(f"\nRecalculating running balances (Starting Balance: Rs.{STARTING_BALANCE:.2f}):")
    print("-" * 90)
    print(f"{'Date':<12} | {'Vendor':<28} | {'Amount':<10} | {'New Balance':<12} | {'Outcome':<9} | {'Category'}")
    print("-" * 90)
    
    for record in extracted_records:
        row_id = record["id"]
        date_str = record["date"]
        vendor = record["vendor"]
        amount = record["amount"]
        category = record["category"]
        
        # Get balance from CSV if available, otherwise fallback to old running balance calculation
        if date_str in csv_balances:
            invoice_balance = csv_balances[date_str]
        else:
            running_balance -= amount
            invoice_balance = running_balance
        
        # System-computed outcome based on financial health thresholds
        system_outcome = "healthy" if invoice_balance >= BALANCE_ALERT_THRESHOLD else "strained"
        
        # Update running balance and system outcome — user_outcome is NEVER touched here
        cursor.execute("""
            UPDATE invoices 
            SET cash_balance_at_time = ?, outcome_label = ? 
            WHERE id = ?
        """, (invoice_balance, system_outcome, row_id))
        
        # Display user_outcome if set, otherwise show system outcome
        display_outcome = record.get("user_outcome") or system_outcome
        running_balance = invoice_balance
        print(f"{date_str:<12} | {vendor[:28]:<28} | Rs.{amount:<9.2f} | Rs.{running_balance:<11.2f} | {display_outcome:<14} | {category}")
        
    conn.commit()
    conn.close()
    print("=" * 60)
    print("DATABASE SYNCHRONIZATION COMPLETE")
    print("=" * 60)

if __name__ == "__main__":
    parse_and_store_invoices()
