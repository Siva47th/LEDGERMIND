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

STARTING_BALANCE = 250000.0

def generate_historical_cashflow(days=365):
    """
    Generates a daily cash flow time series for the past 'days' days,
    overlaying actual uploaded invoices from finsense.db on their corresponding dates.
    """
    os.makedirs(CSV_DIR, exist_ok=True)
    
    # 1. Fetch actual invoices from the SQLite database
    actual_invoices = {}
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute("SELECT date, amount FROM invoices")
            rows = cursor.fetchall()
            for date_str, amount in rows:
                # Group multiple invoices on the same day
                actual_invoices[date_str] = actual_invoices.get(date_str, 0.0) + amount
            conn.close()
            print(f"[Data Gen] Loaded {len(rows)} actual invoices from database.")
        except Exception as e:
            print(f"[Data Gen] Warning: Could not read database invoices: {e}")
    else:
        print(f"[Data Gen] Warning: Database not found at {DB_PATH}. Generating baseline synthetic data only.")

    # 2. Build time timeline
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
        
        # Initialize day's change
        daily_change = 0.0
        
        # A. Baseline Daily Revenue (sales, service income)
        # Small business baseline: average 8000 daily sales
        daily_revenue = random.normalvariate(8000.0, 2000.0)
        daily_revenue = max(0.0, daily_revenue) # No negative sales
        daily_change += daily_revenue
        
        # B. Baseline Daily Expenses (inventory, shipping, packaging)
        daily_expense = random.normalvariate(5000.0, 1000.0)
        daily_expense = max(0.0, daily_expense)
        daily_change -= daily_expense
        
        # C. Weekly Business Cycle (higher weekend sales, weekend payouts)
        weekday = current_date.weekday()
        if weekday in [4, 5]: # Friday, Saturday
            daily_change += random.uniform(3000.0, 8000.0) # weekend spike
            
        # D. Monthly Recurring Corporate Expenses
        day_of_month = current_date.day
        if day_of_month == 1:
            daily_change -= 30000.0  # Office Rent
        elif day_of_month == 10:
            daily_change -= 8000.0   # Utility bills
        elif day_of_month == 28:
            daily_change -= 75000.0  # Payroll salaries
            
        # E. Overlay Live Actual Invoices uploaded by User
        if date_str in actual_invoices:
            # Subtract the actual invoice amount since invoices represent expenses/outflow
            invoice_expense = actual_invoices[date_str]
            daily_change -= invoice_expense
            print(f"[Data Gen] Overlaying actual invoice expense: -Rs. {invoice_expense:.2f} on {date_str}")
            
        # Update balance
        current_balance += daily_change
        
        records.append({
            "date": date_str,
            "balance": round(current_balance, 2)
        })
        
        current_date += timedelta(days=1)
        
    # Write to CSV
    df = pd.DataFrame(records)
    df.to_csv(CSV_PATH, index=False)
    print(f"[Data Gen] Cashflow simulation complete! Saved {len(df)} records to: {CSV_PATH}")

if __name__ == "__main__":
    generate_historical_cashflow()
