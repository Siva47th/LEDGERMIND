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
    preferred_model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
    models_to_try = [
        preferred_model,
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-flash-latest"
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


def normalize_search_query(user_query):
    """
    Translates or augments non-English / Tamil user queries for ChromaDB vector search compatibility.
    """
    search_text = user_query
    
    # Check if query contains Tamil script characters (Unicode block \u0B80 - \u0BFF)
    if any('\u0b80' <= char <= '\u0bff' for char in user_query):
        tamil_map = {
            "காலேஜ்": "college",
            "ஃபீஸ்": "fees tuition",
            "பையனுக்கு": "son child family",
            "கட்டலாமா": "pay spend fee",
            "லேப்டாப்": "laptop computer",
            "வாடகை": "rent lease",
            "கணினி": "computer",
            "விளம்பரம்": "advertising marketing",
            "கட்டணம்": "fee payment"
        }
        augmented = [eng for word, eng in tamil_map.items() if word in user_query]
        if augmented:
            search_text = f"{user_query} {' '.join(augmented)}"
        else:
            search_text = f"{user_query} college tuition fees expense"
            
    return search_text


def generate_advisor_recommendation(user_query, top_k=4, language="en"):
    """
    RAG Fusion Engine Main Entry Point:
    1. Retrieves top K similar past case memories from ChromaDB
    2. Fetches live cash balance & 30-day forecast trajectory
    3. Calculates Adaptive Blending confidence weight
    4. Constructs structured prompt for Gemini API (supporting English & Tamil)
    5. Calls Gemini model to generate explainable financial advice
    """
    # 1. Retrieve Similar Cases from ChromaDB Vector Store with Normalized Search Text
    try:
        search_query = normalize_search_query(user_query)
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

    # Language Specific Instructions
    lang_instruction = ""
    if language == "ta":
        lang_instruction = (
            "IMPORTANT LANGUAGE INSTRUCTION: The user prefers TAMIL language output. "
            "Write the 'explanation', 'key_factors' array items, and 'suggested_action' in clean, natural Tamil text (using Tamil script). "
            "Keep 'verdict' strictly as one of ['Recommended', 'Proceed with Caution', 'Not Recommended'] and keep 'estimated_post_balance' as a number."
        )

    # 4. Construct System & User Prompt for Gemini
    system_instruction = (
        "You are FinSense AI, an expert small-business financial advisor. "
        "You analyze business spending and revenue proposals against live cash balance, past decision history (case memory), "
        "and 30-day predictive forecasts. You provide clear, grounded, non-jargon financial advice."
    )

    prompt = f"""
USER PROPOSAL / QUERY:
"{user_query}"

LIVE FINANCIAL CONTEXT:
- Current Live Cash Balance: Rs. {current_balance:,.2f}
- Safety Alert Threshold: Rs. {BALANCE_ALERT_THRESHOLD:,.2f}
- Cash Flow Forecast Summary: {forecast_summary}

PAST CASE MEMORY (Retrieved via Cosine Similarity from ChromaDB):
{formatted_cases}

ADAPTIVE BLENDING WEIGHT: {blend_weight:.2f} (1.00 means high historical grounding; 0.00 means generic rules).

CRITICAL GROUNDING INSTRUCTIONS:
When PAST CASE MEMORY contains similar past transactions (e.g. past college fee payments, equipment purchases, or marketing expenses):
1. YOU MUST EXPLICITLY CITE WHAT HAPPENED LAST TIME in your 'explanation' and 'key_factors'. Mention the specific past vendor/case (e.g. IFET College of Engineering, Anna University) and its historical outcome ('strained' or 'healthy').
2. Explain what lesson was learned from that past expenditure (e.g. 'Last time paying Rs. 50,000 for college fees temporarily strained liquid reserves for 3 weeks...').
3. Combine that historical lesson with your live balance and 30-day forecast to provide a grounded recommendation.

{lang_instruction}

INSTRUCTIONS:
Analyze the user proposal and respond in STRICT JSON format with EXACTLY these keys:
{{
  "verdict": "Recommended" | "Proceed with Caution" | "Not Recommended",
  "explanation": "Detailed 2-3 sentence explanation explaining the reasoning, explicitly referencing what happened in past similar case memories and live balance.",
  "key_factors": ["Point 1 ( citing past case outcome)", "Point 2 (live balance check)", "Point 3 (forecast trajectory)"],
  "estimated_post_balance": <numeric float estimate of cash balance if spent>,
  "risk_level": "Low" | "Medium" | "High",
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


def fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight):
    """Fallback rule engine if LLM call is unavailable or fails."""
    import re
    amounts = re.findall(r'\b\d+(?:,\d+)*(?:\.\d+)?\b', user_query)
    clean_amounts = []
    for a in amounts:
        try:
            val = float(a.replace(',', ''))
            if val > 100:
                clean_amounts.append(val)
        except ValueError:
            pass

    est_amount = max(clean_amounts) if clean_amounts else 10000.0
    post_bal = current_balance - est_amount

    if post_bal >= 50000.0:
        verdict = "Recommended"
        risk_level = "Low"
        exp = f"Your current cash balance of Rs. {current_balance:,.2f} can easily absorb this proposal of ~Rs. {est_amount:,.2f}, leaving a healthy reserve of Rs. {post_bal:,.2f}."
    elif post_bal >= BALANCE_ALERT_THRESHOLD:
        verdict = "Proceed with Caution"
        risk_level = "Medium"
        exp = f"This expenditure of ~Rs. {est_amount:,.2f} will lower your cash reserves to Rs. {post_bal:,.2f}, which is close to your safety threshold of Rs. {BALANCE_ALERT_THRESHOLD:,.2f}."
    else:
        verdict = "Not Recommended"
        risk_level = "High"
        exp = f"Warning: This outlay of ~Rs. {est_amount:,.2f} will drop your cash balance to Rs. {post_bal:,.2f}, which breaches your safety threshold of Rs. {BALANCE_ALERT_THRESHOLD:,.2f}."

    key_factors = [
        f"Live cash balance: Rs. {current_balance:,.2f}",
        f"Estimated transaction outlay: Rs. {est_amount:,.2f}",
        f"Projected post-transaction reserve: Rs. {post_bal:,.2f}"
    ]

    if retrieved_cases:
        strained_count = sum(1 for c in retrieved_cases if c.get("metadata", {}).get("outcome") == "strained")
        if strained_count > 0:
            key_factors.append(f"{strained_count} similar past case(s) resulted in financial strain.")

    return {
        "verdict": verdict,
        "explanation": exp,
        "key_factors": key_factors,
        "estimated_post_balance": post_bal,
        "risk_level": risk_level,
        "suggested_action": "Review your short-term receivables before executing this transaction." if risk_level != "Low" else "Proceed with standard purchase order.",
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
