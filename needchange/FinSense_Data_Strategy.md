# FinSense — Data Strategy Plan

Two separate, clearly distinct datasets are used in this project. **They serve different purposes and must never be mixed.**

---

## 1. Real Invoice/Receipt Data — For OCR Accuracy Testing Only

**Purpose:** Validate that the Tesseract OCR + NLP extraction pipeline works correctly on real-world, messy, varied invoices — regardless of which business they came from.

**Source:**
- High-Quality Invoice Images for OCR — https://www.kaggle.com/datasets/osamahosamabdellatif/high-quality-invoice-images-for-ocr
- OCR Receipts Text Detection (Retail Dataset) — https://www.kaggle.com/datasets/trainingdatapro/ocr-receipts-text-detection

**Important:** These datasets contain receipts/invoices from many **different real vendors** — there is no consistent business identity across them, and that is expected and correct. Their only job is to prove extraction accuracy.

**What to do with them:**
1. Download 20-30 sample images across both datasets
2. Run each through the OCR pipeline (Week 2)
3. Manually label the **correct** vendor / amount / date / category for each image (ground truth)
4. Compare pipeline output vs. ground truth → calculate Precision, Recall, F1-score (Week 12 evaluation)

**Storage location:**
```
data/real_invoices/
```

**Do NOT:**
- Try to make these match a consistent business name
- Use these for the dashboard demo, forecasting, or case memory
- Mix them into the synthetic dataset below

---

## 2. Synthetic Business Persona Data — For Demo, Forecasting & Case Memory

**Purpose:** Provide one consistent, coherent fictional SME whose invoice history, cash flow, and past spend decisions power the actual demo — dashboard, forecasting model, and case-based memory retrieval.

**Source:** Self-generated (via coding agent / script) — not from any public dataset, since no public dataset contains "spend decision + resulting cash flow outcome" pairs.

**Chosen persona:**
> **"Sivam Traders"** — a small retail/trading business
> Regular supplier invoices (stock purchases), rent, utilities, occasional equipment purchases, festival-season marketing spend, GST/CA compliance costs

**What this dataset must include:**
1. **6-12 months of transaction history** — mix of `income` and `expense` types (see balance-sync design)
2. **Consistent vendor names** across the whole set — e.g., "ABC Traders" (supplier), "CloudHost" (software), "Sharma Logistics" (delivery), "Kothari & Associates" (CA/compliance)
3. **Cash balance context** for every transaction (`cash_balance_before`, `cash_balance_after`, `upcoming_dues_next_30_days`)
4. **Outcome labels** for past spend decisions (`healthy` / `strained`), determined by checking balance trajectory in the following weeks
5. **Natural-language case descriptions** generated for each labeled case (used for embedding into ChromaDB)

**Example case entry:**
```json
{
  "vendor": "ABC Traders",
  "amount": 45000,
  "category": "Inventory Restocking",
  "type": "expense",
  "date": "2026-03-15",
  "cash_balance_before": 150000,
  "cash_balance_after": 105000,
  "outcome_label": "healthy",
  "case_description": "Paid ₹45,000 for inventory restocking to ABC Traders. Cash balance was ₹1,50,000 before, ₹1,05,000 after. No delayed payments in the following 3 weeks. Outcome: healthy."
}
```

**Storage location:**
```
data/synthetic/sivam_traders_transactions.json
```

**Used by:**
- Dashboard (balance, invoice list, category breakdown)
- Forecasting module — Prophet/LSTM training + ARIMA baseline (Week 5)
- Case Memory — embeddings seeded into ChromaDB (Week 6)
- Advisor / Fusion Engine — retrieval + explainable recommendations (Week 7-9)

---

## Summary Table

| | Real Invoice Data | Synthetic Persona Data |
|---|---|---|
| **Source** | Kaggle (public datasets) | Self-generated |
| **Vendor consistency** | None — many different real stores | Fully consistent — "Sivam Traders" ecosystem |
| **Used for** | OCR/extraction accuracy evaluation only | Dashboard, forecasting, case memory, demo |
| **Contains outcome labels?** | No | Yes |
| **Folder** | `data/real_invoices/` | `data/synthetic/` |

---

## One-Line Rule to Remember

**Real dataset → proves the OCR works. Synthetic dataset → tells the story the demo runs on. Never mix the two.**
