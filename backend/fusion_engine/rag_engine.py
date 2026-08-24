import os
import sys
import json
import sqlite3
import urllib.request
import urllib.parse
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from case_memory.vector_store import query_similar_cases
from forecasting.engine import get_forecasts

DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), DB_NAME)
STARTING_BALANCE = float(os.environ.get("STARTING_BALANCE", 250000.0))
BALANCE_ALERT_THRESHOLD = 10000.0


def get_current_balance():
    """Calculates current live balance from SQLite transactions."""
    if not os.path.exists(DB_PATH):
        return STARTING_BALANCE

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            COALESCE(SUM(CASE WHEN transaction_type IN ('income', 'return_in') THEN amount ELSE 0 END), 0) as total_in,
            COALESCE(SUM(CASE WHEN transaction_type IN ('expense', 'return_out') THEN amount ELSE 0 END), 0) as total_out
        FROM transactions
    """)
    row = cursor.fetchone()
    conn.close()

    total_in = row[0] if row else 0.0
    total_out = row[1] if row else 0.0
    return STARTING_BALANCE + total_in - total_out


def call_gemini_rest_api(api_key, system_instruction, prompt_text):
    """
    Calls Google Gemini REST API directly.
    Works robustly across Python versions without C-extension protobuf conflicts.
    """
    preferred_model = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
    models_to_try = [
        preferred_model,
        "gemini-1.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash-lite"
    ]
    # Remove duplicates preserving order
    seen = set()
    models_to_try = [m for m in models_to_try if not (m in seen or seen.add(m))]

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_instruction}]
        },
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt_text}]
            }
        ],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json"
        }
    }

    json_bytes = json.dumps(payload).encode("utf-8")

    for model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
        req = urllib.request.Request(
            url,
            data=json_bytes,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                candidates = resp_data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        print(f"[RAG Engine] Successfully invoked Gemini via REST ({model})")
                        return parts[0].get("text", "")
        except Exception as e:
            print(f"[RAG Engine] REST API call failed for '{model}': {e}")
            continue

    return None


def normalize_search_query(user_query, api_key=None):
    """
    LLM-Powered Semantic Query Rewriter:
    Uses Gemini LLM (or smart fallback) to convert ANY natural language query
    (Tamil, English, Tanglish, informal, shorthand) into a clean, canonical
    English semantic search query optimized for ChromaDB vector memory retrieval.
    """
    if not api_key:
        api_key = os.getenv("GEMINI_API_KEY")

    if api_key:
        system_prompt = (
            "You are a semantic query rewriting engine for vector database retrieval. "
            "Convert the user's input (in English, Tamil, Tanglish, or any phrasing) into a concise 1-sentence "
            "canonical English search query highlighting the transaction domain, item/service, category, and intent. "
            "Respond ONLY with the rewritten English search text."
        )
        try:
            rewritten = call_gemini_rest_api(api_key, system_prompt, f"User Input: \"{user_query}\"")
            if rewritten and len(rewritten.strip()) > 3:
                clean_rewritten = rewritten.strip().strip('"').strip("'")
                print(f"[RAG Engine] Semantic LLM Query Rewrite: '{user_query}' -> '{clean_rewritten}'")
                return f"{clean_rewritten} {user_query}"
        except Exception as e:
            print(f"[RAG Engine] LLM query rewrite warning: {e}")

    # Fallback heuristic normalization
    search_text = user_query
    if any('\u0b80' <= char <= '\u0bff' for char in user_query):
        tamil_map = {
            "காலேஜ்": "college", "ஃபீஸ்": "fees tuition", "பையனுக்கு": "son child family",
            "கட்டலாமா": "pay spend fee", "லேப்டாப்": "laptop computer", "வாடகை": "rent lease",
            "கணினி": "computer", "விளம்பரம்": "advertising marketing", "கட்டணம்": "fee payment"
        }
        augmented = [eng for word, eng in tamil_map.items() if word in user_query]
        if augmented:
            search_text = f"{user_query} {' '.join(augmented)}"
        else:
            search_text = f"{user_query} college tuition fees expense"

    return search_text


def translate_vendor_to_tamil(vendor):
    if not vendor:
        return "முந்தைய நிறுவனம்"
    v_map = {
        "Anna University Fees": "அண்ணா பல்கலைக்கழக கட்டணம்",
        "IFET College of Engineering": "ஐ.எஃப்.ஈ.டி பொறியியல் கல்லூரி",
        "Dell India": "டெல் கணினி நிறுவனம்",
        "Croma Electronics": "க்ரோமா எலக்ட்ரானிக்ஸ்",
        "HP Store": "ஹெச்பி கணினி நிறுவனம்",
        "Apple Store": "ஆப்பிள் விற்பனையகம்",
        "Amazon Web Services": "அமேசான் வெப் சர்வீசஸ்",
        "Google Workspace": "கூகுள் வொர்க்ஸ்பேஸ்",
        "Tally Solutions": "டேலி கணக்கு மென்பொருள்",
        "Adobe Systems": "அடோப் மென்பொருள் நிறுவனம்",
        "Canva Pro": "கேன்வா வடிவமைப்பு சேவை",
        "Tamil Nadu Electricity Board (TNEB)": "தமிழ்நாடு மின்சார வாரியம்",
        "Airtel Broadband": "ஏர்டெல் இணைய சேவை",
        "Commercial Realty Trust": "வணிக கட்டிட வாடகை",
        "Kothari & Associates (CA)": "கோத்தாரி தணிக்கை அலுவலகம்",
        "Legal Counsel Firm": "சட்ட ஆலோசகர் கட்டணம்",
        "HDFC Bank": "எச்டிஎஃப்சி வங்கி",
        "Metro Cash & Carry": "மெட்ரோ மொத்த விற்பனையகம்",
        "Meta Ads": "மெட்டா விளம்பர சேவை",
        "Google Ads": "கூகுள் விளம்பர சேவை",
        "Sri Lakshmi Supermarket": "ஸ்ரீ லக்ஷ்மி சூப்பர் மார்க்கெட்",
        "Vinyl_laptops": "வினில் மடிக்கணினிகள்",
        "AWS Cloud": "ஏபிடபிள்யூஎஸ் மேகக்கணி சேவை"
    }
    return v_map.get(vendor, vendor)


def translate_category_to_tamil(cat):
    c_map = {
        "Education": "கல்வி",
        "Shopping": "பொருட்கள் வாங்குதல்",
        "Software": "மென்பொருள்",
        "Utilities": "அத்தியாவசிய பயன்பாடுகள்",
        "Marketing": "விளம்பரம்",
        "Financial": "நிதி சேவை",
        "Miscellaneous": "இதர செலவு"
    }
    return c_map.get(cat, cat)


def translate_outcome_to_tamil(outcome):
    o = str(outcome).lower()
    if o in ["strained", "strained_balance"]:
        return "ரொக்க நெருக்கடி நிலை"
    if o in ["healthy", "healthy_balance"]:
        return "ஆரோக்கியமான நிதி நிலை"
    if o == "productive":
        return "பயனுள்ள முதலீடு"
    if o == "necessary":
        return "அவசியமான செலவு"
    if o == "wasteful":
        return "வீண் செலவு"
    return "ஆரோக்கியமான நிலை"


def translate_notes_to_tamil(notes):
    if not notes:
        return ""
    n_lower = notes.lower()
    if "tuition" in n_lower or "college" in n_lower or "degree" in n_lower or "son" in n_lower:
        return "மகன் படிப்புக்காக கல்லூரி கட்டணம் செலுத்தியதால் தற்காலிக நிதி நெருக்கடி ஏற்பட்டது"
    if "laptop" in n_lower or "developer" in n_lower or "computer" in n_lower:
        return "தொழில்நுட்ப பயன்பாட்டிற்காக புதிய கணினி வாங்கப்பட்டது"
    if "electricity" in n_lower or "tneb" in n_lower:
        return "மாதாந்திர மின்சார கட்டணம் செலுத்தப்பட்டது"
    if "internet" in n_lower or "broadband" in n_lower:
        return "அலுவலக இணைய சேவை கட்டணம் செலுத்தப்பட்டது"
    if "ads" in n_lower or "campaign" in n_lower:
        return "வாடிக்கையாளர்களை பெற விளம்பரம் செய்யப்பட்டது"
    if "printer" in n_lower or "scanner" in n_lower:
        return "அலுவலக ரசீது மற்றும் அச்சு இயந்திரம் வாங்கப்பட்டது"
    return notes


def generate_advisor_recommendation(user_query, top_k=4, language="en"):
    """
    RAG Fusion Engine Main Entry Point:
    1. Retrieves top K similar past case memories from ChromaDB using LLM Semantic Query Rewriting
    2. Fetches live cash balance & 30-day forecast trajectory
    3. Calculates Adaptive Blending confidence weight
    4. Constructs structured prompt for Gemini API (supporting English & Tamil)
    5. Calls Gemini model to generate explainable financial advice
    """
    api_key = os.getenv("GEMINI_API_KEY")

    # 1. Retrieve Similar Cases from ChromaDB Vector Store with LLM Semantic Query Rewriting
    try:
        search_query = normalize_search_query(user_query, api_key=api_key)
        retrieved_cases = query_similar_cases(query_text=search_query, top_k=top_k)
    except Exception as e:
        print(f"[RAG Engine] Vector search warning: {e}")
        retrieved_cases = []

    # 2. Fetch Financial Context
    current_balance = get_current_balance()

    forecast_summary = "Forecast unavailable"
    try:
        forecast_data = get_forecasts()
        prophet_30d = forecast_data.get("prophet", [])
        if prophet_30d:
            end_forecast_balance = prophet_30d[-1].get("balance", current_balance)
            min_forecast_balance = min(row.get("balance", current_balance) for row in prophet_30d)
            forecast_summary = (
                f"30-day projected end balance: Rs.{end_forecast_balance:,.2f}. "
                f"Lowest projected point in 30 days: Rs.{min_forecast_balance:,.2f}."
            )
    except Exception as e:
        print(f"[RAG Engine] Forecast fetch warning: {e}")

    # 3. Calculate Adaptive Blending Weight
    num_cases = len(retrieved_cases)
    blend_weight = min(num_cases / 5.0, 1.0)

    # Format retrieved cases for prompt
    cases_text_list = []
    for idx, c in enumerate(retrieved_cases, 1):
        vendor = c.get('vendor_or_client', c.get('metadata', {}).get('vendor_or_client', 'Unknown'))
        amount = c.get('amount', c.get('metadata', {}).get('amount', 0.0))
        tx_type = c.get('transaction_type', c.get('metadata', {}).get('transaction_type', 'expense'))
        outcome = c.get('outcome', c.get('metadata', {}).get('outcome', 'unknown'))
        notes = c.get('notes', c.get('metadata', {}).get('notes', ''))
        sim_score = c.get('similarity_score', 0)

        cases_text_list.append(
            f"Case #{idx}: Vendor/Client={vendor}, Amount=Rs.{amount:,.2f}, Type={tx_type}, "
            f"HISTORICAL OUTCOME STATE={outcome.upper()}, Notes/Lesson={notes}, Similarity Score={sim_score:.1f}%."
        )
    formatted_cases = "\n".join(cases_text_list) if cases_text_list else "No similar past cases found."

    # Auto-detect Tamil script or explicit language parameter
    is_tamil_query = any('\u0b80' <= char <= '\u0bff' for char in user_query)
    if is_tamil_query or language == "ta":
        language = "ta"

    # Language Specific Instructions
    lang_instruction = ""
    if language == "ta":
        lang_instruction = (
            "CRITICAL 100% PURE TAMIL REQUIREMENT (ZERO ENGLISH WORDS): The user query is in TAMIL script. The user DOES NOT KNOW A SINGLE WORD OF ENGLISH. "
            "THEREFORE, EVERY SINGLE WORD of 'explanation', 'key_factors' array items, and 'suggested_action' MUST BE IN 100% PURE TAMIL SCRIPT. "
            "ABSOLUTELY NO ENGLISH WORDS ALLOWED IN THE OUTPUT (no English categories like '[Education]', no English outcomes like 'STRAINED', no English vendor names like 'Anna University Fees', and no English note text). "
            "TRANSLATE ALL VENDOR NAMES INTO PURE TAMIL SCRIPT (e.g. 'Anna University Fees' -> 'அண்ணா பல்கலைக்கழக கட்டணம்', 'Dell India' -> 'டெல் கணினி நிறுவனம்', 'IFET College' -> 'ஐ.எஃப்.ஈ.டி கல்லூரி'), "
            "TRANSLATE ALL CATEGORIES INTO PURE TAMIL (e.g. Education -> 'கல்வி', Shopping -> 'பொருட்கள் வாங்குதல்', Software -> 'மென்பொருள்'), "
            "TRANSLATE ALL OUTCOMES INTO PURE TAMIL (e.g. STRAINED -> 'ரொக்க நெருக்கடி நிலை', HEALTHY -> 'ஆரோக்கியமான நிதி நிலை'), "
            "AND TRANSLATE ALL HISTORICAL NOTES INTO NATURAL TAMIL SENTENCES. "
            "CRITICAL TTS FORMATTING: Do NOT use hyphens before Tamil suffixes (write '65000க்கு' or 'அறுபத்தைந்தாயிரத்துக்கு' instead of '65,000-க்கு'). Write numbers clearly without hyphens so text-to-speech engines pronounce amounts naturally without saying 'minus'. "
            "Keep 'verdict' strictly as one of ['Recommended', 'Proceed with Caution', 'Not Recommended'] and keep 'estimated_post_balance' as a number."
        )

    # 4. Construct System & User Prompt for Gemini
    system_instruction = (
        "You are FinSense AI, an expert small-business financial advisor. "
        "You analyze business spending and revenue proposals against live cash balance, past decision history (case memory), "
        "and 30-day predictive forecasts. You provide clear, grounded, non-jargon financial advice."
    )

    # Parse expected amount from query
    parsed_amount = extract_amount_from_query(user_query, api_key=api_key)
    expected_post_bal = current_balance - parsed_amount

    parsed_amt_str = f"{parsed_amount:,.2f}"
    exp_post_bal_str = f"{expected_post_bal:,.2f}"
    curr_bal_str = f"{current_balance:,.2f}"
    alert_thresh_str = f"{BALANCE_ALERT_THRESHOLD:,.2f}"
    blend_wt_str = f"{blend_weight:.2f}"

    prompt = f"""
USER PROPOSAL / QUERY:
"{user_query}"

EXTRACTED PROPOSAL DETAILS:
- Parsed Numerical Transaction Outlay: Rs. {parsed_amt_str}
- Estimated Post-Transaction Reserve: Rs. {exp_post_bal_str}

LIVE FINANCIAL CONTEXT:
- Current Live Cash Balance: Rs. {curr_bal_str}
- Safety Alert Threshold: Rs. {alert_thresh_str}
- Cash Flow Forecast Summary: {forecast_summary}

PAST CASE MEMORY (Retrieved via Cosine Similarity from ChromaDB):
{formatted_cases}

ADAPTIVE BLENDING WEIGHT: {blend_wt_str} (1.00 means high historical grounding; 0.00 means generic rules).

CRITICAL GROUNDING INSTRUCTIONS:
Retrieved Past Case Memories from ChromaDB vector memory are provided above. YOU MUST ALWAYS EXPLICITLY CITE AND COMPARE THE USER PROPOSAL AGAINST THESE RETRIEVED PAST CASES in both your 'explanation' and 'key_factors':
1. Identify the most relevant past case from the retrieved list (e.g. Croma Electronics, Dell India, HP Store, IFET College, etc.).
2. EXPLICITLY MENTION THE PAST VENDOR NAME, PAST AMOUNT, AND HISTORICAL OUTCOME STATE (HEALTHY / STRAINED) in your 'explanation' and 'key_factors'.
   - In Tamil responses, translate ALL vendor names, categories, and outcomes into 100% pure Tamil script (e.g., 'முன்பு அண்ணா பல்கலைக்கழக கட்டணம் [கல்வி] நிறுவனத்தில் ரூ. 45,000 செலவிட்ட போது...').
   - In English responses, cite the exact past case (e.g., 'Comparing this with past Croma Electronics expense of Rs. 28,000 which resulted in a HEALTHY state...').
3. Explain what lesson was learned from that past expenditure and why it supports or warns against the current proposal.
4. Combine that historical case comparison with your live balance and 30-day forecast trajectory to form your final verdict.

{lang_instruction}

INSTRUCTIONS:
Analyze the user proposal and respond in STRICT JSON format with EXACTLY these keys:
{{
  "verdict": "Recommended | Proceed with Caution | Not Recommended",
  "explanation": "Detailed 2-3 sentence explanation explaining the reasoning, explicitly referencing the past vendor/case memory, historical outcome, and live balance.",
  "key_factors": ["Point 1 (explicitly citing past case vendor name and historical outcome)", "Point 2 (live balance check)", "Point 3 (forecast trajectory)"],
  "estimated_post_balance": 0.0,
  "risk_level": "Low | Medium | High",
  "suggested_action": "Actionable next step advice for the business owner"
}}
"""

    # 5. Call Gemini REST API
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[RAG Engine] Warning: GEMINI_API_KEY missing in environment.")
        return fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight)

    response_text = call_gemini_rest_api(api_key, system_instruction, prompt)

    if not response_text:
        print("[RAG Engine] All Gemini model invocations failed. Falling back to heuristic rule engine.")
        return fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight)

    # Parse JSON output from Gemini
    try:
        clean_text = response_text.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
        clean_text = clean_text.strip()

        parsed = json.loads(clean_text)
        parsed["blend_weight"] = round(blend_weight, 2)
        parsed["retrieved_cases"] = retrieved_cases
        parsed["current_balance"] = current_balance
        return parsed
    except Exception as parse_err:
        print(f"[RAG Engine] JSON parse error on LLM response: {parse_err}. Raw response: {response_text}")
        return fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight)


def extract_amount_from_query(user_query, api_key=None):
    """
    Extracts numerical transaction amount from natural language queries in English, Tamil, or Tanglish:
    '50000rs', 'Rs. 75,000', '₹50,000', '50k', '45000 rupees', 'இருபதாயிரத்தில்', '20k'
    """
    import re
    query = user_query.lower()
    
    # 1. Match '50k' or '50 k'
    k_match = re.search(r'(\d+(?:\.\d+)?)\s*k\b', query)
    if k_match:
        return float(k_match.group(1)) * 1000.0

    # 2. Extract explicit Arabic numerals (e.g., 50000, 20,000, 75000)
    numbers = re.findall(r'\d+(?:,\d+)*(?:\.\d+)?', query)
    clean_amounts = []
    for a in numbers:
        try:
            val = float(a.replace(',', ''))
            # Filter out small integers like '5 laptops' or '2 weeks'
            if val >= 500:
                clean_amounts.append(val)
        except ValueError:
            pass
            
    if clean_amounts:
        return max(clean_amounts)

    # 3. Tamil & Tanglish number words dictionary
    tamil_number_patterns = [
        # Lakhs
        (r'ஒரு\s*லட்சம|1\s*லட்சம|லட்சம|லட்சத்தில்|லக்ஷம', 100000.0),
        (r'இரண்டு\s*லட்சம|ரெண்டு\s*லட்சம|2\s*லட்சம', 200000.0),
        (r'அரை\s*லட்சம', 50000.0),
        # Tens of Thousands (Tamil script)
        (r'தொன்னூறாயிர|தொன்னூறு\s*ஆயிர', 90000.0),
        (r'எண்பத்தைந்தாயிர|எண்பத்தைந்து\s*ஆயிர', 85000.0),
        (r'எண்பதாயிர|எண்பது\s*ஆயிர', 80000.0),
        (r'எழுபத்தைந்தாயிர|எழுபத்தைந்து\s*ஆயிர', 75000.0),
        (r'எழுபதாயிர|எழுபது\s*ஆயிர', 70000.0),
        (r'அறுபத்தைந்தாயிர|அறுபத்தைந்து\s*ஆயிர', 65000.0),
        (r'அறுபதாயிர|அறுபது\s*ஆயிர', 60000.0),
        (r'ஐம்பத்தைந்தாயிர|ஐம்பத்தைந்து\s*ஆயிர', 55000.0),
        (r'ஐம்பதாயிர|ஐம்பது\s*ஆயிர', 50000.0),
        (r'நாற்பத்தைந்தாயிர|நாற்பத்தைந்து\s*ஆயிர', 45000.0),
        (r'நாற்பதாயிர|நாற்பது\s*ஆயிர', 40000.0),
        (r'முப்பத்தைந்தாயிர|முப்பத்தைந்து\s*ஆயிர', 35000.0),
        (r'முப்பதாயிர|முப்பது\s*ஆயிர', 30000.0),
        (r'இருபத்தைந்தாயிர|இருபத்தைந்து\s*ஆயிர', 25000.0),
        (r'இருபதாயிர|இருபது\s*ஆயிர', 20000.0),
        (r'பதினைந்தாயிர|பதினைந்து\s*ஆயிர', 15000.0),
        (r'பத்தாயிர|பத்து\s*ஆயிர', 10000.0),
        # Single Thousands (Tamil script)
        (r'ஒன்பதாயிர|ஒன்பது\s*ஆயிர', 9000.0),
        (r'எட்டாயிர|எட்டு\s*ஆயிர', 8000.0),
        (r'ஏழாயிர|ஏழு\s*ஆயிர', 7000.0),
        (r'ஆறாயிர|ஆறு\s*ஆயிர', 6000.0),
        (r'ஐந்தாயிர|ஐந்து\s*ஆயிர', 5000.0),
        (r'நான்காயிர|நாலாயிர|நான்கு\s*ஆயிர', 4000.0),
        (r'மூன்றாயிர|மூன்று\s*ஆயிர', 3000.0),
        (r'இரண்டாயிர|ரெண்டாயிர|இரண்டு\s*ஆயிர|ரெண்டு\s*ஆயிர', 2000.0),
        (r'ஒராயிர|ஒரு\s*ஆயிர|ஆயிர', 1000.0),
        # Tanglish
        (r'irubathaayiram|irubathayiram|irupathayiram|irubadhayiram|20k', 20000.0),
        (r'pathaayiram|pathayiram|pathadhayiram|10k', 10000.0),
        (r'muppathayiram|30k', 30000.0),
        (r'narpathayiram|40k', 40000.0),
        (r'aimbathayiram|aimpathayiram|50k', 50000.0),
        (r'arubathayiram|60k', 60000.0),
        (r'ezhubathayiram|70k', 70000.0),
        (r'enbathayiram|80k', 80000.0),
    ]

    for pattern, amt in tamil_number_patterns:
        if re.search(pattern, query):
            return amt

    # 4. LLM Fallback Amount Extraction
    if not api_key:
        api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        try:
            sys_prompt = "You are a financial query amount parser. Extract ONLY the intended monetary outlay amount in INR (Rupees) as a single float number from the input query. Respond ONLY with the numeric value (e.g. 20000). If no amount is mentioned, respond with 10000."
            raw_amt = call_gemini_rest_api(api_key, sys_prompt, f"User Input Query: \"{user_query}\"")
            if raw_amt:
                amt_match = re.search(r'\d+(?:\.\d+)?', raw_amt.replace(',', ''))
                if amt_match:
                    parsed_val = float(amt_match.group(0))
                    if parsed_val >= 100:
                        print(f"[RAG Engine] LLM extracted transaction amount: Rs. {parsed_val:,.2f} from '{user_query}'")
                        return parsed_val
        except Exception as e:
            print(f"[RAG Engine] LLM amount extraction warning: {e}")

    return 10000.0


def fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight, language="en"):
    """Fallback rule engine if LLM call is unavailable or fails."""
    is_tamil = language == "ta" or any('\u0b80' <= char <= '\u0bff' for char in user_query)
    est_amount = extract_amount_from_query(user_query)
    post_bal = current_balance - est_amount

    # Extract top matching past case memory details if available
    top_case_text_ta = ""
    top_case_text_en = ""
    top_case_factor_ta = ""
    top_case_factor_en = ""

    if retrieved_cases and len(retrieved_cases) > 0:
        c0 = retrieved_cases[0]
        v_name = c0.get('vendor_or_client', c0.get('metadata', {}).get('vendor_or_client', 'Past Case'))
        v_amt = c0.get('amount', c0.get('metadata', {}).get('amount', 0.0))
        v_out = c0.get('outcome', c0.get('metadata', {}).get('outcome', 'healthy')).upper()
        v_cat = c0.get('category', c0.get('metadata', {}).get('category', ''))
        v_notes = c0.get('notes', c0.get('metadata', {}).get('notes', ''))

        cat_str = f" [{v_cat}]" if v_cat else ""
        note_str = f" — '{v_notes}'" if v_notes else ""

        top_case_text_ta = f"முன்பு {v_name}{cat_str} நிறுவனத்தில் ரூ. {v_amt:,.2f} செலவிடப்பட்ட போது பெறப்பட்ட அனுபவத்துடன் (நிலை: {v_out}{note_str}) ஒப்பிடுகையில், "
        top_case_text_en = f"Comparing this proposal with past {v_name}{cat_str} transaction of Rs. {v_amt:,.2f} (Outcome: {v_out}{note_str}), "
        top_case_factor_ta = f"ஒத்த முந்தைய நிகழ்வு ஒப்பீடு: {v_name}{cat_str} - ரூ. {v_amt:,.2f} (நிலை: {v_out})"
        top_case_factor_en = f"Similar past case comparison: {v_name}{cat_str} - Rs. {v_amt:,.2f} (Historical Outcome: {v_out})"

    # Check for personal / education keyword context
    is_personal_education = any(w in user_query.lower() for w in ['college', 'fees', 'tuition', 'son', 'school', 'education', 'காலேஜ்', 'ஃபீஸ்'])

    if post_bal >= 50000.0 and not is_personal_education:
        verdict = "Recommended"
        risk_level = "Low"
        if is_tamil:
            exp = f"{top_case_text_ta}உங்கள் தற்போதைய ரொக்க இருப்பு ரூ. {current_balance:,.2f} இந்த ரூ. {est_amount:,.2f} செலவை எளிதில் தாங்கும். செலவுக்குப் பின் இருப்பு ரூ. {post_bal:,.2f} ஆக பாதுகாப்பாக இருக்கும்."
            action = "கொள்முதல் திட்டத்துடன் தாராளமாக தொடரலாம்."
        else:
            exp = f"{top_case_text_en}your current cash balance of Rs. {current_balance:,.2f} can easily absorb this proposal of ~Rs. {est_amount:,.2f}, leaving a healthy reserve of Rs. {post_bal:,.2f}."
            action = "Proceed with standard purchase order."
    elif post_bal >= BALANCE_ALERT_THRESHOLD:
        verdict = "Proceed with Caution"
        risk_level = "Medium"
        if is_personal_education:
            if is_tamil:
                exp = f"{top_case_text_ta}ரூ. {est_amount:,.2f} கல்லூரி கட்டணம் செலுத்துவது உங்கள் ரொக்க இருப்பை ரூ. {post_bal:,.2f} ஆக குறைக்கும். முந்தைய கல்லூரி கட்டண செலவுகள் தற்காலிக ரொக்க நெருக்கடியை ஏற்படுத்தின."
                action = "கட்டணத்தை செலுத்தலாம், ஆனால் பிற அத்தியாவசியமற்ற செலவுகளை ஒத்திவைக்கவும்."
            else:
                exp = f"{top_case_text_en}paying Rs. {est_amount:,.2f} for college fees will reduce your cash balance to Rs. {post_bal:,.2f}. Similar past college fee payments caused temporary cash flow strain."
                action = "Proceed with payment, but record as an owner's draw and stagger non-essential business purchases."
        else:
            if is_tamil:
                exp = f"{top_case_text_ta}இந்த ரூ. {est_amount:,.2f} செலவு உங்கள் ரொக்க இருப்பை ரூ. {post_bal:,.2f} ஆக குறைக்கும். இது உங்கள் குறைந்தபட்ச பாதுகாப்பு வரம்பான ரூ. {BALANCE_ALERT_THRESHOLD:,.2f}-க்கு அருகில் உள்ளது."
                action = "செலவு செய்யும் முன் குறுகிய கால வரவுகளை சரிபார்க்கவும்."
            else:
                exp = f"{top_case_text_en}this expenditure of ~Rs. {est_amount:,.2f} will lower your cash reserves to Rs. {post_bal:,.2f}, which is close to your safety threshold of Rs. {BALANCE_ALERT_THRESHOLD:,.2f}."
                action = "Review short-term receivables before executing this transaction."
    else:
        verdict = "Not Recommended"
        risk_level = "High"
        if is_tamil:
            exp = f"{top_case_text_ta}எச்சரிக்கை: இந்த ரூ. {est_amount:,.2f} செலவு உங்கள் ரொக்க இருப்பை ரூ. {post_bal:,.2f} ஆக குறைக்கும். இது உங்கள் பாதுகாப்பு வரம்பை விட குறைவாகும்."
            action = "ரொக்க நெருக்கடியை தவிர்க்க இச்செலவை ஒத்திவைக்கவும்."
        else:
            exp = f"{top_case_text_en}warning: this outlay of ~Rs. {est_amount:,.2f} will drop your cash balance to Rs. {post_bal:,.2f}, which breaches your safety threshold of Rs. {BALANCE_ALERT_THRESHOLD:,.2f}."
            action = "Defer or reduce payment amount to avoid liquidity breach."

    if is_tamil:
        key_factors = []
        if top_case_factor_ta:
            key_factors.append(top_case_factor_ta)
        key_factors.extend([
            f"தற்போதைய ரொக்க இருப்பு: ரூ. {current_balance:,.2f}",
            f"கணக்கிடப்பட்ட செலவு: ரூ. {est_amount:,.2f}",
            f"செலவுக்குப் பின் எதிர்பார்க்கப்படும் இருப்பு: ரூ. {post_bal:,.2f}"
        ])
    else:
        key_factors = []
        if top_case_factor_en:
            key_factors.append(top_case_factor_en)
        key_factors.extend([
            f"Live cash balance: Rs. {current_balance:,.2f}",
            f"Parsed proposal outlay: Rs. {est_amount:,.2f}",
            f"Projected post-transaction reserve: Rs. {post_bal:,.2f}"
        ])

    if retrieved_cases:
        strained_count = sum(1 for c in retrieved_cases if c.get("outcome") == "strained" or c.get("metadata", {}).get("outcome") == "strained")
        if strained_count > 0:
            if is_tamil:
                key_factors.append(f"கடந்த காலத்தில் {strained_count} ஒத்த பரிவர்த்தனைகள் தற்காலிக ரொக்க நெருக்கடியை ஏற்படுத்தின.")
            else:
                key_factors.append(f"{strained_count} similar past case(s) in history resulted in temporary liquidity strain.")

    return {
        "verdict": verdict,
        "explanation": exp,
        "key_factors": key_factors,
        "estimated_post_balance": post_bal,
        "risk_level": risk_level,
        "suggested_action": action,
        "blend_weight": round(blend_weight, 2),
        "retrieved_cases": retrieved_cases,
        "current_balance": current_balance
    }


if __name__ == "__main__":
    print("=" * 60)
    print("FINSENSE FUSION ENGINE & ADVISOR TEST RUN")
    print("=" * 60)
    test_q = "Should I buy 5 new high-end laptops for our development team costing Rs. 75,000?"
    print(f"Test Query: '{test_q}'\n")
    res = generate_advisor_recommendation(test_q)
    print(json.dumps(res, indent=2))
    print("=" * 60)
