# Final System Scope - Rabona Expense Tracker Rebuild

**Approved:** May 10, 2026  
**Timeline:** 4-5 weeks  
**Status:** Phase 1 Complete ✅ | Phase 2 Ready to Start 🚀

---

## System Overview

**Complete rebuild of Rabona Expense Tracking System**
- **Companies:** Rabona Holdings, Espargos
- **Users:** Single user (you)
- **Deployment:** Web application (React frontend + Supabase backend)
- **Data:** Cloud-based with automatic daily backups

---

## 7 Core Features (User-Approved)

### 1. 🔴 Bank Statement Parser
**Purpose:** Automated import of bank transactions

Features:
- File upload (CSV, PDF, images)
- OCR extraction (Tesseract.js)
- Auto-detect transaction fields (date, amount, description)
- Manual correction interface
- Transaction preview before import
- Import to database with audit trail
- Status tracking (unmatched → matched)

Workflow:
1. Upload bank statement
2. OCR extracts transactions
3. Review & correct if needed
4. Import to database
5. Manual matching in View Expenses

---

### 2. 🟠 View Expenses
**Purpose:** Central view of all expenses with reconciliation

Features:
- Table of all expenses (from manual entry + bank import)
- Display source (manual vs. bank import)
- Sort by: date, amount, category, status
- Filter by: month, category, status, company
- Bank transaction matching interface
- Link unmatched bank transactions to expenses
- Reconciliation view (matched ✅ vs unmatched ❌)
- Edit expense details
- Soft delete (never permanently removes)
- Status tracking (pending, approved, locked)

Workflow:
1. View parsed bank transactions
2. Match to expenses or create new
3. Edit details as needed
4. Approve for accounting
5. Lock month when complete

---

### 3. 🟡 Add Expense (Manual)
**Purpose:** Create expenses not in bank statements

Features:
- Date picker
- Company selector
- Account selector (Current, Mastercard)
- Category dropdown
- Amount with currency
- Description & vendor
- Reference number
- Split option for splitting expenses
- Reimbursement tracking
- Shareholder transfer tracking
- Status management

Usage:
- Cash expenses
- Internal transfers
- Shareholder movements
- Prepaid expenses
- Client reimbursements

---

### 4. 🟢 Dashboard
**Purpose:** Executive overview of financials

KPI Cards:
1. **Monthly Income** - Sum of income transactions
2. **Total Expenses** - Sum of all expenses
3. **Net** - Income minus expenses
4. **Mastercard → Current** - Card payment to bank
5. **Current → Mastercard** - Bank payment to card
6. **Net Internal Movement** - Net bank/card flow
7. **YK Transfers In** 🟢 - Transfers from YK
8. **YK Transfers Out** 🔴 - Transfers to YK
9. **YK Balance** - YK's current balance
10. **BK Transfers In** 🟢 - Transfers from BK
11. **BK Transfers Out** 🔴 - Transfers to BK
12. **BK Balance** - BK's current balance
13. **Client Reimbursements** - Total owed to clients

Features:
- Real-time calculations from database
- Month/year filtering
- Responsive card layout
- Color-coded (green = incoming, red = outgoing)
- Click-through to detailed reports

---

### 5. 🔵 Shareholder Report
**Purpose:** Track movements with shareholders YK and BK

Sections:

**YK (Y.K.)**
- Transfers received (green 🟢)
- Transfers sent (red 🔴)
- Current balance
- Month-by-month history

**BK (B.K.)**
- Transfers received (green 🟢)
- Transfers sent (red 🔴)
- Current balance
- Month-by-month history

**Summary Table**
- Month-by-month breakdown
- Running balance per shareholder
- Total movements

Features:
- Filter by month/year
- **Print to PDF** (formatted report)
- **Save as PDF** (for records)
- Export to CSV
- Real-time calculations

---

### 6. 🟣 Travel Log
**Purpose:** Track travel expenses and prepaid amounts

Features:
- Trip entry form
- From/To locations
- Travel date range
- Expenses per trip (flights, hotels, meals, transport)
- Prepaid vs actual tracking
- Reimbursement status per trip
- Multi-leg trip support

Sections:
1. **Active Trips** - Ongoing with prepaid balance
2. **Completed Trips** - Finalized with settlement
3. **Outstanding Prepaid** - Amounts still owed

Features:
- Filter by date range
- Show prepaid vs. actual split
- Settlement tracking
- **Print to PDF** (trip summary)
- **Save as PDF**
- Export to CSV

---

### 7. ⚫ Client Report
**Purpose:** Track expenses for client reimbursement

Features:
- Client name tracking
- Expenses incurred per client
- Reimbursement status
- Settlement date

Sections:
1. **Outstanding** - Not yet reimbursed
2. **Pending** - Submitted, awaiting payment
3. **Paid** - Completed settlements

Summary:
- Total per client
- Reimbursement status
- Total outstanding

Features:
- Filter by client
- Filter by status
- **Print to PDF** (invoice-style report)
- **Save as PDF**
- Export to CSV

---

## ❌ NOT Included

- Export & Reports tab (consolidated into individual reports)
- Multi-user/team features
- Advanced permission system
- Mobile app (web responsive only)
- Advanced analytics
- Scheduled reports

---

## 📊 Print & PDF Options

**For Each Report:**
- Print button → Opens print dialog
- Save as PDF → Downloads PDF file
- PDF format: Professional, printable

Implemented per report as we build.

---

## 🛠️ Technical Stack

- **Frontend:** React 18 + Vite
- **Backend:** Node.js + Express (when needed)
- **Database:** Supabase (PostgreSQL)
- **File Uploads:** Browser File API
- **OCR:** Tesseract.js
- **PDF Generation:** jsPDF or similar
- **Version Control:** Git (full reversibility)

---

## 📅 Timeline

**Phase 1:** Foundation (Days 1) ✅ COMPLETE
- Database schema
- React + Vite setup
- Supabase connection

**Phase 2:** Core Features (Days 2-15) 🚀 STARTS MAY 11
1. Bank Statement Parser (Days 1-3)
2. View Expenses (Days 4-5)
3. Add Expense (Days 6-7)
4. Dashboard (Days 8-9)
5. Shareholder Report (Days 10-11)
6. Travel Log (Days 12-13)
7. Client Report (Days 14-15)

**Phase 3:** Testing & Polish (Days 16+)
- Integration testing
- Bug fixes
- Performance optimization
- Documentation

---

## 🔒 Safety Guarantees

✅ **Daily Backups**
- Supabase automatic backups
- Git commits with full history
- Weekly CSV exports

✅ **No Silent Deletions**
- Soft deletes only (never permanently removes)
- Requires explicit approval
- Audit trail of all changes

✅ **Full Reversibility**
- Git history allows instant revert
- Can restore any previous state
- Daily summaries for transparency

✅ **Data Integrity**
- Validated inputs
- Referential integrity
- Transaction logging

---

## ✅ Approval Checklist

- [x] Phase 1 complete
- [x] Database schema approved
- [x] 7 features confirmed
- [x] Timeline agreed (4-5 weeks)
- [x] Priority order set (Bank Parser first)
- [x] Print/PDF for reports included
- [x] Daily approval workflow established
- [x] Safety protocols confirmed

---

## Questions?

Before starting Phase 2, confirm:

1. ✅ Feature list complete?
2. ✅ Priority order correct (Bank Parser → View → Add → Dashboard → Reports)?
3. ✅ Ready to start May 11?
4. ✅ Daily summaries approval process clear?

**Ready to proceed? 🚀**

