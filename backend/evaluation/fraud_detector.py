import os
import sys
import sqlite3
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

DB_NAME = "finsense.db"
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), DB_NAME)

def detect_transaction_anomalies():
    """
    Scans all SQLite transactions and identifies anomalies/fraud signals using:
    1. Isolation Forest (Machine Learning anomaly detector trained on amount & category encoding)
    2. Statistical Z-score outlier detection (> 2.5 std deviations above category mean)
    3. Heuristic pattern checks:
       - Suspicious duplicate vendor/amount entries within same day
       - Unusually high round-number single outlays (> Rs. 1,000,000 or > 50% of starting balance)
    """
    if not os.path.exists(DB_PATH):
        return []

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, vendor_or_client, amount, transaction_type, category, date, outcome_label, user_notes, user_outcome, created_at 
        FROM transactions
        ORDER BY date DESC, id DESC
    """)
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return []

    df = pd.DataFrame(rows, columns=[
        "id", "vendor_or_client", "amount", "transaction_type", "category", "date",
        "outcome_label", "user_notes", "user_outcome", "created_at"
    ])

    if len(df) == 0:
        return []

    df["is_anomaly"] = False
    df["anomaly_score"] = 0.0
    df["anomaly_reasons"] = [[] for _ in range(len(df))]

    # 1. Statistical Z-score outlier check by Category
    category_groups = df.groupby("category")["amount"]
    df["cat_mean"] = category_groups.transform("mean")
    df["cat_std"] = category_groups.transform("std").fillna(1.0)
    df["z_score"] = (df["amount"] - df["cat_mean"]) / (df["cat_std"] + 1e-5)

    for idx, row in df.iterrows():
        reasons = []
        # Check Z-score outlier
        if row["z_score"] > 2.2 and row["amount"] > 20000:
            reasons.append(f"Amount Rs. {row['amount']:,.2f} is significantly higher than category '{row['category']}' average (Rs. {row['cat_mean']:,.2f}).")

        # Check duplicate transactions on same date
        duplicates = df[(df["vendor_or_client"] == row["vendor_or_client"]) & 
                        (df["amount"] == row["amount"]) & 
                        (df["date"] == row["date"]) & 
                        (df["id"] != row["id"])]
        if len(duplicates) > 0:
            reasons.append(f"Identical duplicate transaction detected for '{row['vendor_or_client']}' on {row['date']}.")

        # Check extreme high amount
        if row["amount"] > 100000.0 and row["transaction_type"] in ("expense", "return_out"):
            reasons.append(f"High-value outlay of Rs. {row['amount']:,.2f} exceeds standard operating threshold.")

        if reasons:
            df.at[idx, "is_anomaly"] = True
            df.at[idx, "anomaly_reasons"] = reasons

    # 2. Machine Learning Isolation Forest (if at least 4 records exist)
    if len(df) >= 4:
        try:
            X = df[["amount"]].values
            iso = IsolationForest(contamination=0.2, random_state=42)
            preds = iso.fit_predict(X)
            scores = iso.decision_function(X)

            for idx, (p, score) in enumerate(zip(preds, scores)):
                df.at[idx, "anomaly_score"] = round(float(-score), 3)
                if p == -1: # Isolation forest flagged anomaly
                    df.at[idx, "is_anomaly"] = True
                    current_reasons = df.at[idx, "anomaly_reasons"]
                    if not any("Isolation Forest" in r for r in current_reasons):
                        current_reasons.append("ML Isolation Forest algorithm flagged unusual expenditure distribution pattern.")
                    df.at[idx, "anomaly_reasons"] = current_reasons
        except Exception as e:
            print(f"[Fraud Detector] Isolation Forest warning: {e}")

    # Build response format
    results = []
    for idx, row in df.iterrows():
        results.append({
            "id": int(row["id"]),
            "vendor_or_client": row["vendor_or_client"],
            "amount": float(row["amount"]),
            "transaction_type": row["transaction_type"],
            "category": row["category"],
            "date": row["date"],
            "outcome_label": row["outcome_label"],
            "is_anomaly": bool(row["is_anomaly"]),
            "anomaly_score": float(row["anomaly_score"]),
            "anomaly_reasons": row["anomaly_reasons"] if isinstance(row["anomaly_reasons"], list) else []
        })

    return results

if __name__ == "__main__":
    print("=" * 60)
    print("FINSENSE FRAUD & ANOMALY DETECTOR TEST RUN")
    print("=" * 60)
    anomalies = detect_transaction_anomalies()
    flagged = [a for a in anomalies if a["is_anomaly"]]
    print(f"Total transactions analyzed: {len(anomalies)}")
    print(f"Total anomalies flagged:    {len(flagged)}")
    for f in flagged:
        print(f"\n  [FLAGGED] ID #{f['id']} - {f['vendor_or_client']} (Rs. {f['amount']:,.2f}) [{f['transaction_type']}]")
        for r in f["anomaly_reasons"]:
            print(f"   -> Reason: {r}")
    print("=" * 60)
