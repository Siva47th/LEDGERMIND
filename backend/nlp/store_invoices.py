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

# Read starting balance from environment (single source of truth)
# Falls back to 250000 if not set — but in production this comes from .env
STARTING_BALANCE = float(os.environ.get("STARTING_BALANCE", 250000.0))
BALANCE_ALERT_THRESHOLD = 10000.0  # Alert threshold for business strain (₹10,000.00)

def parse_and_store_transactions():
    """
    Bootstraps the database from OCR extracted text files if empty,
    and recomputes system outcome labels for all transactions based on
    live-calculated running balance.

    Balance is NEVER stored in the database — it's always calculated from:
        balance = starting_balance + Σ(income) + Σ(return_in) - Σ(expense) - Σ(return_out)
    """
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    extracted_text_dir = os.path.join(base_dir, "invoices", "extracted_text")

    print("=" * 60)
    print("FINSENSE - DATABASE SYNC & OUTCOME LABEL ENGINE")
    print("=" * 60)
    print(f"Database target:        {DB_PATH}")
    print("=" * 60)

    # Establish connection to SQLite
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 1. Fetch current transactions from the database
    cursor.execute("""
        SELECT id, vendor_or_client, amount, transaction_type, category, date, user_outcome 
        FROM transactions
    """)
    db_rows = cursor.fetchall()

    records = []

    if len(db_rows) > 0:
        print(f"Loaded {len(db_rows)} transaction records from database.")
        for row in db_rows:
            records.append({
                "id": row["id"],
                "vendor_or_client": row["vendor_or_client"],
                "amount": row["amount"],
                "transaction_type": row["transaction_type"],
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
                    INSERT INTO transactions (vendor_or_client, amount, transaction_type, category, date, outcome_label)
                    VALUES (?, ?, ?, ?, ?, 'healthy')
                """, (fields["vendor"], fields["amount"], fields["transaction_type"], fields["category"], fields["date"]))
                conn.commit()
                new_id = cursor.lastrowid
                records.append({
                    "id": new_id,
                    "vendor_or_client": fields["vendor"],
                    "amount": fields["amount"],
                    "transaction_type": fields["transaction_type"],
                    "category": fields["category"],
                    "date": fields["date"]
                })
                print(f"Parsed & bootstrapped '{filename}' -> Type: {fields['transaction_type']}, Date: {fields['date']}, Amt: Rs.{fields['amount']:.2f}")

    if not records:
        print("No transactions to process.")
        conn.close()
        return

    # Sort chronologically (date ascending)
    records.sort(key=lambda x: x["date"])

    # Recompute running balance and system outcome labels
    # Balance is calculated live: starting + Σ(in) - Σ(out)
    running_balance = STARTING_BALANCE
    print(f"\nRecalculating running balances (Starting Balance: Rs.{STARTING_BALANCE:.2f}):")
    print("-" * 100)
    print(f"{'Date':<12} | {'Type':<10} | {'Vendor/Client':<28} | {'Amount':<10} | {'Balance':<12} | {'Outcome':<9} | {'Category'}")
    print("-" * 100)

    for record in records:
        row_id = record["id"]
        date_str = record["date"]
        vendor = record["vendor_or_client"]
        amount = record["amount"]
        category = record["category"]
        txn_type = record["transaction_type"]

        # Apply transaction to running balance based on type
        if txn_type in ("income", "return_in"):
            running_balance += amount
        else:  # expense, return_out
            running_balance -= amount

        # System-computed outcome based on financial health thresholds
        system_outcome = "healthy" if running_balance >= BALANCE_ALERT_THRESHOLD else "strained"

        # Update system outcome label — user_outcome is NEVER touched here
        cursor.execute("""
            UPDATE transactions 
            SET outcome_label = ? 
            WHERE id = ?
        """, (system_outcome, row_id))

        # Display user_outcome if set, otherwise show system outcome
        display_outcome = record.get("user_outcome") or system_outcome
        type_indicator = "+" if txn_type in ("income", "return_in") else "-"
        print(f"{date_str:<12} | {txn_type:<10} | {vendor[:28]:<28} | {type_indicator}Rs.{amount:<8.2f} | Rs.{running_balance:<11.2f} | {display_outcome:<14} | {category}")

    conn.commit()
    conn.close()
    print("=" * 60)
    print("DATABASE SYNCHRONIZATION COMPLETE")
    print("=" * 60)

# Keep backward compatibility — old code may call parse_and_store_invoices()
parse_and_store_invoices = parse_and_store_transactions

if __name__ == "__main__":
    parse_and_store_transactions()
