# Rabona Expense Tracking System - Quick Reference Guide

---

## REFERENCE NUMBER FORMAT

### Main Reference
**Format:** `[YY]/[M]/[Sequence]`  
**Example:** `26/5/1` = Year 26, May, Sequence 1

### Sub-References by Type
- **Travel:** `T26/1/2` (Type T, Year 26, Month 1, Seq 2)
- **Reimbursable:** `R26/5/1` (Type R, Year 26, Month 5, Seq 1)
- **Salary:** `S26/12/3` (Type S, Year 26, December, Seq 3)

**Key Point:** Month has NO leading zeros (1, 5, 12 not 01, 05, 12)

---

## ADDING AN EXPENSE

### Step 1: Select Dashboard Month
Choose the month from Dashboard (e.g., January 2026)

### Step 2: Select Expense Type
- **Travel** - Travel expenses (can have client)
- **Reimbursable** - Expenses paid on behalf of clients (requires project)
- **Salary** - Salary-related expenses
- **Regular** - Standard expenses (no sub-reference)

### Step 3: Enter Payment Date
**Important:** Payment date month MUST match Dashboard month
- Dashboard: January 2026
- Payment Date: 15/01/2026 ✓ (matches)
- Payment Date: 20/05/2026 ✗ (mismatch - system will warn)

### Step 4: System Suggests Reference
- Main Reference: Auto-generated (e.g., 26/1/1)
- Sub-Reference: Auto-generated based on type (e.g., R26/1/1)

### Step 5: Complete & Save
Fill remaining fields, click Save. System validates everything.

---

## IF YOU SEE A VALIDATION ERROR

### "Payment Date month ≠ Dashboard month"
**Fix:** Either change the payment date to match the dashboard month, or change the dashboard month to match the payment date

### "Reference already used"
**Fix:** System auto-suggests the next available number (e.g., R26/5/2 instead of R26/5/1)

### "Month mismatch"
**Fix:** Click the auto-correction suggestion to update the reference number to match the payment date month

---

## CLIENT REPORT

### Viewing
1. Click "Client Report" tab
2. Select month/year from Dashboard
3. See all Reimbursable expenses grouped by project

### Report Shows
- Project name (e.g., "Blue Lagoon")
- Month and year (e.g., "January 2026 Expense Report")
- Reference numbers
- Reimbursable sub-references (R26/1/1, R26/1/2, etc.)
- Vendor, category, dates, amounts
- Total per project
- Grand total for all clients

### Printing Individual Project Reports
1. Find the project you want to print
2. Click the "🖨️ Print" button next to the project name
3. Standalone report opens in print dialog
4. Save as PDF or print to paper
5. Report includes: Month, Year, Project Name, All Expenses, Totals

---

## EXPENSE TYPES GUIDE

### Travel
- **When to use:** Travel-related expenses
- **Sub-Reference:** T26/1/1, T26/5/2, etc.
- **Special field:** Can track which client/project
- **In Reports:** Appears in Travel logs, NOT in Client Report

### Reimbursable
- **When to use:** Expenses paid on behalf of clients
- **Sub-Reference:** R26/5/1, R26/12/2, etc.
- **Required:** Must select a project (client)
- **In Reports:** Appears in Client Report grouped by project
- **Projects available:** Urban City, Blue Lagoon, Green Field Hotel, Kypseli, BAD City Hall, BAD City SPA Hotel, Evia Mare, Custom

### Salary
- **When to use:** Salary and payroll expenses
- **Sub-Reference:** S26/3/1, S26/11/2, etc.
- **Special fields:** May include employee info
- **In Reports:** Separate salary tracking

### Regular
- **When to use:** General expenses
- **Sub-Reference:** None (no sub-ref field)
- **Simple tracking:** Just reference number
- **In Reports:** Standard expense reporting

---

## BANK IMPORTS

### What Happens When You Import Bank Statement
1. Transactions marked with 🏦 Bank Import badge
2. Auto-categorized (can be edited)
3. Delete button disabled (for data integrity)
4. Edit button enabled (to adjust category, reference, etc.)

### Editing Bank Imports
- ✓ Can edit category, subcategory, vendor details
- ✓ Can add sub-references and project info
- ✗ Cannot delete the transaction
- ✗ Cannot change date, amount (protected from bank source)

### Why Protection?
Bank imports are the official record from your financial institution. They're locked to prevent accidental changes while allowing you to categorize them.

---

## DASHBOARD CONTROLS

### Month Selection
Click month buttons (Jan-Dec) to change which month you're viewing

### Year Selection
Type year in the input field (e.g., 2026)

### Effect on System
- Changes which month's expenses are shown
- Changes which reference numbers are suggested
- Payment dates MUST match selected month for saving

---

## COMMON SCENARIOS

### Scenario 1: Adding January Expenses in May
```
Dashboard: January 2026
Expense Date: 15/01/2026 (January)
Payment Date: 15/01/2026 (January) ✓
Reference: R26/1/1 (January) ✓
Result: Saves successfully
```

### Scenario 2: Matching Payment Dates
```
Dashboard: January 2026
Payment Date: 20/05/2026 (May) ✗
System Message: "Month mismatch - Select May or change date"
Action: Change dashboard to May 2026
Result: Reference updates to R26/5/1, saves successfully
```

### Scenario 3: Client Expenses for Invoicing
```
1. Go to Client Report tab
2. Dashboard shows May 2026
3. See: "May 2026 Expense Report - Blue Lagoon"
4. Click Print button
5. Get PDF showing all Blue Lagoon expenses for May
6. Save/email for client invoicing
```

---

## KEYBOARD SHORTCUTS & TIPS

- **Tab key:** Navigate between fields
- **Enter:** Confirm reference number
- **Payment Date format:** DD/MM/YYYY
- **Invoice Date format:** DD/MM/YYYY
- **Amount:** Enter as number (system formats as EUR)

---

## TROUBLESHOOTING

| Issue | Solution |
|-------|----------|
| Reference won't save | Check payment date matches dashboard month |
| Can't delete expense | If 🏦 Bank Import badge shown, bank-imported entries can't be deleted |
| Report shows no expenses | Check dashboard month selection and expense type |
| Print button not working | Check browser allows pop-ups, try again |
| Sub-reference shows as "-" | Sub-reference might not be set - click confirm button |

---

## DATA BACKUP

- All data saved to browser's local storage
- Data persists across sessions
- Clearing browser cache will erase data
- Consider exporting regularly for backup

---

## SUPPORT

For issues or questions:
1. Check this Quick Reference Guide
2. Read the relevant feature documentation
3. Verify payment dates and dashboard selections
4. Check browser console for error messages (F12)

---

**Last Updated:** May 9, 2026  
**Version:** V5 COMPLETE FINAL  
**Company:** Rabona

---
