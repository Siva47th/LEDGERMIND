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
    # - outcome_label: System-computed tag ('healthy' / 'strained' / 'pending')
    #     For existing synthetic data: 'healthy' or 'strained' (preserved as-is)
    #     For new real uploads: 'pending' (user evaluates outcome later)
    # - user_notes: User-added notes / reasoning for the transaction
    # - user_outcome: User-set custom outcome label (e.g., 'Healthy', 'Strained', 'Profitable')
    # - outcome_date: When the user evaluated/recorded the outcome (ISO timestamp)
    # - outcome_notes: User's description of what actually happened with this spend
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
            outcome_date TEXT,
            outcome_notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    print("Transactions table verified/created successfully.")

    # ==========================================================================
    # USERS TABLE — Stores credentials with bcrypt-hashed passwords
    # ==========================================================================
    # Security Design:
    #   - password_hash stores bcrypt output (60 chars, includes salt + algo marker)
    #   - Passwords are NEVER stored in plaintext
    #   - bcrypt uses 12 rounds (2^12 = 4096 iterations) for brute-force resistance
    #   - Each password has a unique random salt (embedded in the hash)
    #   - username is UNIQUE and case-insensitive (stored lowercase)
    # ==========================================================================
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            full_name TEXT DEFAULT '',
            last_login TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    print("Users table verified/created successfully.")

    # ==========================================================================
    # AUDIT LOGS TABLE — Tamper-evident trail of financial & auth operations
    # ==========================================================================
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT DEFAULT 'transaction',
            entity_id TEXT DEFAULT '',
            details TEXT DEFAULT '',
            ip_address TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    print("Audit logs table verified/created successfully.")

    # ==========================================================================
    # TOKEN BLACKLIST TABLE — Instant revocation of tokens on logout/password change
    # ==========================================================================
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS token_blacklist (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER,
            expires_at TEXT NOT NULL,
            revoked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    print("Token blacklist table verified/created successfully.")

    # ==========================================================================
    # ADVISOR CHAT HISTORY TABLE — Persistent multi-turn reasoning logs
    # ==========================================================================
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
    print("Advisor chats table verified/created successfully.")

    # Safe migration: Add new columns if they don't exist yet (preserves existing data)
    migration_columns = [
        ("outcome_date", "TEXT"),
        ("outcome_notes", "TEXT DEFAULT ''"),
        ("user_id", "INTEGER DEFAULT 1")
    ]
    for col_name, col_type in migration_columns:
        try:
            cursor.execute(f"ALTER TABLE transactions ADD COLUMN {col_name} {col_type}")
            conn.commit()
            print(f"  [Migration] Added column '{col_name}' to transactions table.")
        except sqlite3.OperationalError:
            # Column already exists — safe to ignore
            pass
    
    # Verify database table schema
    cursor.execute("PRAGMA table_info(transactions)")
    columns = cursor.fetchall()
    print("\nTable Schema ('transactions'):")
    for col in columns:
        print(f" - {col[1]} ({col[2]})")

    # Verify users table schema
    cursor.execute("PRAGMA table_info(users)")
    user_columns = cursor.fetchall()
    print("\nTable Schema ('users'):")
    for col in user_columns:
        print(f" - {col[1]} ({col[2]})")

    conn.close()

if __name__ == "__main__":
    initialize_database()
