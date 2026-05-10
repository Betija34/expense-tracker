# Rabona Holdings - Expense Tracking System

## Overview

A hybrid desktop application for comprehensive expense tracking, document OCR processing, and financial reporting for Rabona Holdings Ltd (Cyprus) and Espargos Ltd.

**Phase 1: Excel Templates** ✓ Completed
- Rabona_2026_04.xlsx - Main expense database
- Espargos_2026_04.xlsx - Subsidiary expense tracking
- Settlement_2026_04.xlsx - Inter-company transfer tracking

**Phase 2: Python Desktop Application** 🚀 In Development
- Document upload and OCR extraction
- Manual expense entry form
- Bank statement matching with approval workflow
- Report generation (multiple formats)
- Dashboard with real-time summaries

**Phase 3: Advanced Features** (Coming Soon)
- Month-end checklist
- User guide and documentation
- Backup and archive strategies

## Installation

### Prerequisites

- Python 3.8+
- pip (Python package manager)
- Tesseract OCR (system-level installation required)

### System Dependencies

#### Windows
```bash
# Install Tesseract OCR
# Download from: https://github.com/UB-Mannheim/tesseract/wiki
# Run the installer and note the installation path
```

#### macOS
```bash
brew install tesseract
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt-get install tesseract-ocr
```

### Python Dependencies

```bash
cd /path/to/System
pip install -r requirements.txt
```

### macOS Specific Setup (if using pdf2image)
```bash
brew install poppler
```

## Running the Application

### Start the Desktop Application

```bash
python expense_tracker_app.py
```

The application will open with a tabbed interface providing access to all features.

## Features

### 1. Dashboard
- Company selection (Rabona/Espargos)
- Month selector
- Key metrics display:
  - Total expenses for the month
  - Complete vs. incomplete entries
  - Quick action buttons

### 2. Upload Documents
- Drag-and-drop file upload
- Supported formats: PDF, PNG, JPG
- Automatic OCR extraction
- Fields extracted:
  - Date
  - Vendor/Merchant
  - Amount
  - Currency
  - Description
- Review and edit extracted data before saving

### 3. Manual Entry
- Quick form for manual expense entry
- Auto-generated reference numbers (YY/MM/SEQ format)
- Payment breakdown support (Company/Client/Shareholder portions)
- Complete/incomplete status tracking
- Document link attachment

### 4. Bank Statement Matching
- CSV/Excel bank statement import
- Intelligent transaction matching:
  - Amount comparison (configurable tolerance)
  - Date range matching (configurable window)
  - Description similarity scoring
- Confidence scoring (0-100%)
- User approval workflow
- Batch matching with one-click approval

### 5. Reports
Multiple report types available:
- **Monthly Summary** - Expenses by category
- **Client Invoice Report** - Items to invoice to clients
- **Shareholder Settlement** - Account movements
- **Travel Expenses** - Travel reimbursement summary
- **Inter-Company Transfers** - Rabona ↔ Espargos flows
- **Bank Reconciliation** - Unmatched transactions
- **Incomplete Entries** - Items requiring attention
- **Year-End Summary** - Full financial summary

Export formats: Excel (.xlsx), PDF, CSV

## Reference Numbering System

### Standard Expenses
Format: `YY/MM/SEQ`
Example: `26/04/1` (Year 26, Month 04, Sequence 1)

### Travel Expenses
Format: `TMONTH/SEQ`
Example: `T04/1` (April, Travel, Sequence 1)

### Client Reimbursables
Format: `RMONTH/SEQ`
Example: `R04/1` (April, Reimbursable, Sequence 1)

### Shareholder Salary
Format: `SMONTH/SEQ`
Example: `S04/1` (April, Salary, Sequence 1)

### Internal Transfers
Format: `26/04/1 (Internal Transfer: FROM Account → TO Account)`
Example: `26/04/1 (Internal Transfer: Mastercard → Current Account)`

### Inter-Company Transfers
Format: `E26/04/1 (Transfer: FROM Company → TO Company)`
Example: `E26/04/1 (Transfer: Rabona → Espargos)`

## Payment Breakdown

Expenses can be split across three portions:
- **Company Portion** - Expense charged to company
- **Client Portion** - To be reimbursed by client
- **Shareholder Portion** - Expense on behalf of shareholder

All portions must sum to the total amount.

## Excel File Structure

### Rabona_2026_04.xlsx
**Sheets:**
- **Expense Data** - Main data entry sheet (50 rows)
  - Columns: Reference, Date, Vendor, Description, Amount (€), Currency, Category, Subcategory, Payment Method, Travel Ref, Reimb Ref, Status, Document Link
  
- **Settings** - Configuration data
  - Company info: VAT number, registration
  - Categories and subcategories
  - Payment methods
  - Client list (expandable)
  
- **Month Summary** - Auto-calculated totals
  - Total expenses formula
  - Complete/incomplete counts
  - Category breakdown
  
- **Shareholder Account** - Per-shareholder tracking
  - Opening balance
  - Investments in
  - Expenses paid on behalf
  - Company advances
  - Closing balance (auto-calculated)
  
- **Incomplete Entries** - Tracking sheet
  - Lists entries missing required fields
  - Shows which fields need attention

### Espargos_2026_04.xlsx
Similar structure to Rabona, with simplified categories and a flexible "Reference/Comments" field instead of rigid "Paid For" categorization.

### Settlement_2026_04.xlsx
- **Internal Transfers** - Rabona's own account transfers
- **Inter-Company Transfers** - Rabona ↔ Espargos transactions
- **Account Balances** - Tracking for all four accounts
- **Settlement Account** - Monthly net balance calculation

## Configuration

Configuration is auto-generated on first run at `config.json`:

```json
{
  "excel_dir": "/path/to/System",
  "temp_dir": "/path/to/System/temp",
  "reports_dir": "/path/to/System/reports",
  "current_year": 2026,
  "current_month": 4
}
```

## Data Flow

1. **Document Upload** → OCR Processing → Extract Fields
2. **Manual Entry** → Form Validation → Excel Storage
3. **Bank Matching** → Amount + Date Comparison → User Approval → Status Update
4. **Report Generation** → Query Excel Data → Format & Export

## OCR Accuracy Tips

- Use high-quality scans (300+ DPI)
- Ensure good lighting for photographs
- Straight alignment is important
- Handwritten documents: manual entry recommended

## Troubleshooting

### OCR Not Working
- Verify Tesseract is installed: `tesseract --version`
- Check Tesseract path in code if custom installation
- Use high-quality images for better results

### File Not Saving
- Ensure Excel files are not open in another application
- Check folder permissions
- Verify disk space available

### Bank Matching Issues
- Check CSV/Excel format matches expected structure
- Date format must be: DD/MM/YYYY or YYYY-MM-DD
- Ensure amounts are in numeric format (no currency symbols)

## File Locations

```
/path/to/Rabona expense tracking sistem/System/
├── expense_tracker_app.py          # Main application
├── config.json                     # Configuration
├── requirements.txt                # Python dependencies
├── README.md                       # This file
├── modules/
│   ├── __init__.py
│   ├── ocr_processor.py           # OCR extraction
│   ├── excel_handler.py           # Excel I/O
│   ├── bank_matcher.py            # Bank matching
│   └── ui/
│       ├── __init__.py
│       ├── main_window.py         # Main UI window
│       └── tabs/
│           ├── __init__.py
│           ├── dashboard.py       # Dashboard tab
│           ├── document_upload.py # Upload tab
│           ├── manual_entry.py    # Entry form tab
│           ├── bank_matching.py   # Matching tab
│           └── reports.py         # Reports tab
├── Rabona_2026_04.xlsx            # Rabona database
├── Espargos_2026_04.xlsx          # Espargos database
├── Settlement_2026_04.xlsx        # Settlement tracking
├── temp/                          # Temporary files
└── reports/                       # Generated reports
```

## Future Enhancements (Phase 3)

- Email integration for report distribution
- Budget vs. actual analysis
- Year-end audit trail
- Bank account auto-sync (API integration)
- Monthly checklist automation
- Backup and restore functionality
- Client portal for reimbursement review
- Shareholder expense tracking dashboard

## Support & Feedback

For issues or feature requests, document them with:
1. Steps to reproduce
2. Expected vs. actual result
3. File/data example if applicable
4. Application version and Python version

## Version History

- **v0.2.0** (2026-04) - Phase 2 Desktop Application (In Development)
- **v0.1.0** (2026-04) - Phase 1 Excel Templates (Complete)

---

**Last Updated:** April 27, 2026  
**Status:** Phase 2 - Desktop Application Development
