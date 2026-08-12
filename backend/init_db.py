import sqlite3
import os

DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), DB_NAME)

def initialize_database():
    """
    Initializes the SQLite database schema for FinSense.
    Creates the 'invoices' table with appropriate fields to store structured data 
    extracted from invoices.
    """
    print(f"Connecting to database at: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create the invoices table
    # Columns:
    # - id: Unique auto-incrementing key
    # - vendor: Name of the seller/vendor
    # - amount: Total invoice amount (decimal/real)
    # - category: Expense category (e.g., Marketing, Software, Utilities, Rent)
    # - date: Document date in YYYY-MM-DD format
    # - cash_balance_at_time: Starting or recorded balance of the company at the invoice date
    # - outcome_label: Tag indicating the outcome of paying this invoice (e.g., "healthy", "strained")
    # - user_notes: User notes / reasoning for the spend
    # - created_at: Timestamp of entry creation in database
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vendor TEXT NOT NULL,
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            date TEXT NOT NULL,
            cash_balance_at_time REAL NOT NULL,
            outcome_label TEXT NOT NULL,
            user_notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    print("Invoices table verified/created successfully.")
    
    # Run migrations to ensure existing tables get the user_notes column
    cursor.execute("PRAGMA table_info(invoices)")
    columns = [col[1] for col in cursor.fetchall()]
    if "user_notes" not in columns:
        cursor.execute("ALTER TABLE invoices ADD COLUMN user_notes TEXT")
        conn.commit()
        print("Added 'user_notes' column to 'invoices' table migration successfully.")
    
    # Optional: Verify database table exists
    cursor.execute("PRAGMA table_info(invoices)")
    columns = cursor.fetchall()
    print("\nTable Schema ('invoices'):")
    for col in columns:
        print(f" - {col[1]} ({col[2]})")

    conn.close()

if __name__ == "__main__":
    initialize_database()
