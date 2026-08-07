import os
import cv2
import numpy as np
import pytesseract
import pdfplumber
import pypdfium2 as pdfium
from PIL import Image

# If Tesseract is not in your system environment PATH, uncomment and set this line:
# pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

def preprocess_image_for_ocr(image):
    """
    Applies image preprocessing techniques using OpenCV to clean the document 
    and maximize Tesseract OCR character recognition accuracy.
    
    Steps:
    1. Convert to Grayscale
    2. Apply Deskewing (if tilted)
    3. Apply OTSU Binarization / Thresholding (convert to high-contrast black & white)
    """
    # Step 1: Grayscale conversion (if not already grayscale)
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()

    # Step 2: Deskewing (aligning tilted scans)
    try:
        # Threshold the image to find text blocks
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
        
        # Find all coordinates where pixels are non-zero (text coordinates)
        coords = np.column_stack(np.where(thresh > 0))
        
        # Calculate the minimum area bounding box containing all text points
        angle = cv2.minAreaRect(coords)[-1]
        
        # minAreaRect returns angle in range [-90, 0)
        # Normalize the angle for deskewing
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle
            
        # Rotate if the tilt is significant (between 0.5 and 15 degrees)
        if 0.5 < abs(angle) < 15:
            (h, w) = image.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            gray = cv2.warpAffine(gray, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
            print(f"[OCR Preprocess] Deskewed image by {angle:.2f} degrees.")
    except Exception as e:
        print(f"[OCR Preprocess] Deskew failed (skipping): {e}")

    # Step 3: Thresholding/Binarization
    # Apply Otsu's thresholding to get clean, crisp black and white text characters
    processed = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    
    return processed

def extract_text_from_image(file_path):
    """
    Loads an image file, runs OpenCV preprocessing, and performs Tesseract OCR.
    """
    print(f"[OCR] Processing image file: {os.path.basename(file_path)}")
    
    # Read the image via OpenCV
    img = cv2.imread(file_path)
    if img is None:
        raise ValueError(f"Could not load image at path: {file_path}")
        
    # Preprocess
    preprocessed_img = preprocess_image_for_ocr(img)
    
    # Run OCR
    # config: --oem 3 (Default OCR engine mode) --psm 6 (Assume a single uniform block of text)
    custom_config = r'--oem 3 --psm 3'
    text = pytesseract.image_to_string(preprocessed_img, config=custom_config)
    
    return text

def extract_text_from_pdf(file_path):
    """
    Extracts text from a PDF file.
    1. First attempts digital text extraction via pdfplumber (very fast, 100% accurate).
    2. If no text is extracted (meaning it is a scanned image PDF), renders each page 
       to an image via pypdfium2 and runs OCR on the rendered pages.
    """
    print(f"[PDF Parser] Processing PDF file: {os.path.basename(file_path)}")
    
    # 1. Attempt digital text extraction
    digital_text = ""
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    digital_text += page_text + "\n"
    except Exception as e:
        print(f"[PDF Parser] Digital text extraction failed/errored: {e}")
        
    # If we found substantial digital text, return it immediately
    if digital_text.strip():
        print(f"[PDF Parser] Successfully extracted digital text directly (OCR skipped).")
        return digital_text
        
    # 2. Fall back to OCR if digital text is empty (scanned PDF)
    print(f"[PDF Parser] No digital text found. Falling back to OCR...")
    ocr_text = ""
    
    try:
        # Load PDF using pdfium
        pdf = pdfium.PdfDocument(file_path)
        
        for page_idx, page in enumerate(pdf):
            print(f"[PDF Parser] OCR rendering and processing page {page_idx + 1}/{len(pdf)}...")
            
            # Render page to a high-resolution PIL image (scale=2, ~150-200 DPI)
            pil_image = page.render(scale=2).to_pil()
            
            # Convert PIL image to OpenCV numpy array
            open_cv_image = np.array(pil_image)
            # Convert RGB to BGR (OpenCV format)
            if len(open_cv_image.shape) == 3 and open_cv_image.shape[2] == 3:
                open_cv_image = cv2.cvtColor(open_cv_image, cv2.COLOR_RGB2BGR)
                
            # Preprocess the rendered page
            preprocessed_page = preprocess_image_for_ocr(open_cv_image)
            
            # Run OCR on the page
            page_text = pytesseract.image_to_string(preprocessed_page, config=r'--oem 3 --psm 3')
            ocr_text += f"\n--- PAGE {page_idx + 1} ---\n" + page_text
            
        pdf.close()
    except Exception as e:
        raise RuntimeError(f"Failed during scanned PDF OCR fallback: {e}")
        
    return ocr_text

def extract_text_from_file(file_path):
    """
    Wrapper function to extract text from any supported invoice file format.
    Supports: .pdf, .png, .jpg, .jpeg, .tiff
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
        
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == '.pdf':
        return extract_text_from_pdf(file_path)
    elif ext in ['.png', '.jpg', '.jpeg', '.tiff', '.bmp']:
        return extract_text_from_image(file_path)
    else:
        raise ValueError(f"Unsupported file format: {ext}")

if __name__ == "__main__":
    # Test script locally with a dummy parameter
    print("OCR/Text Ingestion Pipeline Module loaded.")
