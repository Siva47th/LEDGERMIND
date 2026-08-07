import os
import sqlite3
import sys
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
    print("FINSENSE - DATABASE SYNC & running BALANCE ENGINE")
    print("=" * 60)
    print(f"Reading text files from: {extracted_text_dir}")
    print(f"Database target:        {DB_PATH}")
    print("=" * 60)
    
    if not os.path.exists(extracted_text_dir):
        print(f"Error: Extracted text directory '{extracted_text_dir}' does not exist.")
        return
        
    text_files = [f for f in os.listdir(extracted_text_dir) if f.endswith("_raw.txt")]
    
    if not text_files:
        print("No raw text files found in 'invoices/extracted_text/'. Run test_ocr.py first.")
        return
        
    extracted_records = []
    
    for filename in text_files:
        file_path = os.path.join(extracted_text_dir, filename)
        with open(file_path, "r", encoding="utf-8") as f:
            raw_text = f.read()
            
        # Parse fields
        fields = extract_fields(raw_text)
        fields["source_file"] = filename
        extracted_records.append(fields)
        print(f"Parsed '{filename}' -> Date: {fields['date']}, Amt: Rs.{fields['amount']:.2f}, Vendor: {fields['vendor']}")
        
    # Sort records chronologically (by date ascending) to accurately compute running cash balance
    # Date string format is YYYY-MM-DD, which naturally sorts correctly alphabetically
    extracted_records.sort(key=lambda x: x["date"])
    
    print("\nSorting records chronologically...")
    
    # Establish connection to SQLite
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Clear old records to start fresh for development/testing
    cursor.execute("DELETE FROM invoices")
    print("Cleared existing rows in 'invoices' table to prevent duplication.")
    
    running_balance = STARTING_BALANCE
    inserted_count = 0
    
    print(f"\nProcessing ledger (Starting Balance: Rs.{STARTING_BALANCE:.2f}):")
    print("-" * 90)
    print(f"{'Date':<12} | {'Vendor':<28} | {'Amount':<10} | {'New Balance':<12} | {'Outcome':<9} | {'Category'}")
    print("-" * 90)
    
    for record in extracted_records:
        date_str = record["date"]
        vendor = record["vendor"]
        amount = record["amount"]
        category = record["category"]
        
        # Calculate new cash balance at this time
        # Balance = previous balance - expense amount
        running_balance -= amount
        
        # Decide the business outcome health label
        outcome = "healthy"
        if running_balance < BALANCE_ALERT_THRESHOLD:
            outcome = "strained"
            
        # Insert into invoices table
        # Schema: id, vendor, amount, category, date, cash_balance_at_time, outcome_label, created_at
        cursor.execute("""
            INSERT INTO invoices (vendor, amount, category, date, cash_balance_at_time, outcome_label)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (vendor, amount, category, date_str, running_balance, outcome))
        
        print(f"{date_str:<12} | {vendor[:28]:<28} | Rs.{amount:<9.2f} | Rs.{running_balance:<11.2f} | {outcome:<9} | {category}")
        inserted_count += 1
        
    conn.commit()
    conn.close()
    
    print("-" * 90)
    print(f"Successfully processed and stored {inserted_count} records in 'invoices' table.")
    print("=" * 60)

if __name__ == "__main__":
    parse_and_store_invoices()
