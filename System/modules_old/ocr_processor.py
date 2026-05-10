"""OCR processing module for document extraction"""

from PIL import Image
import pytesseract
import re
from datetime import datetime
from typing import Dict, Optional, List
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class OCRProcessor:
    """Process documents via OCR and extract expense data"""

    def __init__(self):
        self.tesseract_config = r'--oem 3 --psm 6'
        self.amount_patterns = [
            r'€?\s*(\d+[.,]\d{2})',
            r'Total[:\s]+€?\s*(\d+[.,]\d{2})',
            r'Amount[:\s]+€?\s*(\d+[.,]\d{2})',
            r'(\d+[.,]\d{2})\s*€',
        ]
        self.date_patterns = [
            r'(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})',
            r'(\d{4})-(\d{1,2})-(\d{1,2})',
        ]

    def process_document(self, file_path: str) -> Dict:
        """
        Process a document (image or PDF) and extract key data
        Returns dict with extracted: date, vendor, amount, description
        """
        try:
            if file_path.lower().endswith('.pdf'):
                try:
                    from pdf2image import convert_from_path
                    images = convert_from_path(file_path)
                    text = '\n'.join([
                        pytesseract.image_to_string(img, config=self.tesseract_config)
                        for img in images
                    ])
                except ImportError:
                    logger.warning("pdf2image not available, trying PIL instead")
                    img = Image.open(file_path)
                    text = pytesseract.image_to_string(img, config=self.tesseract_config)
            else:
                # Image file
                img = Image.open(file_path)
                text = pytesseract.image_to_string(img, config=self.tesseract_config)

            extracted = self.extract_fields(text)
            return {
                'status': 'success',
                'data': extracted,
                'raw_text': text
            }

        except Exception as e:
            logger.error(f"OCR processing error: {e}")
            return {
                'status': 'error',
                'message': str(e),
                'data': {}
            }

    def extract_fields(self, text: str) -> Dict:
        """Extract structured fields from OCR text"""
        extracted = {
            'vendor': self.extract_vendor(text),
            'amount': self.extract_amount(text),
            'date': self.extract_date(text),
            'description': self.extract_description(text),
            'currency': self.extract_currency(text),
        }
        return extracted

    def extract_amount(self, text: str) -> Optional[float]:
        """Extract amount from text"""
        for pattern in self.amount_patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    amount_str = match.group(1).replace(',', '.')
                    return float(amount_str)
                except (ValueError, IndexError):
                    continue
        return None

    def extract_date(self, text: str) -> Optional[str]:
        """Extract date from text in DD/MM/YYYY format"""
        for pattern in self.date_patterns:
            matches = re.findall(pattern, text)
            for match in matches:
                try:
                    if len(match[2]) == 2:
                        year = int(match[2])
                        year = 2000 + year if year < 50 else 1900 + year
                    else:
                        year = int(match[2])

                    month = int(match[1])
                    day = int(match[0])

                    if 1 <= month <= 12 and 1 <= day <= 31:
                        date_obj = datetime(year, month, day)
                        return date_obj.strftime('%d/%m/%Y')
                except (ValueError, IndexError):
                    continue
        return None

    def extract_vendor(self, text: str) -> Optional[str]:
        """Extract vendor/merchant name from text"""
        lines = text.split('\n')
        for line in lines[:10]:
            cleaned = line.strip()
            if len(cleaned) > 3 and len(cleaned) < 100:
                if not cleaned.isdigit():
                    return cleaned
        return None

    def extract_description(self, text: str) -> Optional[str]:
        """Extract transaction description"""
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        if len(lines) > 1:
            for line in lines[1:5]:
                if len(line) > 10 and not re.match(r'^[\d\s€,.]*$', line):
                    return line[:100]
        return None

    def extract_currency(self, text: str) -> str:
        """Extract currency (default EUR for € symbol)"""
        if '€' in text or 'EUR' in text.upper():
            return 'EUR'
        return 'EUR'

    def extract_from_batch(self, file_list: List[str]) -> List[Dict]:
        """Process multiple documents"""
        results = []
        for file_path in file_list:
            result = self.process_document(file_path)
            results.append({
                'file': file_path,
                **result
            })
        return results
