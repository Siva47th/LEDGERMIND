import os
import csv
import random
import sqlite3
import pandas as pd
from datetime import datetime, timedelta

DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), DB_NAME)
CSV_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "synthetic")
CSV_PATH = os.path.join(CSV_DIR, "historical_cashflow.csv")

# Read starting balance from environment (single source of truth)
STARTING_BALANCE = float(os.environ.get("STARTING_BALANCE", 250000.0))

def generate_historical_cashflow(days=365):
    """
    Generates a daily cash flow time series for the past 'days' days,
    overlaying actual transactions from finsense.db on their corresponding dates.

    Transactions are signed correctly based on transaction_type:
    - income / return_in  → adds to daily revenue
    - expense / return_out → adds to daily expense
    """
    os.makedirs(CSV_DIR, exist_ok=True)

    # 1. Fetch actual transactions from the SQLite database (with transaction_type)
    actual_transactions = {}
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT date, amount, vendor_or_client, transaction_type, user_notes FROM transactions")
            rows = cursor.fetchall()
            for date_str, amount, vendor, txn_type, user_notes in rows:
                if date_str not in actual_transactions:
                    actual_transactions[date_str] = []
                actual_transactions[date_str].append({
                    "amount": amount,
                    "vendor": vendor,
                    "transaction_type": txn_type,
                    "user_notes": user_notes if user_notes else ""
                })
            conn.close()
            print(f"[Data Gen] Loaded {len(rows)} actual transactions from database.")
        except Exception as e:
            print(f"[Data Gen] Warning: Could not read database transactions: {e}")
    else:
        print(f"[Data Gen] Warning: Database not found at {DB_PATH}. Generating baseline synthetic data only.")

    # 2. Build timeline
    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=days-1)

    current_date = start_date
    current_balance = STARTING_BALANCE
    records = []

    # Seed random for repeatability
    random.seed(42)

    print(f"[Data Gen] Simulating cashflow from {start_date} to {end_date}...")

    while current_date <= end_date:
        date_str = current_date.strftime("%Y-%m-%d")

        # Initialize daily variables
        daily_revenue = 0.0
        daily_expense = 0.0
        recurring_expense = 0.0
        actual_income = 0.0
        actual_expense = 0.0
        description_parts = []

        # A. Baseline Daily Revenue (sales, service income)
        # Small business baseline: average 8000 daily sales
        sales_rev = random.normalvariate(8000.0, 2000.0)
        sales_rev = max(0.0, sales_rev) # No negative sales
        daily_revenue += sales_rev

        # B. Weekly Business Cycle (higher weekend sales)
        weekday = current_date.weekday()
        if weekday in [4, 5]: # Friday, Saturday
            daily_revenue += random.uniform(3000.0, 8000.0) # weekend spike

        # C. Baseline Daily Expenses (inventory, shipping, packaging)
        ops_exp = random.normalvariate(5000.0, 1000.0)
        ops_exp = max(0.0, ops_exp)
        daily_expense += ops_exp

        # D. Monthly Recurring Corporate Expenses
        day_of_month = current_date.day
        if day_of_month == 1:
            recurring_expense += 30000.0  # Office Rent
            description_parts.append("Monthly Office Rent")
        elif day_of_month == 10:
            recurring_expense += 8000.0   # Utility bills
            description_parts.append("Monthly Utilities")
        elif day_of_month == 28:
            recurring_expense += 75000.0  # Payroll salaries
            description_parts.append("Monthly Payroll Salaries")

        # E. Overlay Live Actual Transactions uploaded by User
        # Now correctly signed based on transaction_type
        if date_str in actual_transactions:
            vendors = []
            for txn in actual_transactions[date_str]:
                note_suffix = f" ({txn['user_notes']})" if txn.get("user_notes") else ""
                type_label = txn["transaction_type"]

                if type_label in ("income", "return_in"):
                    # Money coming IN — add to revenue
                    actual_income += txn["amount"]
                    vendors.append(f"+{txn['vendor']}{note_suffix} [{type_label}]")
                    print(f"[Data Gen] Overlaying actual INCOME: +Rs. {txn['amount']:.2f} on {date_str} ({txn['vendor']})")
                else:
                    # Money going OUT — add to expenses
                    actual_expense += txn["amount"]
                    vendors.append(f"-{txn['vendor']}{note_suffix} [{type_label}]")
                    print(f"[Data Gen] Overlaying actual EXPENSE: -Rs. {txn['amount']:.2f} on {date_str} ({txn['vendor']})")

            description_parts.append(f"User Transactions: {', '.join(vendors)}")

        # Compile description
        description = "; ".join(description_parts) if description_parts else "Daily retail operations"

        # Net balance calculation (income adds, expenses subtract)
        total_income = daily_revenue + actual_income
        total_expense = daily_expense + recurring_expense + actual_expense
        net_change = total_income - total_expense
        current_balance += net_change

        records.append({
            "date": date_str,
            "balance": round(current_balance, 2),
            "revenue": round(daily_revenue + actual_income, 2),
            "expense": round(daily_expense, 2),
            "recurring": round(recurring_expense, 2),
            "actual_invoice": round(actual_expense, 2),
            "actual_income": round(actual_income, 2),
            "description": description
        })

        current_date += timedelta(days=1)

    # Write to CSV
    df = pd.DataFrame(records)
    df.to_csv(CSV_PATH, index=False)
    print(f"[Data Gen] Cashflow simulation complete! Saved {len(df)} records with audit columns to: {CSV_PATH}")

if __name__ == "__main__":
    generate_historical_cashflow()
