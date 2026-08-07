import re
from datetime import datetime

# Category keyword mappings
CATEGORY_KEYWORDS = {
    "Education": ["college", "school", "exam", "fee", "fees", "tuition", "academic", "student", "admission", "semester"],
    "Utilities": ["electricity", "eb", "power", "water", "gas", "internet", "broadband", "wifi", "network", "telecom"],
    "Software": ["aws", "cloud", "hosting", "domain", "software", "subscription", "github", "cursor", "digitalocean"],
    "Marketing": ["marketing", "ads", "advertising", "google ads", "facebook ads", "promo"],
    "Financial": ["payment", "transfer", "bank", "cashfree", "upi", "gpay", "ref. number", "transaction id", "transaction date"],
}

# Known vendors lookup for high accuracy (optional fallback)
KNOWN_VENDORS = [
    "IFET College of Engineering",
    "Cashfree Payments",
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
    for vendor in KNOWN_VENDORS:
        if vendor.lower() in raw_text.lower():
            return vendor

    # 2. Extract from first non-empty lines
    # Filter out lines that look like date, invoice/receipt number or labels
    for line in lines[:3]:
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
    date_pattern_textual = r'\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b'
    
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
    1. Looks for numbers following keyword patterns like 'total amount', 'total', 'grand total', 'amount'.
    2. As a fallback, scans for the largest decimal value in the document,
       excluding obvious non-currency numbers like transaction references or enrollment IDs.
    """
    amount_keywords = ["total amount", "total", "amount", "fees", "fee", "particulars amount", "received"]
    
    # Find all float values (e.g. 3250.00, 45.50)
    # We look for standard monetary numbers (decimals with 2 digits)
    decimal_numbers = re.findall(r'\b\d+(?:\.\d{2})\b', raw_text)
    
    if decimal_numbers:
        # Convert to float and filter out extremely large numbers that are likely IDs
        candidates = []
        for num_str in decimal_numbers:
            val = float(num_str)
            if 1.0 <= val < 1000000.0:  # Sensible range for transactional bills
                candidates.append(val)
                
        # 1. Look for keywords in context
        for keyword in amount_keywords:
            for line in lines:
                if keyword.lower() in line.lower():
                    # Find any numeric match in this specific line
                    line_decimals = re.findall(r'\b\d+(?:\.\d{2})\b', line)
                    if line_decimals:
                        return float(line_decimals[0])
                        
        # 2. Fallback: if no keyword matched, return the maximum decimal number
        # On a invoice, the grand total is usually the largest printed monetary value
        if candidates:
            return max(candidates)

    # 3. Last resort: look for any integer numbers that might represent the total
    integers = re.findall(r'\b\d{3,6}\b', raw_text)
    if integers:
        return float(max([int(i) for i in integers]))

    return 0.0

def classify_category(raw_text):
    """
    Classifies the invoice into a category based on keyword matches.
    """
    text_lower = raw_text.lower()
    
    for category, keywords in CATEGORY_KEYWORDS.items():
        for keyword in keywords:
            if keyword.lower() in text_lower:
                return category
                
    return "Miscellaneous"

def extract_fields(raw_text):
    """
    Main extraction interface. Accepts raw text and extracts the 4 primary fields.
    """
    lines = clean_extracted_text(raw_text)
    
    vendor = extract_vendor(lines, raw_text)
    date_val = extract_date(raw_text)
    amount = extract_amount(lines, raw_text)
    category = classify_category(raw_text)
    
    return {
        "vendor": vendor,
        "amount": amount,
        "date": date_val,
        "category": category
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
