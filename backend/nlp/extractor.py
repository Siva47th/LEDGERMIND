import re
from datetime import datetime

# Category keyword mappings
CATEGORY_KEYWORDS = {
    "Education": ["college", "school", "exam", "fee", "fees", "tuition", "academic", "student", "admission", "semester"],
    "Utilities": ["electricity", "eb", "power", "water", "gas", "internet", "broadband", "wifi", "network", "telecom"],
    "Software": ["aws", "cloud", "hosting", "domain", "software", "subscription", "github", "cursor", "digitalocean"],
    "Marketing": ["marketing", "ads", "advertising", "google ads", "facebook ads", "promo"],
    "Shopping": ["shopping", "store", "retail", "order", "purchase", "item", "delivery", "flipkart", "amazon", "myntra", "shipping", "sirphire", "case", "backcase", "cover"],
    "Financial": ["payment", "transfer", "bank", "cashfree", "upi", "gpay", "ref. number", "transaction id", "transaction date"],
}

# Known vendors lookup for high accuracy (optional fallback)
KNOWN_VENDORS = [
    "IFET College of Engineering",
    "Cashfree Care",
    "Cashfree Payments",
    "Cashfree",
    "Sirphire",
    "Google Cloud",
    "AWS",
    "Microsoft",
    "GitHub"
]

def clean_extracted_text(text):
    """Cleans up raw OCR text line by line."""
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    return lines

def extract_vendor(lines, raw_text):
    """
    Identifies the vendor/institution name.
    1. Checks if any known vendor exists in the text.
    2. Falls back to using the first few lines of the document,
       which typically contain the organization's letterhead/name.
    """
    # 1. Match known vendors first
    text_lower = raw_text.lower()
    if "cashfree" in text_lower:
        return "Cashfree"
    if "sirphire" in text_lower:
        return "Sirphire"
        
    for vendor in KNOWN_VENDORS:
        if vendor.lower() in text_lower:
            return vendor

    # 2. Extract from first non-empty lines
    # Filter out lines that look like status bars or are mostly numbers
    for line in lines[:5]:  # Check first 5 lines to find a valid vendor name
        # Skip lines that are status indicators (e.g. signal strength, percentages, time)
        if "%" in line or "KB/s" in line or "AM" in line or "PM" in line:
            continue
        # Exclude lines that are mostly numbers (like date or receipt numbers)
        if len(re.sub(r'[^a-zA-Z]', '', line)) > 6:
            # Clean up trailing punctuation
            clean_line = re.sub(r'[^\w\s\-\.\&]', '', line).strip()
            if clean_line:
                return clean_line
                
    return "Unknown Vendor"

def extract_date(raw_text):
    """
    Finds dates in the text and converts them to standard YYYY-MM-DD format.
    """
    # Pattern 1: DD/MM/YYYY or MM/DD/YYYY (e.g. 5/10/2026, 05/10/2026, 6-18-2026)
    date_pattern_numeric = r'\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b'
    # Pattern 2: DD Month YYYY or Month DD YYYY (e.g., 10 May 2026, 26 Apr 2026, May 10, 2026)
    # Modified to allow years that are glued to times (e.g., 20262013 or 2026,20:13)
    date_pattern_textual = r'\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*,?\s*(\d{4})'
    
    # Try textual dates first (less ambiguous)
    match_textual = re.search(date_pattern_textual, raw_text, re.IGNORECASE)
    if match_textual:
        day, month_str, year = match_textual.groups()
        try:
            # Parse month name
            dt = datetime.strptime(f"{day} {month_str[:3]} {year}", "%d %b %Y")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass

    # Try numeric dates
    match_numeric = re.search(date_pattern_numeric, raw_text)
    if match_numeric:
        part1, part2, year_str = match_numeric.groups()
        # Handle 2-digit years
        if len(year_str) == 2:
            year_str = "20" + year_str
        
        # In Indian invoices (which are standard here), dates are DD/MM/YYYY
        # Let's try parsing as DD/MM/YYYY first. If that fails (e.g. month > 12), try MM/DD/YYYY
        for fmt in ["%d/%m/%Y", "%m/%d/%Y"]:
            try:
                dt = datetime.strptime(f"{part1}/{part2}/{year_str}", fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue

    # Fallback to current date if none found (as default database value)
    return datetime.today().strftime("%Y-%m-%d")

def extract_amount(lines, raw_text):
    """
    Extracts the total invoice or transaction amount.
    Handles currency symbols (₹, $, Rs.), comma formatting (52,552.50 or 1,50,000.00), and decimals.
    1. Looks for numbers following explicit keywords like 'total amount', 'grand total', 'total', 'net amount'.
    2. As fallback, scans for the largest valid monetary value in the document.
    """
    # Regex matching currency numbers with optional commas (e.g. 52,552.50 or 50,050 or 47000.00)
    number_pattern = r'\b\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\b|\b\d+(?:\.\d{1,2})?\b'

    def parse_float(val_str):
        try:
            clean = val_str.replace(',', '').strip()
            v = float(clean)
            return v if 1.0 <= v < 10000000.0 else None
        except ValueError:
            return None

    # 1. Look for explicit TOTAL / GRAND TOTAL lines first (ignoring 'subtotal' lines)
    total_keywords = ["total amount", "grand total", "total payable", "net amount", "total:"]
    for keyword in total_keywords:
        for line in lines:
            line_clean = line.lower()
            if keyword in line_clean and "subtotal" not in line_clean and "sub total" not in line_clean:
                matches = re.findall(number_pattern, line)
                vals = [parse_float(m) for m in matches if parse_float(m) is not None]
                if vals:
                    return max(vals)

    # 2. Look for any line containing 'total' (even standalone 'TOTAL')
    for line in lines:
        line_clean = line.lower()
        if "total" in line_clean and "subtotal" not in line_clean and "sub total" not in line_clean:
            matches = re.findall(number_pattern, line)
            vals = [parse_float(m) for m in matches if parse_float(m) is not None]
            if vals:
                return max(vals)

    # 3. Look for generic keywords: 'subtotal', 'amount', 'fees', 'received', 'particulars'
    generic_keywords = ["subtotal", "sub total", "amount", "fees", "fee", "received", "particulars"]
    for keyword in generic_keywords:
        for line in lines:
            if keyword in line.lower():
                matches = re.findall(number_pattern, line)
                vals = [parse_float(m) for m in matches if parse_float(m) is not None]
                if vals:
                    return max(vals)

    # 4. Global Fallback: return maximum sensible monetary number in document
    all_matches = re.findall(number_pattern, raw_text)
    all_vals = [parse_float(m) for m in all_matches if parse_float(m) is not None]

    if all_vals:
        return max(all_vals)

    return 0.0

def classify_category(raw_text):
    """
    Classifies the invoice into a category based on keyword matches.
    Matches are done with word boundaries to avoid partial substring matching
    (e.g. avoiding 'fee' matching 'feedback' or 'eb' matching 'website').
    """
    text_lower = raw_text.lower()
    
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            pattern = rf"\b{re.escape(keyword.lower())}\b"
            if re.search(pattern, text_lower):
                return category
                
    return "Miscellaneous"

def classify_transaction_type(raw_text, vendor):
    """
    Classifies the transaction as income, expense, return_in, or return_out
    based on keyword signals in the document text.

    Classification rules:
    - Educational fee receipts, college bills, exam fees, utility bills -> expense
    - Sales invoices, supermarket bills, itemized POS receipts (Qty Rate Amount, Payment: UPI/Cash) -> income
    - Negative refund clauses ("will not be refunded", "non-refundable") -> NOT a refund
    - Explicit refund/credit notes ("refund voucher", "refund received") -> return_in
    - Default -> expense
    """
    text_lower = raw_text.lower()

    # 1. Remove disclaimer clauses that contain 'refund' in a negative context
    disclaimer_phrases = [
        "will not be refunded", "non-refundable", "non refundable",
        "no refund", "not refundable", "cannot be refunded", "fees once paid"
    ]
    cleaned_text = text_lower
    for phrase in disclaimer_phrases:
        cleaned_text = cleaned_text.replace(phrase, "")

    # 2. Check for return_out (refund given to customer)
    refund_out_keywords = ["refund given", "refund to customer", "credit note issued", "amount refunded to"]
    for keyword in refund_out_keywords:
        if keyword in cleaned_text:
            return "return_out"

    # 3. Check for return_in (refund received by user from vendor)
    refund_in_keywords = ["credit note", "refund voucher", "refund credited", "amount refunded", "refund received", "credit memo"]
    for keyword in refund_in_keywords:
        if keyword in cleaned_text:
            return "return_in"

    # 4. Explicit expense override for educational fees, utilities, hostel fees, purchase orders
    expense_keywords = [
        "fee receipt", "tuition fee", "exam fee", "college of engineering",
        "school fee", "admission fee", "hostel fee", "utility bill", "electricity bill",
        "purchase order", "vendor invoice", "payable to", "bill to:"
    ]
    for keyword in expense_keywords:
        if keyword in cleaned_text:
            return "expense"

    # 5. Income / Sales Signals (sales invoices, customer receipts, itemized retail/sales bills)
    income_keywords = [
        "payment received", "amount received", "sales invoice",
        "service invoice", "client invoice", "paid by client", "received from",
        "qty rate amount", "item qty rate", "rate amount",
        "payment: upi", "payment: cash", "payment: card", "payment: net banking",
        "thank you!", "thank you for shopping", "tax invoice", "bill of supply"
    ]
    for keyword in income_keywords:
        if keyword in cleaned_text:
            return "income"

    # Default: if the document is from a vendor to the user, it's an expense
    return "expense"


def extract_fields(raw_text):
    """
    Main extraction interface. Accepts raw text and extracts the 5 primary fields:
    - vendor (vendor_or_client)
    - amount
    - date
    - category
    - transaction_type (income / expense / return_in / return_out)
    """
    lines = clean_extracted_text(raw_text)

    vendor = extract_vendor(lines, raw_text)
    date_val = extract_date(raw_text)
    amount = extract_amount(lines, raw_text)
    category = classify_category(raw_text)
    transaction_type = classify_transaction_type(raw_text, vendor)

    return {
        "vendor": vendor,
        "amount": amount,
        "date": date_val,
        "category": category,
        "transaction_type": transaction_type
    }

if __name__ == "__main__":
    # Test on dummy text
    dummy = """
    IFET College of Engineering
    FEE RECEIPT
    Date : 10 May 2026
    Total Amount 3250.00
    Received by Online Payment
    """
    print("Testing parser with dummy text...")
    print(extract_fields(dummy))
