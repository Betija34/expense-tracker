# Setup & Installation Guide

## Quick Start (5 minutes)

### For macOS (Recommended for this system)

1. **Install Tesseract OCR**
   ```bash
   brew install tesseract
   brew install poppler
   ```

2. **Install Python Dependencies**
   ```bash
   cd "/path/to/Rabona expense tracking sistem/System"
   pip install -r requirements.txt
   ```

3. **Run the Application**
   ```bash
   python expense_tracker_app.py
   ```

### For Windows

1. **Install Tesseract OCR**
   - Download installer: https://github.com/UB-Mannheim/tesseract/wiki
   - Run the installer (default path: `C:\Program Files\Tesseract-OCR`)
   - Update Python path in code if needed

2. **Install Python Dependencies**
   ```bash
   cd "C:\path\to\Rabona expense tracking sistem\System"
   pip install -r requirements.txt
   ```

3. **Run the Application**
   ```bash
   python expense_tracker_app.py
   ```

### For Linux (Ubuntu/Debian)

1. **Install Tesseract OCR**
   ```bash
   sudo apt-get install tesseract-ocr
   sudo apt-get install libpoppler-cpp-dev
   ```

2. **Install Python Dependencies**
   ```bash
   cd /path/to/Rabona\ expense\ tracking\ sistem/System
   pip install -r requirements.txt
   ```

3. **Run the Application**
   ```bash
   python expense_tracker_app.py
   ```

---

## Detailed Installation Steps

### Step 1: Verify Python Installation

Check Python version (must be 3.8+):
```bash
python --version
# or
python3 --version
```

### Step 2: Verify Tesseract Installation

After installing Tesseract, verify it works:
```bash
tesseract --version
```

You should see version information. If not, Tesseract is not properly installed.

**macOS Users:** If you see "command not found", add to `~/.zshrc`:
```bash
export PATH="/usr/local/bin:$PATH"
```
Then run:
```bash
source ~/.zshrc
```

**Windows Users:** If Tesseract is not recognized, the installer may not have added it to PATH. Either:
- Reinstall and check "Add to PATH" option, or
- Manually add `C:\Program Files\Tesseract-OCR` to System Environment Variables

### Step 3: Create Virtual Environment (Optional but Recommended)

Creating a virtual environment isolates dependencies for this project:

```bash
cd "/path/to/Rabona expense tracking sistem/System"

# Create virtual environment
python -m venv venv

# Activate it
# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate
```

### Step 4: Install Python Packages

With virtual environment activated (or using global Python):
```bash
pip install -r requirements.txt
```

This installs:
- **openpyxl** - Excel file handling
- **pytesseract** - Python interface to Tesseract
- **opencv-python** - Image processing for OCR
- **pillow** - Image operations
- **pdf2image** - PDF to image conversion
- **pandas** - Data analysis and manipulation

### Step 5: First Run Verification

Run the application and verify all tabs load:
```bash
python expense_tracker_app.py
```

**Expected behavior:**
- Application window opens
- Tabs visible: Dashboard, Upload Documents, Manual Entry, Bank Matching, Reports
- Dashboard shows current month summary (should show 0 entries on first run)
- No error messages in console

### Step 6: Verify Excel Files

Check that all three Excel files are present:
```bash
ls -la *.xlsx
```

Should show:
- `Rabona_2026_04.xlsx` (✓ created)
- `Espargos_2026_04.xlsx` (✓ created)
- `Settlement_2026_04.xlsx` (✓ created)

---

## Troubleshooting Installation

### Issue: "pytesseract: tesseract is not installed or it's not in your PATH"

**Solution:**
1. Install Tesseract from https://github.com/UB-Mannheim/tesseract/wiki
2. Verify installation: `tesseract --version`
3. On macOS, if using homebrew:
   ```bash
   brew reinstall tesseract
   ```
4. If still not found, update pytesseract to use custom path. Edit `modules/ocr_processor.py` and add:
   ```python
   import pytesseract
   pytesseract.pytesseract.pytesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'  # Windows
   # or
   pytesseract.pytesseract.pytesseract_cmd = '/usr/local/bin/tesseract'  # macOS
   ```

### Issue: "No module named 'openpyxl'" (or other import errors)

**Solution:**
```bash
# Make sure you're in the correct directory
cd "/path/to/Rabona expense tracking sistem/System"

# If using virtual environment, activate it
source venv/bin/activate  # macOS/Linux
# or
venv\Scripts\activate     # Windows

# Reinstall requirements
pip install --upgrade -r requirements.txt
```

### Issue: "ModuleNotFoundError: No module named 'modules'"

**Solution:**
1. Ensure you're running from the correct directory
2. Verify the `modules/` folder exists and has `__init__.py` files
3. Run from System folder:
   ```bash
   cd "/path/to/System"
   python expense_tracker_app.py
   ```

### Issue: PDF files not being processed

**Solution:**
1. Verify pdf2image is installed:
   ```bash
   pip install pdf2image --upgrade
   ```
2. On macOS, install poppler:
   ```bash
   brew install poppler
   ```
3. On Linux:
   ```bash
   sudo apt-get install poppler-utils
   ```

### Issue: tkinter not found (on Linux)

**Solution:**
```bash
# Ubuntu/Debian
sudo apt-get install python3-tk

# Fedora
sudo yum install python3-tkinter

# Arch
sudo pacman -S tk
```

---

## First Run Walkthrough

### 1. Start the Application
```bash
python expense_tracker_app.py
```

### 2. Dashboard Tab
- Verify current month and year display
- Check all summary cards load (Total Expenses, Complete/Incomplete entries)
- Try switching between Rabona and Espargos companies

### 3. Manual Entry Tab
- Click "Generate Reference" (should create reference like 26/04/1)
- Fill in sample expense data
- Click "Save Entry"
- Return to Dashboard and verify count increased

### 4. Upload Documents Tab
- Try uploading a sample PDF or image receipt
- Click "Process Documents"
- Verify OCR extracts data (date, vendor, amount)

### 5. Bank Matching Tab
- Create a sample CSV with format: Date, Description, Amount, Balance
- Upload CSV file
- Click "Find Matches"
- Review suggested matches

### 6. Reports Tab
- Select a report type
- Click "Generate Report"
- Report should be created in reports/ folder

---

## Configuration Files

### config.json
Auto-generated on first run. Contains:
```json
{
  "excel_dir": "/path/to/System",
  "temp_dir": "/path/to/System/temp",
  "reports_dir": "/path/to/System/reports",
  "current_year": 2026,
  "current_month": 4
}
```

To change current month, edit this file and restart the application.

---

## Database Backups

**Important:** Regularly backup Excel files!

### Recommended Backup Strategy
```bash
# Create dated backup
cp Rabona_2026_04.xlsx Rabona_2026_04_$(date +%Y%m%d).xlsx.bak
cp Espargos_2026_04.xlsx Espargos_2026_04_$(date +%Y%m%d).xlsx.bak
cp Settlement_2026_04.xlsx Settlement_2026_04_$(date +%Y%m%d).xlsx.bak
```

### Backup Frequency
- Daily during month-end close period
- Weekly during normal operations
- Immediately before major operations

---

## Next Steps After Installation

1. **Update Client List** - Add your 7 clients to Settings sheet
2. **Configure Categories** - Adjust expense categories as needed
3. **Set Payment Methods** - Customize payment method list
4. **Test OCR** - Scan a real receipt to test OCR accuracy
5. **Import First Month** - Upload documents for April 2026
6. **Run Bank Matching** - Test with your actual bank statement

---

## Getting Help

If you encounter issues:
1. Check this SETUP.md file
2. Review README.md for feature documentation
3. Check application console for error messages
4. Verify all files exist in System folder
5. Try running from System folder directory:
   ```bash
   cd "/path/to/System" && python expense_tracker_app.py
   ```

---

## System Requirements

### Minimum
- Python 3.8+
- 2GB RAM
- 500MB disk space
- Tesseract OCR (system)

### Recommended
- Python 3.10+
- 4GB+ RAM
- 1GB disk space for reports/backups
- Tesseract 5.0+ with language packs

### Supported OS
- macOS 10.12+
- Windows 7+
- Linux (any distro with Python 3.8+)

---

**Setup Last Updated:** April 27, 2026  
**Application Version:** 0.2.0 (Phase 2)
