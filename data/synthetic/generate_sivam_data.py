"""
Sivam Traders — Synthetic Persona Transaction Data Generator

Generates a coherent 10-month transaction history for the fictional SME
"Sivam Traders" with consistent vendor names, cash balance tracking,
outcome labels, and natural-language case descriptions.

This dataset powers:
  - Dashboard (balance, invoice list, category breakdown)
  - Forecasting module (Prophet/LSTM/ARIMA training)
  - Case Memory (ChromaDB embeddings)
  - Advisor / Fusion Engine (retrieval + recommendations)
"""

import json
import os
import random
from datetime import datetime, timedelta

# ─── Configuration ─────────────────────────────────────────────────────────

STARTING_BALANCE = 250000.0
BALANCE_ALERT_THRESHOLD = 10000.0  # Below this = "strained"

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "sivam_traders_transactions.json")

# Date range: Oct 2025 → Aug 2026 (10 months)
START_DATE = datetime(2025, 10, 1)
END_DATE = datetime(2026, 8, 28)

# Seed for reproducibility
random.seed(42)

# ─── Vendor & Transaction Templates ───────────────────────────────────────

# Recurring monthly expenses
MONTHLY_RECURRING = [
    {"vendor": "Commercial Realty Trust", "amount_range": (30000, 30000), "category": "Utilities", "day": 1, "desc": "Monthly office and store lease rent"},
    {"vendor": "Tamil Nadu Electricity Board (TNEB)", "amount_range": (7500, 11000), "category": "Utilities", "day": 10, "desc": "Commercial electricity bill"},
    {"vendor": "Airtel Broadband", "amount_range": (2499, 2499), "category": "Utilities", "day": 12, "desc": "Business internet and landline"},
    {"vendor": "Payroll - Staff Salaries", "amount_range": (75000, 75000), "category": "Financial", "day": 28, "desc": "Monthly staff salary disbursement"},
]

# Quarterly expenses
QUARTERLY_EXPENSES = [
    {"vendor": "Kothari & Associates", "amount": 15000, "category": "Financial", "months": [1, 4, 7, 10], "day": 10, "desc": "GST return filing and auditor compliance review"},
]

# Real invoices from the files/ folder (integrated at their actual dates)
REAL_INVOICES = [
    {"vendor": "ABC Traders", "amount": 45000.0, "category": "Shopping", "date": "2026-03-15", "desc": "General merchandise - inventory restock", "type": "expense"},
    {"vendor": "CloudHost Technologies Pvt Ltd", "amount": 4200.0, "category": "Software", "date": "2026-06-05", "desc": "Business hosting plan - monthly subscription", "type": "expense"},
    {"vendor": "Kothari & Associates", "amount": 15000.0, "category": "Financial", "date": "2026-07-10", "desc": "GST return filing - Q1 FY26-27 and auditor compliance review", "type": "expense"},
    {"vendor": "Sharma Logistics & Freight", "amount": 7800.0, "category": "Shopping", "date": "2026-07-18", "desc": "Freight & delivery charges - stock consignment", "type": "expense"},
]

# Variable supplier / vendor expenses (randomly distributed)
VARIABLE_EXPENSES = [
    {"vendor": "ABC Traders", "amount_range": (25000, 55000), "category": "Shopping", "freq_per_month": 1.5, "desc": "Inventory restocking - general merchandise"},
    {"vendor": "Metro Cash & Carry", "amount_range": (40000, 90000), "category": "Shopping", "freq_per_month": 0.8, "desc": "Bulk FMCG and grocery inventory purchase"},
    {"vendor": "Package Craft India", "amount_range": (8000, 15000), "category": "Shopping", "freq_per_month": 0.4, "desc": "Custom printed bags and shipping boxes"},
    {"vendor": "Sharma Logistics & Freight", "amount_range": (5000, 12000), "category": "Shopping", "freq_per_month": 1.0, "desc": "Freight and delivery charges"},
    {"vendor": "CloudHost Technologies Pvt Ltd", "amount_range": (4000, 4500), "category": "Software", "freq_per_month": 1.0, "desc": "Monthly cloud hosting subscription"},
    {"vendor": "Google Workspace", "amount_range": (3200, 3600), "category": "Software", "freq_per_month": 0.33, "desc": "Business email and productivity licenses"},
    {"vendor": "Tally Solutions", "amount_range": (22000, 23000), "category": "Software", "freq_per_month": 0.1, "desc": "Tally Prime accounting software annual renewal"},
    {"vendor": "Meta Ads", "amount_range": (10000, 20000), "category": "Marketing", "freq_per_month": 0.5, "desc": "Facebook & Instagram advertising campaign"},
    {"vendor": "Google Ads", "amount_range": (15000, 30000), "category": "Marketing", "freq_per_month": 0.4, "desc": "Search engine keyword marketing campaign"},
    {"vendor": "Local Print Media", "amount_range": (5000, 10000), "category": "Marketing", "freq_per_month": 0.3, "desc": "Promotional pamphlets and newspaper inserts"},
    {"vendor": "HDFC Bank", "amount_range": (3000, 4000), "category": "Financial", "freq_per_month": 0.25, "desc": "Bank account maintenance and POS charges"},
    {"vendor": "Mineral Water Suppliers", "amount_range": (1200, 1800), "category": "Utilities", "freq_per_month": 1.0, "desc": "Monthly drinking water supply for office"},
]

# Income sources
INCOME_SOURCES = [
    {"vendor": "Walk-in Store Sales (Daily)", "amount_range": (8000, 25000), "category": "Shopping", "freq_per_month": 20, "desc": "Daily retail store sales revenue"},
    {"vendor": "Apex Enterprises (Client)", "amount_range": (80000, 180000), "category": "Financial", "freq_per_month": 0.3, "desc": "Wholesale goods dispatch payment from corporate client"},
    {"vendor": "Star Retailers (Client)", "amount_range": (40000, 80000), "category": "Shopping", "freq_per_month": 0.5, "desc": "Wholesale order invoice payment from retail chain"},
    {"vendor": "Online Portal Sales", "amount_range": (5000, 15000), "category": "Shopping", "freq_per_month": 4, "desc": "E-commerce platform order settlement"},
]

# SME Capital & Equipment Expenses (Store & Warehouse)
SME_CAPITAL_EXPENSES = [
    {"vendor": "Croma Commercial POS Systems", "amount": 35000, "month": 12, "day": 5, "desc": "Barcode scanner and touch POS billing counter setup", "category": "Shopping"},
    {"vendor": "National Steel Racks & Shelving", "amount": 42000, "month": 6, "day": 15, "desc": "Heavy-duty warehouse storage racks and store display shelves", "category": "Shopping"},
]

# Special festival season events
FESTIVAL_EVENTS = [
    {"vendor": "Festival Inventory Bulk Purchase", "amount_range": (100000, 140000), "category": "Shopping", "month": 10, "day_range": (15, 25), "desc": "Pre-Diwali bulk inventory stocking", "type": "expense"},
    {"vendor": "Meta Ads (Diwali Campaign)", "amount_range": (25000, 40000), "category": "Marketing", "month": 10, "day_range": (20, 28), "desc": "Diwali festive promotion advertising campaign", "type": "expense"},
    {"vendor": "Diwali Season Sales Surge", "amount_range": (60000, 120000), "category": "Shopping", "month": 11, "day_range": (1, 15), "desc": "Festival season retail sales revenue surge", "type": "income"},
    {"vendor": "Pongal Festival Sales", "amount_range": (30000, 60000), "category": "Shopping", "month": 1, "day_range": (10, 18), "desc": "Pongal festive retail sales revenue", "type": "income"},
]

# ─── Helper Functions ─────────────────────────────────────────────────────

def random_date_in_month(year, month, day_range=None):
    """Returns a random date within a given month."""
    import calendar
    max_day = calendar.monthrange(year, month)[1]
    if day_range:
        lo, hi = day_range
        hi = min(hi, max_day)
        day = random.randint(lo, hi)
    else:
        day = random.randint(1, max_day)
    return datetime(year, month, day)


def compute_upcoming_dues(transactions, current_date, days_ahead=30):
    """Computes total upcoming expenses in the next N days from current date."""
    cutoff = current_date + timedelta(days=days_ahead)
    total = 0.0
    for txn in transactions:
        txn_date = datetime.strptime(txn["date"], "%Y-%m-%d")
        if current_date < txn_date <= cutoff and txn["type"] == "expense":
            total += txn["amount"]
    return round(total, 2)


def generate_case_description(txn, balance_before, balance_after, outcome):
    """Generates a natural-language case description for ChromaDB embedding."""
    type_word = "Paid" if txn["type"] == "expense" else "Received"
    direction = "to" if txn["type"] == "expense" else "from"
    
    desc = (
        f"{type_word} ₹{txn['amount']:,.2f} for {txn['desc']} {direction} {txn['vendor']}. "
        f"Cash balance was ₹{balance_before:,.2f} before, ₹{balance_after:,.2f} after. "
    )
    
    if outcome == "strained":
        desc += "Cash reserves fell below safety threshold, creating financial strain. "
    else:
        desc += "No delayed payments or cash flow issues observed. "
    
    desc += f"Outcome: {outcome}."
    return desc


# ─── Main Generator ───────────────────────────────────────────────────────

def generate_sivam_traders_data():
    """Generates the complete Sivam Traders transaction dataset."""
    
    all_transactions = []
    
    # 1. Add monthly recurring expenses across all months
    current = START_DATE
    while current <= END_DATE:
        year, month = current.year, current.month
        
        for rec in MONTHLY_RECURRING:
            import calendar
            max_day = calendar.monthrange(year, month)[1]
            day = min(rec["day"], max_day)
            amount = random.uniform(*rec["amount_range"]) if rec["amount_range"][0] != rec["amount_range"][1] else rec["amount_range"][0]
            
            txn_date = datetime(year, month, day)
            if START_DATE <= txn_date <= END_DATE:
                all_transactions.append({
                    "vendor": rec["vendor"],
                    "amount": round(amount, 2),
                    "category": rec["category"],
                    "type": "expense",
                    "date": txn_date.strftime("%Y-%m-%d"),
                    "desc": rec["desc"]
                })
        
        # Move to next month
        if month == 12:
            current = datetime(year + 1, 1, 1)
        else:
            current = datetime(year, month + 1, 1)
    
    # 2. Add quarterly expenses
    current = START_DATE
    while current <= END_DATE:
        year, month = current.year, current.month
        for qe in QUARTERLY_EXPENSES:
            if month in qe["months"]:
                import calendar
                max_day = calendar.monthrange(year, month)[1]
                day = min(qe["day"], max_day)
                txn_date = datetime(year, month, day)
                if START_DATE <= txn_date <= END_DATE:
                    all_transactions.append({
                        "vendor": qe["vendor"],
                        "amount": qe["amount"],
                        "category": qe["category"],
                        "type": "expense",
                        "date": txn_date.strftime("%Y-%m-%d"),
                        "desc": qe["desc"]
                    })
        if month == 12:
            current = datetime(year + 1, 1, 1)
        else:
            current = datetime(year, month + 1, 1)
    
    # 3. Add real invoices from files/
    for inv in REAL_INVOICES:
        inv_date = datetime.strptime(inv["date"], "%Y-%m-%d")
        if START_DATE <= inv_date <= END_DATE:
            all_transactions.append({
                "vendor": inv["vendor"],
                "amount": inv["amount"],
                "category": inv["category"],
                "type": inv["type"],
                "date": inv["date"],
                "desc": inv["desc"]
            })
    
    # 4. Add variable expenses (distributed randomly across months)
    current = START_DATE
    while current <= END_DATE:
        year, month = current.year, current.month
        
        for ve in VARIABLE_EXPENSES:
            # Skip if we already have a real invoice for this vendor in this month
            existing = [t for t in all_transactions 
                       if t["vendor"] == ve["vendor"] 
                       and t["date"].startswith(f"{year}-{month:02d}")]
            
            num_occurrences = int(ve["freq_per_month"])
            if random.random() < (ve["freq_per_month"] - num_occurrences):
                num_occurrences += 1
            
            # Subtract existing entries for this vendor
            num_occurrences = max(0, num_occurrences - len(existing))
            
            for _ in range(num_occurrences):
                txn_date = random_date_in_month(year, month)
                if START_DATE <= txn_date <= END_DATE:
                    amount = round(random.uniform(*ve["amount_range"]), 2)
                    all_transactions.append({
                        "vendor": ve["vendor"],
                        "amount": amount,
                        "category": ve["category"],
                        "type": "expense",
                        "date": txn_date.strftime("%Y-%m-%d"),
                        "desc": ve["desc"]
                    })
        
        if month == 12:
            current = datetime(year + 1, 1, 1)
        else:
            current = datetime(year, month + 1, 1)
    
    # 5. Add income sources (distributed randomly)
    current = START_DATE
    while current <= END_DATE:
        year, month = current.year, current.month
        
        for inc in INCOME_SOURCES:
            num_occurrences = int(inc["freq_per_month"])
            if random.random() < (inc["freq_per_month"] - num_occurrences):
                num_occurrences += 1
            
            for _ in range(num_occurrences):
                txn_date = random_date_in_month(year, month)
                if START_DATE <= txn_date <= END_DATE:
                    amount = round(random.uniform(*inc["amount_range"]), 2)
                    all_transactions.append({
                        "vendor": inc["vendor"],
                        "amount": amount,
                        "category": inc["category"],
                        "type": "income",
                        "date": txn_date.strftime("%Y-%m-%d"),
                        "desc": inc["desc"]
                    })
        
        if month == 12:
            current = datetime(year + 1, 1, 1)
        else:
            current = datetime(year, month + 1, 1)
    
    # 6. Add SME capital & equipment expenses
    for cap in SME_CAPITAL_EXPENSES:
        year = START_DATE.year if cap["month"] >= START_DATE.month else START_DATE.year + 1
        txn_date = datetime(year, cap["month"], cap["day"])
        if START_DATE <= txn_date <= END_DATE:
            all_transactions.append({
                "vendor": cap["vendor"],
                "amount": cap["amount"],
                "category": cap["category"],
                "type": "expense",
                "date": txn_date.strftime("%Y-%m-%d"),
                "desc": cap["desc"]
            })
    
    # 7. Add festival season events
    for fest in FESTIVAL_EVENTS:
        year = START_DATE.year if fest["month"] >= START_DATE.month else START_DATE.year + 1
        txn_date = random_date_in_month(year, fest["month"], fest.get("day_range"))
        if START_DATE <= txn_date <= END_DATE:
            amount = round(random.uniform(*fest["amount_range"]), 2)
            all_transactions.append({
                "vendor": fest["vendor"],
                "amount": amount,
                "category": fest["category"],
                "type": fest["type"],
                "date": txn_date.strftime("%Y-%m-%d"),
                "desc": fest["desc"]
            })
    
    # 8. Add a few refund transactions
    refunds = [
        {"vendor": "ABC Traders (Vendor Refund)", "amount": 5500.0, "category": "Shopping", "type": "return_in",
         "date": "2026-04-10", "desc": "Partial refund for damaged goods in last shipment"},
        {"vendor": "Customer Return - Retail", "amount": 2800.0, "category": "Shopping", "type": "return_out",
         "date": "2026-02-20", "desc": "Refund issued to walk-in customer for defective product"},
    ]
    for ref in refunds:
        ref_date = datetime.strptime(ref["date"], "%Y-%m-%d")
        if START_DATE <= ref_date <= END_DATE:
            all_transactions.append(ref)
    
    # ─── Sort chronologically ────────────────────────────────────────────
    all_transactions.sort(key=lambda x: x["date"])
    
    # ─── Compute running balance, outcome labels, case descriptions ──────
    running_balance = STARTING_BALANCE
    final_dataset = []
    
    for txn in all_transactions:
        balance_before = round(running_balance, 2)
        
        if txn["type"] in ("income", "return_in"):
            running_balance += txn["amount"]
        else:
            running_balance -= txn["amount"]
        
        balance_after = round(running_balance, 2)
        
        # Compute outcome label
        outcome = "healthy" if balance_after >= BALANCE_ALERT_THRESHOLD else "strained"
        
        # Compute upcoming dues
        upcoming_dues = compute_upcoming_dues(all_transactions, datetime.strptime(txn["date"], "%Y-%m-%d"))
        
        # Generate case description
        case_desc = generate_case_description(txn, balance_before, balance_after, outcome)
        
        final_dataset.append({
            "vendor": txn["vendor"],
            "amount": txn["amount"],
            "category": txn["category"],
            "type": txn["type"],
            "date": txn["date"],
            "cash_balance_before": balance_before,
            "cash_balance_after": balance_after,
            "upcoming_dues_next_30_days": upcoming_dues,
            "outcome_label": outcome,
            "case_description": case_desc
        })
    
    return final_dataset


def main():
    print("=" * 70)
    print("SIVAM TRADERS — SYNTHETIC PERSONA DATA GENERATOR")
    print("=" * 70)
    
    dataset = generate_sivam_traders_data()
    
    # Write to JSON
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(dataset, f, indent=2, ensure_ascii=False)
    
    # Summary statistics
    expenses = [t for t in dataset if t["type"] == "expense"]
    incomes = [t for t in dataset if t["type"] == "income"]
    returns_in = [t for t in dataset if t["type"] == "return_in"]
    returns_out = [t for t in dataset if t["type"] == "return_out"]
    strained = [t for t in dataset if t["outcome_label"] == "strained"]
    
    unique_vendors = set(t["vendor"] for t in dataset)
    categories = set(t["category"] for t in dataset)
    
    print(f"\nGenerated {len(dataset)} transactions -> {OUTPUT_PATH}")
    print(f"Date range: {dataset[0]['date']} -> {dataset[-1]['date']}")
    print(f"\nBreakdown:")
    print(f"  Expenses:    {len(expenses):>4}  (Total: Rs.{sum(t['amount'] for t in expenses):>12,.2f})")
    print(f"  Income:      {len(incomes):>4}  (Total: Rs.{sum(t['amount'] for t in incomes):>12,.2f})")
    print(f"  Returns In:  {len(returns_in):>4}  (Total: Rs.{sum(t['amount'] for t in returns_in):>12,.2f})")
    print(f"  Returns Out: {len(returns_out):>4}  (Total: Rs.{sum(t['amount'] for t in returns_out):>12,.2f})")
    print(f"\nUnique vendors: {len(unique_vendors)}")
    print(f"Categories: {', '.join(sorted(categories))}")
    print(f"Strained outcomes: {len(strained)} / {len(dataset)}")
    print(f"Final balance: Rs.{dataset[-1]['cash_balance_after']:,.2f}")
    print("=" * 70)


if __name__ == "__main__":
    main()
