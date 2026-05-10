# Phase 2 Plan - Bank Parser + Core Features

**Timeline:** May 11-31, 2026 (3-4 weeks)  
**Status:** 🚀 Ready to Start
**User Approved:** May 10, 2026

---

## Phase 2 Overview

Build the **complete 7-feature system** in priority order:

### Priority Order (User-Approved)
1. 🔴 **Bank Statement Parser** ← START HERE
2. 🟠 **View Expenses** (connected to parser)
3. 🟡 **Add Expense** (manual entry)
4. 🟢 **Dashboard** (KPI calculations)
5. 🔵 **Shareholder Report** (YK/BK tracking + print/PDF)
6. 🟣 **Travel Log** (prepaid travel + print/PDF)
7. ⚫ **Client Report** (reimbursements + print/PDF)

### Core Goals
1. ✅ Bank Statement Parser with OCR & file upload
2. ✅ View Expenses table (shows parsed transactions)
3. ✅ Add Expense form (manual entry linked to parser)
4. ✅ Dashboard KPI cards with calculations
5. ✅ Shareholder Report with print/PDF
6. ✅ Travel Log with prepaid tracking + print/PDF
7. ✅ Client Report with print/PDF

---

## What Phase 1 Gave Us

- ✅ Database schema (all tables ready)
- ✅ Supabase client configured
- ✅ React component structure
- ✅ Company & month selectors
- ✅ Tab navigation

---

## Phase 2 Implementation Plan

### Days 1-3 (May 11-13): Bank Statement Parser 🔴
**What:** Upload & parse bank statements (CSV, PDF, images)

Components:
1. **File Upload**
   - Drag & drop interface
   - CSV/PDF/image support
   - File validation
   - Upload progress bar

2. **OCR Processing** (Tesseract.js)
   - Extract text from images
   - Parse transaction data
   - Auto-detect fields (date, amount, description)

3. **Transaction Display**
   - Table of extracted transactions
   - Show raw data
   - Manual correction interface
   - Preview before import

4. **Import to Database**
   - Create bank_import record
   - Create bank_transaction records
   - Link to account_id
   - Status: "unmatched" initially

Features:
- ✅ Support multiple files
- ✅ Auto-detect columns
- ✅ Error handling & rollback
- ✅ Audit trail

### Days 4-5 (May 14-15): View Expenses (Connected) 🟠
**What:** Display expenses + bank transactions + matching

Components:
1. **Expense Table**
   - All expense columns
   - Sort by date, amount, category
   - Filter by status, category, month
   - Show source (manual vs. bank import)

2. **Bank Transaction Matching**
   - Show unmatched bank transactions
   - Link transactions to expenses
   - Manual matching interface
   - Auto-match by amount + date (optional)

3. **Reconciliation View**
   - Matched ✅ vs. Unmatched ❌
   - Discrepancies highlighted
   - Adjust/unlink buttons

Features:
- ✅ Real-time connection to bank parser
- ✅ Edit matched transactions
- ✅ Soft delete (never permanently remove)
- ✅ Status tracking (pending, approved, locked)

### Days 6-7 (May 16-17): Add Expense (Manual) 🟡
**What:** Manual expense entry form (for non-bank expenses)

Form Fields:
- Date picker
- Company selector
- Account (Current, Mastercard, etc)
- Category dropdown
- Amount (with currency)
- Description
- Vendor
- Reference number
- Split option (toggle for splits)
- Reimbursement checkbox
- Shareholder selector
- Status dropdown

Validation:
- Required fields
- Amount must be positive
- Date must be valid
- Duplicate prevention (optional)
- Cross-company validation

Features:
- ✅ Link to existing bank transaction (optional)
- ✅ Create split expenses
- ✅ Mark as reimbursement
- ✅ Shareholder transfers
- ✅ Real-time sync to View Expenses

### Days 8-9 (May 18-19): Dashboard 🟢
**What:** KPI cards with calculations

Cards:
1. **Monthly Income** - Sum income transactions
2. **Total Expenses** - Sum expenses
3. **Net** (Income - Expenses)
4. **Mastercard → Current** - Internal transfers
5. **Current → Mastercard** - Internal transfers
6. **Net Internal Movement**
7. **Shareholder Movements** (YK/BK)
   - Transfers in
   - Transfers out
   - Balance
8. **Client Reimbursements Due**

Features:
- ✅ Real-time calculations from database
- ✅ Month/year filtering
- ✅ Responsive grid layout
- ✅ Color-coded (green positive, red negative)

### Days 10-11 (May 20-21): Shareholder Report 🔵
**What:** YK/BK tracking & reconciliation

Sections:
1. **YK Transfers** 
   - Transfers from (🟢 in)
   - Transfers to (🔴 out)
   - Balance

2. **BK Transfers**
   - Transfers from (🟢 in)
   - Transfers to (🔴 out)
   - Balance

3. **Summary Table**
   - Month-by-month breakdown
   - Running balances

Features:
- ✅ Filter by month/year
- ✅ Print option (generates PDF)
- ✅ Save as PDF
- ✅ Export to CSV

### Days 12-13 (May 22-23): Travel Log 🟣
**What:** Travel expense tracking & prepaid management

Features:
1. **Travel Entry Form**
   - From/To locations
   - Travel dates
   - Expenses (flights, hotels, meals)
   - Prepaid vs. actual
   - Reimbursement status

2. **Travel Log Table**
   - List all trips
   - Filter by date range
   - Show prepaid balance
   - Actual expenses

3. **Reconciliation**
   - Match prepaid to actual
   - Flag outstanding amounts
   - Settlement tracking

Features:
- ✅ Multi-leg trips
- ✅ Prepaid vs. actual split
- ✅ Print option (PDF)
- ✅ Export to CSV

### Days 14-15 (May 24-25): Client Report ⚫
**What:** Client reimbursement tracking

Features:
1. **Client Entry**
   - Client name
   - Expenses incurred
   - Reimbursement status
   - Settlement date

2. **Client Report Table**
   - List all clients
   - Total expenses per client
   - Reimbursement status
   - Outstanding amounts

3. **Summary by Month**
   - What was billed
   - What was paid
   - What's outstanding

Features:
- ✅ Filter by client
- ✅ Filter by status (pending, reimbursed)
- ✅ Print option (PDF - invoice style)
- ✅ Export to CSV

### Days 16+ : Testing & Polish
- Full system testing with real data
- Bug fixes from daily summaries
- Performance optimization
- Responsive design fixes
- Documentation updates
- Ready for production

---

## Critical Database Queries

### Bank Statement Parser
```sql
-- Create bank import
INSERT INTO bank_imports (company_id, account_id, import_date, file_name, file_type, transaction_count)
VALUES (?, ?, ?, ?, ?, ?);

-- Create bank transactions
INSERT INTO bank_transactions (bank_import_id, company_id, account_id, transaction_date, amount, description, transaction_type, status)
VALUES (?, ?, ?, ?, ?, ?, ?, 'unmatched');

-- Get unmatched transactions
SELECT * FROM bank_transactions 
WHERE status = 'unmatched' AND company_id = ? 
ORDER BY transaction_date DESC;
```

### View Expenses (with bank matching)
```sql
-- Get expenses with matched bank transactions
SELECT e.*, bt.id as bank_transaction_id, bt.status as bank_status
FROM expenses e
LEFT JOIN bank_transactions bt ON e.id = bt.matched_expense_id
WHERE e.company_id = ? AND MONTH(e.date) = ? AND YEAR(e.date) = ?
ORDER BY e.date DESC;

-- Get bank transactions for matching
SELECT * FROM bank_transactions
WHERE company_id = ? AND status != 'matched'
ORDER BY transaction_date DESC;
```

### Add Expense
```sql
INSERT INTO expenses (company_id, category_id, account_id, date, amount, description, vendor, reference_number, status)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending');

-- Link to bank transaction if matched
UPDATE bank_transactions SET matched_expense_id = ?, status = 'matched' WHERE id = ?;
```

### Dashboard KPIs
```sql
-- Income & expenses
SELECT SUM(amount) as total
FROM expenses 
WHERE company_id = ? AND MONTH(date) = ? AND YEAR(date) = ? AND category_id IN (SELECT id FROM expense_categories WHERE name LIKE '%income%');

-- Internal transfers
SELECT expense_type, SUM(amount) as total
FROM expenses
WHERE company_id = ? AND MONTH(date) = ? AND expense_type IN ('transfer', 'shareholder')
GROUP BY expense_type;
```

---

## Component Structure

```
BankParser/
  ├── FileUpload.jsx
  ├── TransactionTable.jsx
  ├── OCRProcessor.js
  └── useBankParser.js (custom hook)

ViewExpenses/
  ├── ExpenseTable.jsx
  ├── BankTransactionMatcher.jsx
  ├── ExpenseFilters.jsx
  └── useExpenses.js (custom hook)

AddExpense/
  ├── ExpenseForm.jsx
  ├── DatePicker.jsx
  ├── SplitExpense.jsx (for splits)
  └── useExpenseForm.js (custom hook)

Dashboard/
  ├── KPICard.jsx (reusable)
  └── Dashboard.jsx (main)

Reports/
  ├── ShareholderReport.jsx
  ├── TravelLog.jsx
  ├── ClientReport.jsx
  └── PrintPDF.js (utility for print/PDF)

Shared/
  ├── useSupabase.js (data fetching)
  ├── formatters.js (currency, dates)
  ├── ValidationRules.js
  └── PrintUtils.js (print/PDF generation)
```

---

## Files to Create (Phase 2)

**Week 1 (Bank Parser + View + Add):**
1. `src/components/BankParser/FileUpload.jsx`
2. `src/components/BankParser/TransactionTable.jsx`
3. `src/components/BankParser/useBankParser.js`
4. `src/components/ViewExpenses/ExpenseTable.jsx`
5. `src/components/ViewExpenses/BankTransactionMatcher.jsx`
6. `src/components/ViewExpenses/useExpenses.js`
7. `src/components/AddExpense/ExpenseForm.jsx`
8. `src/components/AddExpense/useExpenseForm.js`
9. `src/hooks/useSupabase.js`
10. `src/utils/formatters.js`

**Week 2 (Dashboard + Reports):**
11. `src/components/Dashboard/Dashboard.jsx`
12. `src/components/Dashboard/KPICard.jsx`
13. `src/components/Reports/ShareholderReport.jsx`
14. `src/components/Reports/TravelLog.jsx`
15. `src/components/Reports/ClientReport.jsx`
16. `src/utils/PrintPDF.js`

---

## Daily Summaries for Phase 2

Each day will have its own summary for review & approval:

**Week 1:**
- `DAILY_SUMMARY_2026_05_11.md` - Bank Parser file upload component
- `DAILY_SUMMARY_2026_05_12.md` - Bank Parser OCR + transaction processing
- `DAILY_SUMMARY_2026_05_13.md` - Bank Parser display & import
- `DAILY_SUMMARY_2026_05_14.md` - View Expenses table + bank matching
- `DAILY_SUMMARY_2026_05_15.md` - Add Expense form + validation

**Week 2:**
- `DAILY_SUMMARY_2026_05_18.md` - Dashboard KPI cards
- `DAILY_SUMMARY_2026_05_19.md` - Shareholder Report
- `DAILY_SUMMARY_2026_05_20.md` - Travel Log
- `DAILY_SUMMARY_2026_05_21.md` - Client Report
- `DAILY_SUMMARY_2026_05_22.md` - Print/PDF for all reports
- `DAILY_SUMMARY_2026_05_23.md` - Testing & refinements

---

## Success Criteria for Phase 2

✅ **Bank Statement Parser**
- Upload CSV/PDF/images
- OCR extraction works
- Transactions displayed
- Import to database

✅ **View Expenses**
- Shows parsed bank transactions
- Real-time connection to parser
- Manual matching interface
- Soft delete (never permanently removes)

✅ **Add Expense**
- Manual form works
- Can link to bank transactions
- Split expenses work
- Real-time sync to View Expenses

✅ **Dashboard**
- All KPI cards calculate correctly
- Real-time updates from database
- Month/year filtering works

✅ **Shareholder Report**
- YK/BK tracking accurate
- Print to PDF
- Save as PDF

✅ **Travel Log**
- Prepaid vs actual split
- Reimbursement tracking
- Print to PDF

✅ **Client Report**
- Client reimbursement tracking
- Outstanding amounts calculated
- Print to PDF

✅ **General Requirements**
- No code deleted without approval
- Daily summaries created & approved
- Git history clean & reversible
- All features tested with sample data  

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Calculation errors | Daily testing, unit tests, manual verification |
| Data not loading | Console errors, check Supabase connection |
| Form validation issues | Test with edge cases (empty, negative, large numbers) |
| Performance (large datasets) | Pagination, lazy loading |
| Git lock issues | Manual commits if needed, patience |

---

## Questions Before Starting

- Any changes to Phase 1? (Should be none if approved)
- Priority order for Phase 2 components? (Recommended: Dashboard → Add Expense → View)
- Any specific calculations you want to verify first?

---

