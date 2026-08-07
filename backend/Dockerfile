# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=app.py
ENV FLASK_ENV=development

# Set work directory
WORKDIR /app

# Install system dependencies
# - tesseract-ocr: required for OCR text extraction
# - libgl1-mesa-glx & libglib2.0-0: required for OpenCV (cv2) to run in headless Debian
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy project files
COPY . /app/

# Expose port 5000 for Flask
EXPOSE 5000

# Start Flask application
CMD ["python", "app.py"]
