import os
import sys
import chromadb
from chromadb.config import Settings

# Ensure parent path is available for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CHROMA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "chroma_db")
COLLECTION_NAME = "finsense_cases"

# Global client and collection handles
client = None
collection = None

def get_vector_store():
    """
    Initializes and returns the persistent ChromaDB client and collection.
    """
    global client, collection
    if collection is not None:
        return client, collection

    os.makedirs(CHROMA_DIR, exist_ok=True)
    print(f"[Case Memory] Connecting to ChromaDB vector store at: {CHROMA_DIR}")

    client = chromadb.PersistentClient(path=CHROMA_DIR)
    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}
    )
    print(f"[Case Memory] Vector collection '{COLLECTION_NAME}' active with {collection.count()} entries.")
    return client, collection


def seed_initial_cases():
    """
    Seeds ~60 realistic small-business case memories into ChromaDB if collection is empty.
    Each case contains a rich text representation for semantic retrieval,
    along with outcome labels ('healthy' or 'strained').
    """
    _, col = get_vector_store()
    
    if col.count() > 0:
        print(f"[Case Memory] Collection already seeded with {col.count()} cases. Skipping initial seed.")
        return

    print("[Case Memory] Seeding initial small-business case memory database...")

    seed_cases = [
        # --- EQUIPMENT & HARDWARE ---
        {"id": "case_101", "vendor": "Dell India", "amount": 65000.0, "type": "expense", "category": "Shopping", "outcome": "healthy", "notes": "Purchased core development laptop for new developer. Boosted delivery velocity."},
        {"id": "case_102", "vendor": "Apple Store", "amount": 145000.0, "type": "expense", "category": "Shopping", "outcome": "strained", "notes": "Bought high-end MacBook Pro when cash reserve was tight. Strained cash balance below safety threshold."},
        {"id": "case_103", "vendor": "Croma Electronics", "amount": 28000.0, "type": "expense", "category": "Shopping", "outcome": "healthy", "notes": "Bought barcode scanner and POS receipt thermal printer for store counter."},
        {"id": "case_104", "vendor": "HP Store", "amount": 18500.0, "type": "expense", "category": "Shopping", "outcome": "healthy", "notes": "Purchased laser jet printer for office invoicing and dispatch billing."},
        {"id": "case_105", "vendor": "Logitech India", "amount": 4500.0, "type": "expense", "category": "Shopping", "outcome": "healthy", "notes": "Wireless keyboards and ergonomic mice for office workstations."},

        # --- SOFTWARE & CLOUD SERVICES ---
        {"id": "case_201", "vendor": "Amazon Web Services", "amount": 12500.0, "type": "expense", "category": "Software", "outcome": "healthy", "notes": "Monthly AWS cloud hosting renewal for web app and backend API databases."},
        {"id": "case_202", "vendor": "Google Workspace", "amount": 3400.0, "type": "expense", "category": "Software", "outcome": "healthy", "notes": "Business email domain licenses for 10 team members."},
        {"id": "case_203", "vendor": "Tally Solutions", "amount": 22500.0, "type": "expense", "category": "Software", "outcome": "healthy", "notes": "Annual renewal for Tally Prime Gold accounting software license."},
        {"id": "case_204", "vendor": "Adobe Systems", "amount": 4800.0, "type": "expense", "category": "Software", "outcome": "healthy", "notes": "Adobe Creative Cloud subscription for marketing designer."},
        {"id": "case_205", "vendor": "Canva Pro", "amount": 1200.0, "type": "expense", "category": "Software", "outcome": "healthy", "notes": "Canva graphics subscription for social media banners and promotional flyers."},
        {"id": "case_206", "vendor": "Enterprise ERP Suite", "amount": 85000.0, "type": "expense", "category": "Software", "outcome": "strained", "notes": "Upfront annual ERP software payment created temporary cash crunch before month-end receivables."},

        # --- MARKETING & ADVERTISING ---
        {"id": "case_301", "vendor": "Meta Ads", "amount": 15000.0, "type": "expense", "category": "Marketing", "outcome": "healthy", "notes": "Facebook & Instagram festive ad campaign. Generated ₹85,000 in new retail sales."},
        {"id": "case_302", "vendor": "Google Ads", "amount": 25000.0, "type": "expense", "category": "Marketing", "outcome": "healthy", "notes": "Search engine keyword campaign targeting local business customers."},
        {"id": "case_303", "vendor": "Local Print Media", "amount": 8000.0, "type": "expense", "category": "Marketing", "outcome": "healthy", "notes": "Printed 5,000 promotional pamphlets and newspaper inserts for store grand opening."},
        {"id": "case_304", "vendor": "Influencer Agency", "amount": 45000.0, "type": "expense", "category": "Marketing", "outcome": "strained", "notes": "Influencer promotion yielded low ROI compared to outlay, causing cash strain before payroll date."},

        # --- UTILITIES & OFFICE OPERATING COSTS ---
        {"id": "case_401", "vendor": "Tamil Nadu Electricity Board (TNEB)", "amount": 9200.0, "type": "expense", "category": "Utilities", "outcome": "healthy", "notes": "Monthly commercial electricity bill for office and store air conditioning."},
        {"id": "case_402", "vendor": "Airtel Broadband", "amount": 2499.0, "type": "expense", "category": "Utilities", "outcome": "healthy", "notes": "High-speed fiber internet and landline connection for office."},
        {"id": "case_403", "vendor": "Commercial Realty Trust", "amount": 45000.0, "type": "expense", "category": "Utilities", "outcome": "healthy", "notes": "Monthly commercial store and warehouse lease rent payment."},
        {"id": "case_404", "vendor": "Mineral Water Suppliers", "amount": 1500.0, "type": "expense", "category": "Utilities", "outcome": "healthy", "notes": "Monthly drinking water dispenser cans for staff and visiting customers."},
        {"id": "case_405", "vendor": "City Sanitation Services", "amount": 3000.0, "type": "expense", "category": "Utilities", "outcome": "healthy", "notes": "Deep cleaning and pest control service for store premises."},

        # --- PROFESSIONAL FEES & TAX COMPLIANCE ---
        {"id": "case_501", "vendor": "Kothari & Associates (CA)", "amount": 15000.0, "type": "expense", "category": "Financial", "outcome": "healthy", "notes": "Quarterly GST return filing and auditor compliance certification fee."},
        {"id": "case_502", "vendor": "Legal Counsel Firm", "amount": 20000.0, "type": "expense", "category": "Financial", "outcome": "healthy", "notes": "Commercial lease agreement drafting and trademark registration legal fee."},
        {"id": "case_503", "vendor": "HDFC Bank", "amount": 3500.0, "type": "expense", "category": "Financial", "outcome": "healthy", "notes": "Annual bank current account maintenance and POS terminal processing charges."},

        # --- INVENTORY & SUPPLIES ---
        {"id": "case_601", "vendor": "Metro Cash & Carry", "amount": 82000.0, "type": "expense", "category": "Shopping", "outcome": "healthy", "notes": "Bulk inventory restocking of groceries and FMCG goods for store shelves."},
        {"id": "case_602", "vendor": "Package Craft India", "amount": 12000.0, "type": "expense", "category": "Shopping", "outcome": "healthy", "notes": "Custom printed eco-friendly paper bags and cardboard shipping boxes."},
        {"id": "case_603", "vendor": "National Wholesalers", "amount": 120000.0, "type": "expense", "category": "Shopping", "outcome": "strained", "notes": "Bulk inventory purchase right before festival season temporarily depleted liquid reserves."},

        # --- CLIENT REVENUE & INCOME ---
        {"id": "case_701", "vendor": "Apex Enterprises (Client)", "amount": 150000.0, "type": "income", "category": "Financial", "outcome": "healthy", "notes": "Received final milestone payment for corporate consulting project."},
        {"id": "case_702", "vendor": "Sri Lakshmi Supermarket (Store Sales)", "amount": 52552.50, "type": "income", "category": "Shopping", "outcome": "healthy", "notes": "Daily retail sales revenue settlement received via UPI and POS terminal."},
        {"id": "case_703", "vendor": "Global Tech Solutions (Client)", "amount": 95000.0, "type": "income", "category": "Software", "outcome": "healthy", "notes": "Advance payment received for software implementation service contract."},
        {"id": "case_704", "vendor": "Star Retailers (Client)", "amount": 68000.0, "type": "income", "category": "Shopping", "outcome": "healthy", "notes": "Wholesale goods dispatch invoice cleared by client."},

        # --- REFUNDS & RETURNS ---
        {"id": "case_801", "vendor": "Dell India (Vendor Refund)", "amount": 8500.0, "type": "return_in", "category": "Shopping", "outcome": "healthy", "notes": "Received partial refund credited to account for returned damaged monitor."},
        {"id": "case_802", "vendor": "Customer Refund Issued", "amount": 3200.0, "type": "return_out", "category": "Shopping", "outcome": "healthy", "notes": "Refund given to customer for returned defective item."}
    ]

    documents = []
    metadatas = []
    ids = []

    for case in seed_cases:
        # Build rich semantic search document text
        doc_text = f"Transaction with {case['vendor']} for amount Rs.{case['amount']:.2f}. " \
                   f"Category: {case['category']}, Type: {case['type']}. " \
                   f"Notes: {case['notes']} Outcome state: {case['outcome']}."

        documents.append(doc_text)
        metadatas.append({
            "vendor_or_client": case["vendor"],
            "amount": case["amount"],
            "transaction_type": case["type"],
            "category": case["category"],
            "outcome": case["outcome"],
            "notes": case["notes"]
        })
        ids.append(case["id"])

    # Batch add to ChromaDB
    col.add(documents=documents, metadatas=metadatas, ids=ids)
    print(f"[Case Memory] Successfully seeded {len(ids)} small-business case memories into ChromaDB!")


def add_case_memory(txn_id, vendor_or_client, amount, transaction_type, category, notes, outcome="healthy"):
    """
    Indexes a new user transaction into the ChromaDB vector store.
    Called whenever a user uploads an invoice or adds a transaction manually.
    """
    try:
        _, col = get_vector_store()
        doc_id = f"txn_{txn_id}"
        
        doc_text = f"Transaction with {vendor_or_client} for amount Rs.{amount:.2f}. " \
                   f"Category: {category}, Type: {transaction_type}. " \
                   f"Notes: {notes if notes else 'N/A'}. Outcome state: {outcome}."

        metadata = {
            "vendor_or_client": vendor_or_client,
            "amount": float(amount),
            "transaction_type": transaction_type,
            "category": category,
            "outcome": outcome,
            "notes": notes if notes else ""
        }

        # Upsert into ChromaDB
        col.upsert(documents=[doc_text], metadatas=[metadata], ids=[doc_id])
        print(f"[Case Memory] Indexed transaction #{txn_id} ({vendor_or_client}) into ChromaDB vector store.")
        return True
    except Exception as e:
        print(f"[Case Memory Error] Failed to index transaction #{txn_id}: {e}")
        return False


def query_similar_cases(query_text, top_k=3):
    """
    Performs semantic vector search across all indexed case memories
    and returns top_k relevant cases with similarity scores and outcome states.
    """
    try:
        _, col = get_vector_store()
        
        if col.count() == 0:
            seed_initial_cases()

        results = col.query(
            query_texts=[query_text],
            n_results=min(top_k, col.count())
        )

        formatted_cases = []
        if results and "ids" in results and len(results["ids"][0]) > 0:
            for i in range(len(results["ids"][0])):
                case_id = results["ids"][0][i]
                metadata = results["metadatas"][0][i]
                doc = results["documents"][0][i]
                distance = results["distances"][0][i] if "distances" in results and results["distances"] else 0.0
                
                # Convert cosine distance to similarity percentage score
                similarity_score = max(0.0, round((1.0 - distance) * 100.0, 1))

                formatted_cases.append({
                    "id": case_id,
                    "vendor_or_client": metadata.get("vendor_or_client", ""),
                    "amount": metadata.get("amount", 0.0),
                    "transaction_type": metadata.get("transaction_type", "expense"),
                    "category": metadata.get("category", "Miscellaneous"),
                    "outcome": metadata.get("outcome", "healthy"),
                    "notes": metadata.get("notes", ""),
                    "similarity_score": similarity_score,
                    "summary_text": doc
                })

        return formatted_cases
    except Exception as e:
        print(f"[Case Memory Query Error] Search failed: {e}")
        return []


def get_all_cases():
    """
    Returns all indexed cases from ChromaDB for viewing in the UI.
    """
    try:
        _, col = get_vector_store()
        if col.count() == 0:
            seed_initial_cases()
            
        data = col.get()
        cases = []
        if data and "ids" in data:
            for i in range(len(data["ids"])):
                meta = data["metadatas"][i]
                cases.append({
                    "id": data["ids"][i],
                    "vendor_or_client": meta.get("vendor_or_client", ""),
                    "amount": meta.get("amount", 0.0),
                    "transaction_type": meta.get("transaction_type", "expense"),
                    "category": meta.get("category", "Miscellaneous"),
                    "outcome": meta.get("outcome", "healthy"),
                    "notes": meta.get("notes", "")
                })
        return cases
    except Exception as e:
        print(f"[Case Memory Error] Failed to fetch all cases: {e}")
        return []


if __name__ == "__main__":
    print("=" * 60)
    print("FINSENSE VECTOR STORE & CASE MEMORY TEST RUN")
    print("=" * 60)
    seed_initial_cases()
    
    test_query = "Buying new development laptop for company"
    print(f"\nTesting semantic search query: '{test_query}'")
    matches = query_similar_cases(test_query, top_k=3)
    
    for idx, match in enumerate(matches, 1):
        print(f"\nMatch #{idx} (Similarity: {match['similarity_score']}%):")
        print(f" - Vendor:   {match['vendor_or_client']}")
        print(f" - Amount:   Rs.{match['amount']:.2f}")
        print(f" - Outcome:  {match['outcome'].upper()}")
        print(f" - Notes:    {match['notes']}")
    print("=" * 60)
