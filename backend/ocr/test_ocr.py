import os
import sys

# Add the parent directory of the current script to python path
# This allows importing 'backend.ocr.pipeline'
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.ocr.pipeline import extract_text_from_file

def run_ocr_tests():
    # Path to the user's invoices directory
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    invoices_dir = os.path.join(base_dir, "invoices")
    output_dir = os.path.join(invoices_dir, "extracted_text")
    
    # Create the output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    print("=" * 60)
    print("FINSENSE - INVOICE OCR & EXTRACTION PIPELINE TESTER")
    print("=" * 60)
    print(f"Source folder: {invoices_dir}")
    print(f"Destination folder: {output_dir}")
    print("=" * 60)
    
    if not os.path.exists(invoices_dir):
        print(f"Error: Invoices directory '{invoices_dir}' not found.")
        return
        
    files = [f for f in os.listdir(invoices_dir) if os.path.isfile(os.path.join(invoices_dir, f))]
    
    if not files:
        print("No files found in the 'invoices' folder to test.")
        return
        
    print(f"Found {len(files)} files to process.\n")
    
    success_count = 0
    failure_count = 0
    
    for filename in files:
        file_path = os.path.join(invoices_dir, filename)
        output_txt_path = os.path.join(output_dir, f"{filename}_raw.txt")
        
        print(f"Processing: '{filename}'")
        try:
            # Extract raw text from the file
            extracted_text = extract_text_from_file(file_path)
            
            # Save extracted text to local output file
            with open(output_txt_path, "w", encoding="utf-8") as out_file:
                out_file.write(extracted_text)
                
            print(f" -> SUCCESS! Saved to: {os.path.basename(output_txt_path)}")
            
            # Print a snippet preview
            preview = extracted_text.strip().replace("\n", " ")[:100]
            print(f" -> Preview: {preview}...\n")
            success_count += 1
            
        except Exception as e:
            print(f" -> FAILED! Error: {e}\n")
            failure_count += 1
            
    print("=" * 60)
    print("TEST EXECUTION SUMMARY")
    print("=" * 60)
    print(f"Total processed: {len(files)}")
    print(f"Successful:      {success_count}")
    print(f"Failed:          {failure_count}")
    print(f"Outputs saved in: {output_dir}")
    print("=" * 60)

if __name__ == "__main__":
    run_ocr_tests()
