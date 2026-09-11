# Date Format Specification - Rabona Expense Tracker

## User-Facing Format: DD/MM/YYYY
All dates displayed to users must be in **DD/MM/YYYY** format (e.g., 25/01/2026 = 25th January 2026)

## Internal Storage Format: ISO 8601 (YYYY-MM-DD)
All dates stored in the database use ISO 8601 format (e.g., 2026-01-25)

## Conversion Flow

### 1. Bank Statement Upload (FileUpload.jsx)
```
Bank statement: DD/MM/YYYY (02/01/2026)
  ↓ extractTransactions()
Convert to ISO: YYYY-MM-DD (2026-01-02)
  ↓ Save to database
```

### 2. Display in Transaction Table (TransactionTable.jsx)
```
Database: YYYY-MM-DD (2026-01-02)
  ↓ Parse and format
Display: DD/MM/YYYY (02/01/2026)
```

### 3. Edit Transaction Modal (EditTransaction.jsx)
```
Database: YYYY-MM-DD (2026-01-02)
  ↓ isoToDisplay()
Display in form: DD/MM/YYYY (02/01/2026)
  ↓ User edits
User enters: DD/MM/YYYY (25/01/2026)
  ↓ displayToIso()
Save to database: YYYY-MM-DD (2026-01-25)
```

## Files Modified
- **FileUpload.jsx**: Extract DD/MM/YYYY → convert to ISO YYYY-MM-DD
- **TransactionTable.jsx**: Display ISO YYYY-MM-DD as DD/MM/YYYY
- **EditTransaction.jsx**: Accept DD/MM/YYYY, convert to/from ISO for storage

## Validation Rules
- Date input in edit form: accepts both DD/MM/YYYY and D/M/YYYY
  - Examples: 25/01/2026, 1/1/2026, 5/12/2026 all valid
  - Regex: `^\d{1,2}\/\d{1,2}\/\d{4}$`
- Database storage: always ISO format YYYY-MM-DD with padding
  - 1/1/2026 → stored as 2026-01-01
  - 25/1/2026 → stored as 2026-01-25
- Display: always DD/MM/YYYY format with padding
  - 2026-01-01 displays as 01/01/2026
  - 2026-01-25 displays as 25/01/2026
