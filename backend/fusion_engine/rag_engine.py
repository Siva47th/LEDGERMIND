import os
import sys
import json
import re
import functools
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
BALANCE_ALERT_THRESHOLD = 10000.0


def get_current_balance():
    """Calculates current live balance from SQLite transactions."""
    STARTING_BALANCE = float(os.environ.get("STARTING_BALANCE", 250000.0))
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
    Direct HTTPS REST invocation of Gemini generateContent endpoint.
    Deterministic temperature: 0.0 to guarantee repeatability across repeated queries.
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
            "temperature": 0.0,
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


@functools.lru_cache(maxsize=512)
def normalize_search_query(user_query, api_key=None):
    """
    Deterministic LLM & Domain Semantic Query Normalizer:
    1. Caches results in memory via lru_cache so repeated identical queries produce
       100% deterministic search representations every time with 0ms latency.
    2. Uses zero-temperature greedy decoding to guarantee repeatable query generation.
    3. Falls back to a rich SME domain lexicon covering wholesale inventory, utilities,
       commercial rent, tech hardware, tax, and retail sales.
    """
    if not api_key:
        api_key = os.getenv("GEMINI_API_KEY")

    if api_key:
        system_prompt = (
            "You are a deterministic semantic query rewriting engine for vector database retrieval. "
            "Convert the user's proposal into a concise 1-sentence canonical English search query "
            "highlighting the transaction domain, item/service, category, and intent. "
            "Respond ONLY with the single English search sentence. Do not return JSON."
        )
        try:
            rewritten = call_gemini_rest_api(api_key, system_prompt, f"User Input: \"{user_query}\"")
            if rewritten and len(rewritten.strip()) > 3:
                clean_rewritten = rewritten.strip().strip('"').strip("'")
                # Unwrap JSON if model returned JSON payload
                if clean_rewritten.startswith("{"):
                    try:
                        parsed_json = json.loads(clean_rewritten)
                        clean_rewritten = (
                            parsed_json.get("query") or 
                            parsed_json.get("search_query") or 
                            parsed_json.get("canonical_query") or 
                            list(parsed_json.values())[0]
                        )
                    except Exception:
                        pass
                # Ensure query passed to ChromaDB is purely canonical English
                # (all-MiniLM-L6-v2 vocabulary does not contain Tamil characters)
                numbers = re.findall(r'\b\d+(?:,\d+)*(?:\.\d+)?\b', user_query)
                amount_hint = f" amount {numbers[0].replace(',', '')}" if numbers and numbers[0].replace(',', '') not in clean_rewritten else ""
                return f"{clean_rewritten}{amount_hint}".strip()
        except Exception as e:
            print(f"[RAG Engine] LLM query rewrite warning: {e}")

    # Fallback deterministic domain lexicon expansion
    numbers = re.findall(r'\b\d+(?:,\d+)*(?:\.\d+)?\b', user_query)
    amount_str = f"amount {numbers[0].replace(',', '')}" if numbers else ""

    if any('\u0b80' <= char <= '\u0bff' for char in user_query):
        tamil_domain_lexicon = [
            (r'சரக்கு|பொருட்கள்|சரக்குகள்|மளிகை|சரக்குப்பொருட்கள்', 'inventory restocking stock goods merchandise wholesale supplies store restock ABC Traders'),
            (r'வாங்க|வாங்கலாமா|கொள்முதல்|வாங்குதல்', 'purchase buy spend order acquisition procurement outlay'),
            (r'மின்சார|மின்சாரம்|கரண்ட்|tneb', 'electricity power utility tneb monthly bill payment'),
            (r'வாடகை', 'office rent building lease commercial premise property'),
            (r'விளம்பரம்|விளம்பர|விளம்பரங்கள்', 'advertising marketing ads campaign promotions google meta'),
            (r'கணினி|லேப்டாப்|மடிக்கணினி|கம்ப்யூட்டர்', 'laptop computer electronics hardware equipment dell hp'),
            (r'கல்லூரி|காலேஜ்|பள்ளி|படிப்பு|ஃபீஸ்|கல்வி|பையன்|மகன்', 'college university education tuition fees schooling academic'),
            (r'சம்பளம்|ஊதியம்', 'payroll salary staff employees wages compensation'),
            (r'இணையம்|பிராட்பேண்ட்|வைஃபை', 'internet broadband airtel telecom data connectivity'),
            (r'வரி|ஆடிட்டர்|தணிக்கை|ஜிஎஸ்டி|கட்டணம்', 'tax auditor gst audit compliance accounting ca legal fees'),
            (r'வரவு|வருமானம்|வாடிக்கையாளர்|பணம்|பெறுதல்', 'client customer revenue payment collection income settlement receipt')
        ]
        augmented = []
        for pattern, eng in tamil_domain_lexicon:
            if re.search(pattern, user_query, re.IGNORECASE):
                augmented.append(eng)
        if augmented:
            search_text = f"{' '.join(augmented)} {amount_str}".strip()
        else:
            search_text = f"general business operating transaction expense {amount_str}".strip()
    else:
        search_text = user_query

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
    if o == "profitable":
        return "லாபகரமான முதலீடு"
    if o in ["break-even", "break_even"]:
        return "சமநிலை செலவு"
    if o == "pending":
        return "மதிப்பீடு நிலுவையில்"
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


def generate_advisor_recommendation(user_query, top_k=4, language="en", chat_history=None):
    """
    RAG Fusion Engine Main Entry Point:
    1. Retrieves top K similar past case memories from ChromaDB using LLM Semantic Query Rewriting
    2. Incorporates multi-turn conversation history for context-aware follow-up reasoning
    3. Fetches live cash balance & 30-day forecast trajectory
    4. Calculates Adaptive Blending confidence weight
    5. Constructs structured prompt for Gemini API with strict mathematical refusal/caution guardrails
    6. Calls Gemini model to generate explainable financial advice
    """
    api_key = os.getenv("GEMINI_API_KEY")

    # Detect transaction direction: income (receiving money) vs expense (spending money)
    income_signals = [
        'receive', 'income', 'payment from', 'client payment', 'revenue',
        'received', 'collection', 'receivable', 'வரவு', 'வருமானம்', 'பெறுதல்',
        'bill client', 'collect from', 'customer payment', 'sales revenue',
        'பணம் வந்தது', 'கிடைத்தது'
    ]
    is_income_query = any(s in user_query.lower() for s in income_signals)
    target_txn_type = "income" if is_income_query else "expense"

    # If the user query is a relative follow-up (e.g. "what about Rs. 30,000 instead?"),
    # combine it with the previous turn's query subject so ChromaDB retrieves relevant cases.
    resolved_search_text = user_query
    if chat_history and len(chat_history) > 0:
        last_turn_q = chat_history[-1].get("query", "")
        follow_up_tokens = ["what about", "instead", "how about", "what if", "can we do", "why not", "மாற்றாக"]
        if any(tok in user_query.lower() for tok in follow_up_tokens):
            resolved_search_text = f"{user_query} (context: {last_turn_q})"

    # 1. Retrieve Similar Cases from ChromaDB Vector Store with LLM Semantic Query Rewriting
    try:
        search_query = normalize_search_query(resolved_search_text, api_key=api_key)
        retrieved_cases = query_similar_cases(
            query_text=search_query, 
            top_k=top_k, 
            transaction_type=target_txn_type
        )
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
    if num_cases > 0:
        avg_similarity = sum(c.get('similarity_score', 50) for c in retrieved_cases) / num_cases
        count_factor = min(num_cases / 5.0, 1.0)
        quality_factor = max(0.0, min(avg_similarity / 100.0, 1.0))
        blend_weight = round(count_factor * quality_factor, 2)
    else:
        blend_weight = 0.0

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

    # Format prior multi-turn conversational context if available
    history_context_str = ""
    if chat_history and len(chat_history) > 0:
        hist_items = []
        for turn in chat_history[-3:]:
            t_q = turn.get("query", "")
            t_v = turn.get("verdict", "")
            t_resp = turn.get("response") or {}
            t_exp = t_resp.get("explanation", "")[:150]
            if t_q:
                hist_items.append(f"- User Proposal: \"{t_q}\"\n  Advisor Verdict: {t_v}\n  Advisor Summary: {t_exp}")
        if hist_items:
            history_context_str = (
                "PRIOR CONVERSATION HISTORY (Previous Consultation Turns in this Session):\n"
                + "\n".join(hist_items) + "\n\n"
                + "CONVERSATIONAL FOLLOW-UP INSTRUCTION: If the user query is a relative follow-up "
                + "(e.g. 'what about ₹30,000 instead?', 'can we do 2 instead?', 'how about next month?'), "
                + "you MUST use the prior conversation turns above to resolve the product, service, or vendor being discussed!\n"
            )

    # Auto-detect Tamil script or explicit language parameter
    is_tamil_query = any('\u0b80' <= char <= '\u0bff' for char in user_query)
    if is_tamil_query or language == "ta":
        language = "ta"

    # Language Specific Instructions
    lang_instruction = ""
    if language == "ta":
        lang_instruction = (
            "CRITICAL NAMING FORMAT INSTRUCTION: The user query is in TAMIL script. "
            "Write your response in natural TAMIL script for 'explanation', 'key_factors' array items, and 'suggested_action'. "
            "MANDATORY RULE FOR ALL NAMING WORDS (Vendor Names, Brand Names, Categories, Outcomes): Keep the original English naming word as is and PUT ITS TAMIL TRANSLATION IN BRACKETS right after it. "
            "Examples: "
            "- Vendor Naming: 'Anna University Fees (அண்ணா பல்கலைக்கழக கட்டணம்)', 'Dell India (டெல் கணினி நிறுவனம்)', 'Croma Electronics (க்ரோமா எலக்ட்ரானிக்ஸ்)' "
            "- Category Naming: '[Education (கல்வி)]', '[Shopping (பொருட்கள் வாங்குதல்)]', '[Software (மென்பொருள்)]' "
            "- Outcome Naming: 'STRAINED (ரொக்க நெருக்கடி நிலை)', 'HEALTHY (ஆரோக்கியமான நிதி நிலை)' "
            "CRITICAL TTS FORMATTING: Do NOT use hyphens before Tamil suffixes (write '65000க்கு' or 'அறுபத்தைந்தாயிரத்துக்கு' instead of '65,000-க்கு'). Write numbers clearly without hyphens so text-to-speech engines pronounce amounts naturally without saying 'minus'. "
            "Keep 'verdict' strictly as one of ['Recommended', 'Proceed with Caution', 'Not Recommended'] and keep 'estimated_post_balance' as a number."
        )

    # 4. Construct System & User Prompt for Gemini
    system_instruction = (
        "You are LedgerMind AI, an expert small-business financial advisor. "
        "You analyze business spending and revenue proposals against live cash balance, past decision history (case memory), "
        "and 30-day predictive forecasts. You provide clear, grounded, non-jargon financial advice."
    )

    # Parse expected amount from query
    parsed_amount = extract_amount_from_query(user_query, api_key=api_key)
    expected_post_bal = current_balance + parsed_amount if is_income_query else current_balance - parsed_amount

    parsed_amt_str = f"{parsed_amount:,.2f}"
    exp_post_bal_str = f"{expected_post_bal:,.2f}"
    curr_bal_str = f"{current_balance:,.2f}"
    alert_thresh_str = f"{BALANCE_ALERT_THRESHOLD:,.2f}"
    blend_wt_str = f"{blend_weight:.2f}"
    direction_desc = "INCOME (Receiving Money / Client Settlement)" if is_income_query else "EXPENSE (Spending Money / Vendor Purchase)"

    prompt = f"""
{history_context_str}
USER PROPOSAL / QUERY:
"{user_query}"

PROPOSAL DIRECTION: {direction_desc}

EXTRACTED PROPOSAL DETAILS:
- Numerical Proposal Amount: Rs. {parsed_amt_str}
- Estimated Post-Transaction Reserve: Rs. {exp_post_bal_str}

LIVE FINANCIAL CONTEXT:
- Current Live Cash Balance: Rs. {curr_bal_str}
- Safety Alert Threshold: Rs. {alert_thresh_str}
- Cash Flow Forecast Summary: {forecast_summary}

PAST CASE MEMORY (Retrieved via Cosine Similarity from ChromaDB - Filtered to {target_txn_type.upper()} cases):
{formatted_cases}

ADAPTIVE BLENDING WEIGHT: {blend_wt_str} (1.00 means high historical grounding; 0.00 means generic rules).

MANDATORY VERDICT DETERMINATION RULES (DO NOT DEFAULT TO RECOMMENDED):
1. REFUSAL RULE (NOT RECOMMENDED): If Estimated Post-Transaction Reserve < Rs. {alert_thresh_str} OR if the proposal outlay exceeds cash balance (creating negative cash reserve), you MUST assign "verdict": "Not Recommended" and "risk_level": "High". The explanation MUST clearly state the cash deficit, warn that the safety liquidity buffer is breached, cite similar strained past cases, and explicitly refuse the outlay with actionable deferral advice.
2. CAUTION RULE (PROCEED WITH CAUTION): If Estimated Post-Transaction Reserve is between Rs. {alert_thresh_str} and Rs. 50,000 OR if retrieved past case memories were predominantly STRAINED/WASTEFUL, you MUST assign "verdict": "Proceed with Caution" and "risk_level": "Medium". The explanation MUST warn that the reserve is uncomfortably close to the threshold and suggest staggering or securing receivables.
3. APPROVAL RULE (RECOMMENDED): Only assign "verdict": "Recommended" and "risk_level": "Low" if Estimated Post-Transaction Reserve >= Rs. 50,000 AND past precedent indicates healthy/profitable outcomes.

CRITICAL GROUNDING INSTRUCTIONS:
Retrieved Past Case Memories from ChromaDB vector memory are provided above (filtered to match proposal transaction type). YOU MUST ALWAYS EXPLICITLY CITE AND COMPARE THE USER PROPOSAL AGAINST THESE RETRIEVED PAST CASES in both your 'explanation' and 'key_factors':
1. Identify the most relevant past case from the retrieved list.
2. EXPLICITLY MENTION THE PAST VENDOR/CLIENT NAME, PAST AMOUNT, AND HISTORICAL OUTCOME STATE (HEALTHY / STRAINED / PROFITABLE / WASTEFUL / BREAK-EVEN) in your 'explanation' and 'key_factors'.
   - In Tamil responses, keep original naming words with Tamil translations in brackets.
   - SEMANTIC INTEGRITY: Respect the transaction direction! If comparing an expense, describe past money spent. If comparing income, describe past revenue received. Never describe income as spending or spending as income.
3. Explain what lesson was learned from that past experience and why it supports or warns against the current proposal.
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
        return fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight, language=language, chat_history=chat_history)

    response_text = call_gemini_rest_api(api_key, system_instruction, prompt)

    if not response_text:
        print("[RAG Engine] All Gemini model invocations failed. Falling back to heuristic rule engine.")
        return fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight, language=language, chat_history=chat_history)

    # Parse JSON output from Gemini
    try:
        clean_text = response_text.strip()
        if clean_text.startswith("```json"):
            clean_text = clean_text[7:]
        if clean_text.endswith("```"):
            clean_text = clean_text[:-3]
        clean_text = clean_text.strip()

        parsed = json.loads(clean_text)

        # Enforce mathematical guardrails
        if expected_post_bal < BALANCE_ALERT_THRESHOLD and not is_income_query:
            parsed["verdict"] = "Not Recommended"
            parsed["risk_level"] = "High"
        elif expected_post_bal < 50000.0 and parsed.get("verdict") == "Recommended" and not is_income_query:
            parsed["verdict"] = "Proceed with Caution"
            parsed["risk_level"] = "Medium"

        parsed["estimated_post_balance"] = round(expected_post_bal, 2)
        parsed["blend_weight"] = round(blend_weight, 2)
        parsed["retrieved_cases"] = retrieved_cases
        parsed["current_balance"] = current_balance
        return parsed
    except Exception as parse_err:
        print(f"[RAG Engine] JSON parse error on LLM response: {parse_err}. Raw response: {response_text}")
        return fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight, language=language, chat_history=chat_history)
        return fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight, language=language)


def extract_amount_from_query(user_query, api_key=None):
    """
    Extracts numerical transaction amount from natural language queries in English, Tamil, or Tanglish:
    '50000rs', 'Rs. 75,000', '₹50,000', '50k', '45000 rupees', '₹20 lakh', '20 lakhs', '20 crores', '20 லட்சம்'
    """
    import re
    query = user_query.lower()
    
    # 1. Match Crores (e.g. '20 crore', '1.5 crores', '2cr')
    cr_match = re.search(r'(?:₹|rs\.?|inr\s*)?(\d+(?:\.\d+)?)\s*(?:crores?|cr)\b', query)
    if cr_match:
        return float(cr_match.group(1)) * 10000000.0

    # 2. Match Lakhs / Lacs (e.g. '20 lakh', '20 lakhs', '₹20 lakh', '20lakh', '1.5 lac', '5 lacs', '20 l')
    lakh_match = re.search(r'(?:₹|rs\.?|inr\s*)?(\d+(?:\.\d+)?)\s*(?:lakhs?|lacs?|lac|l)\b', query)
    if lakh_match:
        return float(lakh_match.group(1)) * 100000.0

    # 3. Match '50k' or '50 k'
    k_match = re.search(r'(?:₹|rs\.?|inr\s*)?(\d+(?:\.\d+)?)\s*k\b', query)
    if k_match:
        return float(k_match.group(1)) * 1000.0

    # 4. Match Tamil Lakhs with digits (e.g. '20 லட்சம்', '5 லட்சம')
    tamil_digit_lakh = re.search(r'(\d+(?:\.\d+)?)\s*(?:லட்சம|லட்சம்|லக்ஷம|லக்ஷம்)\b', query)
    if tamil_digit_lakh:
        return float(tamil_digit_lakh.group(1)) * 100000.0

    # 5. Extract explicit Arabic numerals with commas/decimals (e.g., 20,00,000, 50000, 20,000, 75000)
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

    # 6. Tamil & Tanglish number words dictionary
    tamil_number_patterns = [
        # Lakhs in Tamil words
        (r'இருபது\s*(?:லட்சம|லட்சம்)', 2000000.0),
        (r'பத்து\s*(?:லட்சம|லட்சம்)', 1000000.0),
        (r'ஐந்து\s*(?:லட்சம|லட்சம்)', 500000.0),
        (r'இரண்டு\s*(?:லட்சம|லட்சம்)|ரெண்டு\s*(?:லட்சம|லட்சம்)|2\s*(?:லட்சம|லட்சம்)', 200000.0),
        (r'ஒரு\s*(?:லட்சம|லட்சம்)|1\s*(?:லட்சம|லட்சம்)|லட்சம|லட்சம்|லட்சத்தில்|லக்ஷம|லக்ஷம்', 100000.0),
        (r'அரை\s*(?:லட்சம|லட்சம்)', 50000.0),
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
        # Tanglish (note: Nk patterns like 20k, 50k are already handled by the k_match regex above)
        (r'irubathaayiram|irubathayiram|irupathayiram|irubadhayiram', 20000.0),
        (r'pathaayiram|pathayiram|pathadhayiram', 10000.0),
        (r'muppathayiram', 30000.0),
        (r'narpathayiram', 40000.0),
        (r'aimbathayiram|aimpathayiram', 50000.0),
        (r'arubathayiram', 60000.0),
        (r'ezhubathayiram', 70000.0),
        (r'enbathayiram', 80000.0),
    ]

    for pattern, amt in tamil_number_patterns:
        if amt is not None and re.search(pattern, query):
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


def fallback_rule_recommendation(user_query, current_balance, retrieved_cases, blend_weight, language="en", chat_history=None):
    """Fallback rule engine if LLM call is unavailable or fails."""
    is_tamil = language == "ta" or any('\u0b80' <= char <= '\u0bff' for char in user_query)
    
    income_signals = [
        'receive', 'income', 'payment from', 'client payment', 'revenue',
        'received', 'collection', 'receivable', 'வரவு', 'வருமானம்', 'பெறுதல்',
        'bill client', 'collect from', 'customer payment', 'sales revenue',
        'பணம் வந்தது', 'கிடைத்தது'
    ]
    is_income_proposal = any(s in user_query.lower() for s in income_signals)

    est_amount = extract_amount_from_query(user_query)
    post_bal = current_balance + est_amount if is_income_proposal else current_balance - est_amount

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
        case_txn_type = c0.get('transaction_type', c0.get('metadata', {}).get('transaction_type', 'expense'))
        is_case_income = case_txn_type in ('income', 'return_in')

        cat_str_en = f" [{v_cat}]" if v_cat else ""
        note_str_en = f" — '{v_notes}'" if v_notes else ""

        if is_case_income:
            top_case_text_en = f"Comparing this proposal with past {v_name}{cat_str_en} revenue receipt of Rs. {v_amt:,.2f} (Outcome: {v_out}{note_str_en}), "
            top_case_factor_en = f"Past revenue precedent: {v_name}{cat_str_en} - Rs. {v_amt:,.2f} (Historical Outcome: {v_out})"
        else:
            top_case_text_en = f"Comparing this proposal with past {v_name}{cat_str_en} expenditure of Rs. {v_amt:,.2f} (Outcome: {v_out}{note_str_en}), "
            top_case_factor_en = f"Similar past expense: {v_name}{cat_str_en} - Rs. {v_amt:,.2f} (Historical Outcome: {v_out})"

        # Bracketed Naming Words versions (Original Naming Word + Tamil Translation in Brackets)
        v_ta = translate_vendor_to_tamil(v_name)
        c_ta = translate_category_to_tamil(v_cat)
        o_ta = translate_outcome_to_tamil(v_out)
        n_ta = translate_notes_to_tamil(v_notes)

        v_combined_ta = f"{v_name} ({v_ta})" if v_ta and v_ta != v_name else v_name
        cat_combined_ta = f" [{v_cat} ({c_ta})]" if v_cat and c_ta != v_cat else (f" [{v_cat}]" if v_cat else "")
        out_combined_ta = f"{v_out} ({o_ta})"
        note_str_ta = f" — '{n_ta}'" if n_ta else ""

        if is_case_income:
            action_verb_ta = "வரவு பெறப்பட்ட போது"
            factor_prefix_ta = "முந்தைய வருவாய் ஒப்பீடு"
        else:
            action_verb_ta = "செலவிடப்பட்ட போது"
            factor_prefix_ta = "ஒத்த முந்தைய செலவு ஒப்பீடு"

        top_case_text_ta = f"முன்பு {v_combined_ta}{cat_combined_ta} நிறுவனத்தில் ரூ. {v_amt:,.2f} {action_verb_ta} பெறப்பட்ட அனுபவத்துடன் (நிலை: {out_combined_ta}{note_str_ta}) ஒப்பிடுகையில், "
        top_case_factor_ta = f"{factor_prefix_ta}: {v_combined_ta}{cat_combined_ta} - ரூ. {v_amt:,.2f} (நிலை: {out_combined_ta})"

    # Check for personal / education keyword context
    is_personal_education = any(w in user_query.lower() for w in ['college', 'fees', 'tuition', 'son', 'school', 'education', 'காலேஜ்', 'ஃபீஸ்'])

    if is_income_proposal:
        verdict = "Recommended"
        risk_level = "Low"
        if is_tamil:
            exp = f"{top_case_text_ta}ரூ. {est_amount:,.2f} வரவு உங்கள் தற்போதைய ரொக்க இருப்பு ரூ. {current_balance:,.2f}-ஐ ரூ. {post_bal:,.2f} ஆக உயர்த்தும். இது நிறுவனத்தின் பணப்புழக்கத்தை மேலும் வலுப்படுத்தும்."
            action = "இன்வாய்ஸ் மற்றும் தொகையை உறுதிசெய்து வரவு பதிவை மேற்கொள்ளலாம்."
        else:
            exp = f"{top_case_text_en}receiving this expected revenue of ~Rs. {est_amount:,.2f} will increase your cash reserves from Rs. {current_balance:,.2f} to Rs. {post_bal:,.2f}, strengthening operational liquidity."
            action = "Confirm deliverables and proceed with payment collection."
    elif post_bal >= 50000.0 and not is_personal_education:
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
                exp = f"{top_case_text_ta}கவனிக்கவும்: இந்த ரூ. {est_amount:,.2f} செலவுக்குப் பின் எதிர்பார்க்கப்படும் இருப்பு ரூ. {post_bal:,.2f} ஆகும். இது உங்கள் குறைந்தபட்ச பாதுகாப்பு வரம்பான ரூ. {BALANCE_ALERT_THRESHOLD:,.2f}-க்கு அருகில் உள்ளது."
                action = "செலவு செய்யும் முன் குறுகிய கால வரவுகளை சரிபார்க்கவும் மற்றும் தவணைகளில் செலுத்த பரிசீலிக்கவும்."
            else:
                exp = f"{top_case_text_en}proceed with caution: this outlay of ~Rs. {est_amount:,.2f} will lower your cash reserves to Rs. {post_bal:,.2f}, which is uncomfortably close to your safety threshold of Rs. {BALANCE_ALERT_THRESHOLD:,.2f}."
                action = "Review short-term receivables and stagger payments before executing this transaction."
    else:
        verdict = "Not Recommended"
        risk_level = "High"
        if is_tamil:
            exp = f"{top_case_text_ta}எச்சரிக்கை: இந்த ரூ. {est_amount:,.2f} செலவு உங்கள் ரொக்க இருப்பை ரூ. {post_bal:,.2f} ஆகக் குறைக்கும். இது உங்கள் பாதுகாப்பு வரம்பான ரூ. {BALANCE_ALERT_THRESHOLD:,.2f}-ஐ விடக் குறைவாகும் மற்றும் கடுமையான நிதி பற்றாக்குறையை ஏற்படுத்தும்."
            action = "ரொக்க நெருக்கடியைத் தவிர்க்கவும் வணிக நிலைத்தன்மையைப் பாதுகாக்கவும் இந்தச் செலவை உடனடியாக ரத்துசெய்யவும் அல்லது ஒத்திவைக்கவும்."
        else:
            exp = f"{top_case_text_en}Warning: Spending ~Rs. {est_amount:,.2f} will plunge your cash balance from Rs. {current_balance:,.2f} to Rs. {post_bal:,.2f}, which breaches your mandatory safety threshold of Rs. {BALANCE_ALERT_THRESHOLD:,.2f}. Approving this outlay would trigger an immediate operational liquidity deficit and leave your business unable to meet payroll or mandatory vendor dues."
            action = "Decline or defer this purchase until cash reserves recover or upcoming client receivables are collected."

    if is_tamil:
        key_factors = []
        if top_case_factor_ta:
            key_factors.append(top_case_factor_ta)
        key_factors.extend([
            f"தற்போதைய ரொக்க இருப்பு: ரூ. {current_balance:,.2f}",
            f"{'எதிர்பார்க்கப்படும் வரவு' if is_income_proposal else 'கணக்கிடப்பட்ட செலவு'}: ரூ. {est_amount:,.2f}",
            f"{'வரவுக்குப் பின் எதிர்பார்க்கப்படும் இருப்பு' if is_income_proposal else 'செலவுக்குப் பின் எதிர்பார்க்கப்படும் இருப்பு'}: ரூ. {post_bal:,.2f}"
        ])
    else:
        key_factors = []
        if top_case_factor_en:
            key_factors.append(top_case_factor_en)
        key_factors.extend([
            f"Live cash balance: Rs. {current_balance:,.2f}",
            f"Parsed proposal {'receipt' if is_income_proposal else 'outlay'}: Rs. {est_amount:,.2f}",
            f"Projected post-transaction reserve: Rs. {post_bal:,.2f}"
        ])

    if retrieved_cases:
        strained_count = sum(
            1 for c in retrieved_cases 
            if str(c.get("outcome") or c.get("metadata", {}).get("outcome", "")).lower() in ["strained", "wasteful", "strained_balance"]
        )
        profitable_count = sum(
            1 for c in retrieved_cases 
            if str(c.get("outcome") or c.get("metadata", {}).get("outcome", "")).lower() in ["profitable", "healthy", "healthy_balance", "productive"]
        )
        if strained_count > 0:
            if is_tamil:
                key_factors.append(f"கடந்த காலத்தில் {strained_count} ஒத்த பரிவர்த்தனைகள் தற்காலிக ரொக்க நெருக்கடி அல்லது வீண் செலவை ஏற்படுத்தின.")
            else:
                key_factors.append(f"{strained_count} similar past case(s) in history resulted in temporary liquidity strain or wasteful outlay.")
        elif profitable_count > 0:
            if is_tamil:
                key_factors.append(f"கடந்த காலத்தில் {profitable_count} ஒத்த பரிவர்த்தனைகள் ஆரோக்கியமான அல்லது லாபகரமான நிதி நிலையைத் தந்தன.")
            else:
                key_factors.append(f"{profitable_count} similar past case(s) in history yielded healthy or profitable financial outcomes.")

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
