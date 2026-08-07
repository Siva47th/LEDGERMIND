# FinSense — Implementation Plan

**IDE:** Antigravity (Gemini Flash 3.5 as coding agent)
**Timeline:** 12 weeks · ~4 hrs/day · ~360 hours total
**Cost:** ₹0 (fully open-source + free-tier stack)

---

## 0. Pre-Build Setup (Day 1, before Week 1 starts)

- [ ] Install Python 3.10+, Node.js, Tesseract OCR (system-level install, not just pip)
- [ ] Install Antigravity IDE, confirm Gemini Flash 3.5 is active as the default agent
- [ ] Create project folder structure (below)
- [ ] Initialize a **private** GitHub repo
- [ ] Create `.env` file and add it to `.gitignore` **immediately**, before the first commit — even though the Gemini API key isn't generated yet, lock this habit in now
- [ ] Install a local database for development (SQLite to start — simplest, zero setup)
- [ ] Download the SROIE dataset (real invoice OCR benchmark set)

### Project Folder Structure
```
finsense/
├── backend/
│   ├── ocr/                # Tesseract + preprocessing
│   ├── nlp/                # field extraction / classification
│   ├── forecasting/        # LSTM / Prophet / ARIMA
│   ├── case_memory/        # embeddings + vector DB
│   ├── fusion_engine/      # RAG + Adaptive Blending + LLM calls
│   ├── evaluation/         # F1, RMSE, Precision@K scripts
│   ├── voice/              # Web Speech API bridge endpoints (later)
│   └── app.py
├── frontend/
│   └── (React app: Dashboard, Invoices, Upload, Forecast, Advisor, Settings)
├── data/
│   ├── synthetic/
│   └── real_invoices/
├── models/
└── docs/
```

---

## 1. Priority Tiers (Reference Throughout the Build)

| Tier | Pages / Features | Priority |
|---|---|---|
| **Core** | Dashboard, Invoices, Forecast, Advisor | Must be robust — never compromised |
| **Supporting** | Login, Upload, Case Memory viewer, Fraud Alerts, Settings | Functional, lighter polish if time is short |
| **Add-on** | Voice I/O (English↔English, English input→Tamil output) | Built last, isolated — safe to trim if behind schedule |

**Rule:** if time runs short, simplify Supporting pages and trim Voice depth before ever touching Core.

---

## 2. Week-by-Week Plan

### Week 1 — Environment & Foundation
- Confirm all Pre-Build Setup steps are done
- Set up Flask/Django backend skeleton + React frontend skeleton
- Connect them with a basic health-check API call
- Set up SQLite schema for invoices table

### Week 2 — Invoice OCR Pipeline
- Integrate Tesseract OCR
- Add OpenCV preprocessing (deskew, grayscale, contrast) to improve accuracy
- Test on SROIE dataset samples — log raw OCR output
- Test on 5-10 of your own real invoices

### Week 3 — NLP Field Extraction + Storage
- Use spaCy (or a simple rules+regex hybrid to start) to extract vendor, amount, date, category from raw OCR text
- Store structured records in the database
- Begin manually labeling ground-truth fields for your real invoice sample (needed later for F1-score evaluation)

### Week 4 — Dashboard Skeleton (Core Page #1)
- Build Dashboard UI: balance, invoice count, upcoming dues, risk status, spend-by-category chart
- Build Invoices list page (Core Page #2)
- Wire both to real data from the database

### Week 5 — Forecasting Module (Core Page #3 backend)
- Generate synthetic historical cash flow dataset (6-12 months, 1-2 fictional businesses)
- Implement Prophet model (start here — simpler than LSTM)
- Implement ARIMA as baseline comparison
- Build Forecast page UI (actual vs. predicted chart)

### Week 6 — Case Memory Foundation
- Set up FAISS or Chroma vector database
- Generate embeddings for invoice/spend records
- Seed ~50-100 synthetic case-memory entries with outcome labels (healthy / strained)
- Build basic similarity retrieval function, test manually

### Week 7 — RAG + Fusion Engine (Core Page #4 backend)
- Generate Gemini API key **now** (this is the point it's actually required)
- Build RAG prompt construction: retrieved cases + forecast → prompt
- Connect to Gemini API, test basic recommendation generation
- Build Advisor page UI (chat-style interface)

### Week 8 — Adaptive Blending Algorithm
- Implement `confidence_weight = min(relevant_case_count / threshold, 1.0)`
- Wire the weight into prompt construction (generic vs. personalized emphasis)
- Test across simulated user stages: 0 cases, 6 cases, 25 cases — confirm behavior matches design

### Week 9 — End-to-End Integration
- Connect all layers: OCR → NLP → DB → Forecast → Case Memory → Fusion → UI
- Full flow test: upload invoice → ask a spend question → get explainable recommendation
- Fix integration bugs
- **Checkpoint: Core system should be fully functional and demoable by end of this week**

### Week 10 — Supporting Features (Tier 2)
- Fraud/anomaly detection (Isolation Forest or K-Means) on invoice amounts/patterns
- Risk score calculation
- Case Memory viewer page, Fraud Alerts page
- Login/Signup page, Settings page (Adaptive Blending threshold, starting balance)

### Week 11 — Voice Add-On (Tier 3)
- Implement Web Speech API: English speech-to-text input
- Implement text-to-speech output — English mode
- Add Tamil output mode (Gemini generates Tamil response text → `ta-IN` TTS)
- Add language toggle in Settings

### Week 12 — Evaluation, Testing, Documentation
- Run extraction evaluation: Precision/Recall/F1 on your 20-30 labeled real invoices
- Run forecasting evaluation: MAE/RMSE/MAPE on held-out test weeks, compare LSTM/Prophet vs. ARIMA baseline
- Run retrieval evaluation: Precision@K on 10-15 test queries
- Small informal user test (5-10 people) for qualitative feedback
- Finalize documentation, prepare final presentation

---

## 3. Evaluation Checklist (Don't Skip — Do This in Week 12)

| Component | Metric | Data Needed |
|---|---|---|
| OCR/Extraction | Precision, Recall, F1-score | 20-30 real invoices, manually labeled |
| Forecasting | MAE, RMSE, MAPE + baseline comparison | Held-out last 2-4 weeks of synthetic data |
| Case Retrieval | Precision@K | 10-15 test queries, manually judged relevance |
| Overall System | Qualitative feedback | 5-10 informal user testers |

---

## 4. Known Limitations (State These Proactively)

1. No real bank account integration — balance is derived/manual
2. Primarily synthetic training data, supplemented by a small real-invoice sample
3. Rule-based outcome labeling, not a learned classifier
4. Voice supports English↔English and English-input→Tamil-output only — not true Tanglish code-switched recognition

---

## 5. Security Checklist

- [ ] `.env` for all API keys, never hardcoded, never committed
- [ ] Passwords hashed (bcrypt) if login is implemented
- [ ] Per-user data isolation in database queries
- [ ] File upload validation (type + size limits)
- [ ] HTTPS on any deployed version

---

## 6. Starter Prompt for Antigravity (Gemini Flash 3.5)

Copy the block below into Antigravity to kick off Week 1 implementation.

```
I'm building a final year project called FinSense — an AI-driven invoice
intelligence system with predictive forecasting and explainable case-based
financial advisory. Act as my coding agent for this build.

PROJECT CONTEXT:
FinSense automates invoice data extraction, forecasts short-term cash flow,
and builds a memory of past spend decisions tagged with outcomes. When a
user proposes a new spend, it retrieves similar past cases, fuses them with
a live forecast, and generates an explainable recommendation via RAG + an
LLM — not just what will happen, but why, grounded in what happened before.

ARCHITECTURE (4 layers):
1. Invoice Processing — Tesseract OCR + spaCy NLP → structured storage
2. Forecasting — Prophet/LSTM cash flow prediction, benchmarked against ARIMA
3. Case Memory — vector embeddings (FAISS/Chroma) of past spend + outcomes,
   retrieved via cosine similarity
4. Fusion & Reasoning — RAG prompt combining retrieved cases + forecast +
   an Adaptive Blending confidence weight → Gemini API → explainable output

TECH STACK:
Backend: Python, Flask, Tesseract OCR, spaCy, Prophet, PyTorch (LSTM),
statsmodels (ARIMA), FAISS or Chroma, scikit-learn (evaluation)
Frontend: React
Database: SQLite for now (will migrate to MongoDB Atlas later)
LLM: Gemini API (key to be added in Week 7 — not needed yet)

TASK FOR THIS SESSION (Week 1):
1. Scaffold the project folder structure exactly as below:

finsense/
├── backend/
│   ├── ocr/
│   ├── nlp/
│   ├── forecasting/
│   ├── case_memory/
│   ├── fusion_engine/
│   ├── evaluation/
│   ├── voice/
│   └── app.py
├── frontend/
├── data/
│   ├── synthetic/
│   └── real_invoices/
├── models/
└── docs/

2. Set up a minimal Flask backend in app.py with a single health-check
   route (GET /api/health returning {"status": "ok"}).
3. Set up a minimal React app (via Vite) in /frontend that fetches and
   displays the health-check response, confirming frontend-backend
   connectivity.
4. Set up a SQLite database with an `invoices` table with these columns:
   id, vendor, amount, category, date, cash_balance_at_time, outcome_label,
   created_at.
5. Create a requirements.txt with all backend dependencies listed in the
   tech stack above.
6. Create a .env.example file (not .env) showing expected variables like
   GEMINI_API_KEY=, and make sure .gitignore excludes .env, __pycache__,
   node_modules, and any local database files.

Explain each file you create as you go, and keep the code simple and
well-commented since I need to understand and defend every part of this
in my project viva.
```

---

**Next step after this plan:** run the Week 1 prompt above in Antigravity, confirm the health-check connects frontend to backend, then move to Week 2 (OCR pipeline).
