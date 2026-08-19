import sqlite3
import os

DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), DB_NAME)

def initialize_database():
    """
    Initializes the SQLite database schema for FinSense.
    Creates the 'transactions' table to store all financial records —
    both income and expenses — with a transaction_type field that determines
    how each record affects the live-calculated balance.

    Balance is NEVER stored in the database. It is always calculated live:
        balance = starting_balance + Σ(income) + Σ(return_in) - Σ(expense) - Σ(return_out)
    """
    print(f"Connecting to database at: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Create the transactions table
    # Columns:
    # - id: Unique auto-incrementing key
    # - vendor_or_client: Name of the vendor (expense) or client (income)
    # - amount: Transaction amount (always positive; direction is determined by transaction_type)
    # - transaction_type: 'income' | 'expense' | 'return_in' | 'return_out'
    #     income     = money coming in (client payments, sales)
    #     expense    = money going out (vendor invoices, operating costs)
    #     return_in  = refund received (money back to you)
    #     return_out = refund given (money back to customer)
    # - category: Spend/income category (e.g., Education, Software, Sales Revenue)
    # - date: Transaction date in YYYY-MM-DD format
    # - outcome_label: System-computed tag ('healthy' / 'strained' / null)
    # - user_notes: User-added notes / reasoning for the transaction
    # - user_outcome: User-set custom outcome label (e.g., 'Productive', 'Wasteful')
    # - created_at: Timestamp of entry creation in database
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vendor_or_client TEXT NOT NULL,
            amount REAL NOT NULL,
            transaction_type TEXT NOT NULL CHECK(transaction_type IN ('income','expense','return_in','return_out')),
            category TEXT NOT NULL,
            date TEXT NOT NULL,
            outcome_label TEXT,
            user_notes TEXT,
            user_outcome TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    print("Transactions table verified/created successfully.")
    
    # Verify database table schema
    cursor.execute("PRAGMA table_info(transactions)")
    columns = cursor.fetchall()
    print("\nTable Schema ('transactions'):")
    for col in columns:
        print(f" - {col[1]} ({col[2]})")

    conn.close()

if __name__ == "__main__":
    initialize_database()
