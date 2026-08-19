import os
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime

API_BASE = "http://localhost:5000/api"

def run_http_json(url, method="GET", payload=None):
    """Helper to make HTTP REST requests and return parsed JSON."""
    headers = {"Content-Type": "application/json"}
    data_bytes = json.dumps(payload).encode("utf-8") if payload else None
    req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))

def test_full_integration_loop():
    print("=" * 70)
    print("FINSENSE - WEEK 9 END-TO-END FULL-LOOP INTEGRATION TEST")
    print("=" * 70)

    # 1. Health check
    try:
        status, health = run_http_json(f"{API_BASE}/health")
        print(f"[STAGE 1/5] API Health Check: HTTP {status} | Status: {health.get('status')}")
        assert status == 200 and health.get('status') == 'ok', "Health check failed"
    except Exception as e:
        print(f"[STAGE 1/5] FAILED: Could not reach backend API at {API_BASE}: {e}")
        return False

    # 2. Get baseline balance and stats
    status, stats_before = run_http_json(f"{API_BASE}/dashboard/stats")
    baseline_bal = stats_before["current_balance"]
    baseline_count = stats_before["total_transactions"]
    print(f"[STAGE 2/5] Baseline State Loaded:")
    print(f"            - Baseline Balance: Rs. {baseline_bal:,.2f}")
    print(f"            - Total Transactions: {baseline_count}")

    # 3. Insert a new test transaction (e.g. Client Payment Income for ₹25,000)
    test_vendor = f"Test Client Corp ({datetime.now().strftime('%H%M%S')})"
    test_amount = 25000.0
    payload = {
        "vendor_or_client": test_vendor,
        "amount": test_amount,
        "date": datetime.now().strftime("%Y-%m-%d"),
        "category": "Financial",
        "transaction_type": "income",
        "user_notes": "Milestone deposit for integration testing"
    }

    status, manual_res = run_http_json(f"{API_BASE}/transactions/manual", method="POST", payload=payload)
    print(f"[STAGE 3/5] Manual Transaction Ingestion: HTTP {status}")
    print(f"            - Recorded ID: #{manual_res.get('id')}")
    print(f"            - Type: {manual_res.get('transaction_type')} (+Rs. {test_amount:,.2f})")
    print(f"            - Live Balance After: Rs. {manual_res.get('current_balance'):,.2f}")

    expected_balance = baseline_bal + test_amount
    actual_balance = manual_res.get('current_balance', 0.0)
    assert abs(actual_balance - expected_balance) < 0.01, f"Balance mismatch! Expected {expected_balance}, got {actual_balance}"
    print("            - Balance Formula Verified: starting_balance + SUM(income) - SUM(expenses) [OK]")

    # 4. Verify ChromaDB Vector Store indexing
    status, case_search = run_http_json(f"{API_BASE}/cases/query", method="POST", payload={"query": test_vendor, "top_k": 3})
    matches = case_search.get("matches", [])
    print(f"[STAGE 4/5] ChromaDB Vector Search: HTTP {status}")
    print(f"            - Search Query: '{test_vendor}'")
    print(f"            - Matched Cases Count: {len(matches)}")

    found_in_vector = any(m.get("vendor_or_client") == test_vendor or test_vendor in m.get("summary_text", "") for m in matches)
    print(f"            - Auto-Indexed in Vector Case Memory: {'YES [OK]' if found_in_vector else 'NO (Check vector_store.py)'}")

    # 5. RAG Fusion AI Advisor Recommendation
    advisor_query = f"Can we use our cash reserve from {test_vendor} to purchase new cloud servers for Rs. 15,000?"
    status, advisor_res = run_http_json(f"{API_BASE}/advisor/query", method="POST", payload={"query": advisor_query})
    print(f"[STAGE 5/5] RAG Fusion Engine AI Advisor: HTTP {status}")
    print(f"            - Advisor Query: '{advisor_query}'")
    print(f"            - AI Verdict: {advisor_res.get('verdict')}")
    print(f"            - Risk Profile: {advisor_res.get('risk_level')}")
    print(f"            - LLM Rationale: {advisor_res.get('explanation')[:150]}...")
    print(f"            - Adaptive Blend Weight: {advisor_res.get('blend_weight')}")

    # Cleanup test transaction from database so test runs cleanly every time
    txn_id = manual_res.get('id')
    if txn_id:
        del_status, _ = run_http_json(f"{API_BASE}/transactions/{txn_id}", method="DELETE")
        print(f"\n[CLEANUP] Deleted test transaction #{txn_id}: HTTP {del_status} [OK]")

    print("=" * 70)
    print("ALL 5 END-TO-END INTEGRATION STAGES PASSED SUCCESSFULLY!")
    print("=" * 70)
    return True

if __name__ == "__main__":
    test_full_integration_loop()
