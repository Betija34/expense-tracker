# Rabona Holdings - Excel Expense Tracker User Guide

## Quick Start (5 Minutes)

### What You Have
Three Excel files ready to use:
- **Rabona_2026_04.xlsx** - Main expense tracking for Rabona Holdings
- **Espargos_2026_04.xlsx** - Subsidiary expense tracking for Espargos
- **Settlement_2026_04.xlsx** - Inter-company transfers and settlements

### Step 1: Open Rabona_2026_04.xlsx

1. Navigate to the folder: `Rabona expense tracking sistem/System`
2. Double-click **Rabona_2026_04.xlsx**
3. You'll see 5 sheets at the bottom:
   - **Expense Data** (main entry sheet)
   - **Settings** (configuration)
   - **Month Summary** (auto-calculated totals)
   - **Shareholder Account** (shareholder tracking)
   - **Incomplete Entries** (entries needing attention)

---

## How to Add an Expense Entry

### Sheet: Expense Data

This is where you enter all expenses. Follow these steps:

**1. Find an empty row**
- Look for the first blank row (usually row 2 if nothing entered yet)

**2. Fill in each column, left to right:**

| Column | What to Enter | Example |
|--------|---------------|---------|
| A - Reference | Your expense code (YY/MM/SEQ) | 26/04/1 |
| B - Date | Date of expense (DD/MM/YYYY) | 23/04/2026 |
| C - Vendor | Who you paid | "Café Costa" |
| D - Description | What was purchased | "Team lunch meeting" |
| E - Amount | Cost in € | 125.50 |
| F - Currency | Currency code | EUR |
| G - Category | Type of expense | Travel, Meals, Office, etc. |
| H - Subcategory | Sub-category | Flights, Hotels, Daily Meals, etc. |
| I - Payment Method | How you paid | Cash, Card, Transfer, Cheque |
| J - Travel Ref | If travel expense | T04/1 (optional) |
| K - Reimb Ref | If client reimbursable | R04/1 (optional) |
| L - Status | Complete or Incomplete | "Complete" or "Incomplete" |
| M - Document Link | Path to receipt file | Optional |

### Example Entry

```
Reference:    26/04/1
Date:         23/04/2026
Vendor:       Café Costa
Description:  Team lunch meeting
Amount:       125.50
Currency:     EUR
Category:     Meals
Subcategory:  Daily Meals
Payment:      Card
Status:       Complete
```

---

## Reference Number System

### Standard Expenses
Format: `YY/MM/SEQ`
- **YY** = Year (26 for 2026)
- **MM** = Month (04 for April)
- **SEQ** = Sequence number (1, 2, 3...)

**Examples:**
- 26/04/1 (First expense in April 2026)
- 26/04/2 (Second expense in April 2026)
- 26/05/1 (First expense in May 2026)

### Travel Expenses
Format: `TMONTH/SEQ`
- **Example:** T04/1 (First travel expense in April)

### Client Reimbursables
Format: `RMONTH/SEQ`
- **Example:** R04/1 (First reimbursable in April)

### Shareholder Salary
Format: `SMONTH/SEQ`
- **Example:** S04/1 (First salary entry in April)

---

## Sheet: Settings

This sheet contains your configuration data. **You can customize it.**

### What's There

**Row 1-10: Company Information**
- Company Name: Rabona Holdings Ltd
- VAT Number: 10402420X
- Registration: HE402420

**Row 12-20: Categories** (you can add more)
- Travel
- Meals
- Office
- Utilities
- Professional Services
- Other

**Row 12-20, Column 3: Clients** (you can add your clients)
- Client A
- Client B
- Client C
- etc.

**Row 12-20, Column 5: Payment Methods**
- Cash
- Card
- Transfer
- Cheque

### How to Add a New Category or Client

1. Click on **Settings** sheet
2. Find an empty cell in the appropriate column
3. Type the new value
4. Press Enter

**Example: Adding a new client**
- Find Client C in column C
- Move to the next empty row
- Type "Acme Inc"
- Press Enter

---

## Sheet: Month Summary

**This sheet is automatic - don't edit it manually.**

It shows:
- **Total Expenses** - Sum of all amounts entered
- **Complete Entries** - Count of finished entries
- **Incomplete Entries** - Count of entries still missing data
- **Category Breakdown** - Total by category

The numbers update automatically as you add expenses.

---

## Sheet: Shareholder Account

Tracks how much the company owes shareholders (or vice versa).

### Structure

Separate sections for each shareholder (e.g., YK, BK):

**For Each Shareholder:**
1. **Opening Balance** - Starting balance at year start
2. **Investments In** - Money shareholder invested
3. **Expenses Paid on Behalf** - Company expenses paid by shareholder
4. **Company Advances** - Money company advanced to shareholder
5. **Closing Balance** - Auto-calculated final balance

### How to Use

**If a shareholder pays a company expense:**
1. Enter the amount under "Expenses Paid on Behalf"
2. The system calculates what the company owes

**If the company advances money to shareholder:**
1. Enter under "Company Advances"
2. The system tracks the debt

**Example:**
- Shareholder YK invests €10,000 → Enter in "Investments In"
- YK pays €500 for office rent → Enter in "Expenses Paid on Behalf"
- Closing Balance auto-calculates what the company owes YK

---

## Sheet: Incomplete Entries

**Use this to track entries that need attention.**

List any entries that are:
- Missing a receipt
- Missing required fields
- Pending approval
- Need clarification

### How to Use

1. When you enter an expense but don't have all info, mark Status as **"Incomplete"**
2. Review this sheet at month-end
3. Complete any missing entries before finalizing the month

---

## Common Tasks

### Task 1: Add April 2026 Expenses

**Step by step:**

1. Open **Rabona_2026_04.xlsx**
2. Click **Expense Data** sheet
3. Starting at Row 2, enter each expense:
   - Reference: 26/04/1, 26/04/2, 26/04/3, etc.
   - Fill in date, vendor, amount, etc.
4. When done, click **Month Summary** sheet
5. Your totals should now appear

**Time:** 5 minutes per expense entry

---

### Task 2: Track Client Reimbursables

**When a client needs to reimburse you:**

1. Add the expense to Expense Data
2. In column K (Reimb Ref), enter the code: **R04/1**
3. Mark Status as **Complete**
4. Later, use Month Summary to see total client reimbursables

---

### Task 3: Track Travel Expenses

**For travel (flights, hotels, meals during trip):**

1. Add expense entry
2. In column J (Travel Ref), enter: **T04/1**
3. Mark Category as **Travel** (or Meals if meals)
4. When month-end comes, filter by Travel Ref to see total travel spend

---

### Task 4: Track Shareholder Expense

**If shareholder pays a company expense:**

1. Add expense to Expense Data normally
2. Note which shareholder paid it
3. Go to **Shareholder Account** sheet
4. Enter amount under that shareholder's "Expenses Paid on Behalf"
5. Closing Balance updates automatically

---

## Month-End Checklist

**Do this at end of April (or each month):**

- [ ] All expense entries have been made
- [ ] All receipts are linked or saved
- [ ] No entries are marked "Incomplete" 
- [ ] Month Summary shows correct total
- [ ] Shareholder Account is updated
- [ ] Send Month Summary to management/clients as needed

---

## Tips & Best Practices

### 1. Be Consistent with References
- Always use format: 26/04/1, 26/04/2, not 26/4/1
- Sequence numbers should be sequential (don't skip)

### 2. Fill in Status Immediately
- Mark "Complete" if you have receipt
- Mark "Incomplete" if missing data
- Review incomplete entries before month-end

### 3. Keep Documents Organized
- Save receipts in a folder: `Documents/Expenses/2026/April`
- Link the path in column M (Document Link)
- Example: `~/Documents/Expenses/2026/April/26-04-01.pdf`

### 4. Categories Should Match Your Needs
- Use Settings sheet to customize categories
- Keep it simple (5-7 categories max)
- Be consistent (always use "Travel" not "Trips")

### 5. Monthly Rhythm
- **Week 1 of month:** Prepare template for new month
- **Throughout month:** Add expenses as they occur
- **Last day of month:** Finalize and close month
- **First day of next month:** Start new month file

---

## Troubleshooting

### Problem: Numbers not updating in Month Summary

**Solution:**
1. Click on **Month Summary** sheet
2. Press **F9** (or Ctrl+Shift+F9 on Windows)
3. This recalculates all formulas
4. Numbers should update

### Problem: Can't see all columns

**Solution:**
1. Scroll right using arrow keys or scroll bar
2. Or, press **Ctrl+Home** to go to beginning
3. Then use scroll bar to see all columns

### Problem: Unsure if entry is complete

**Solution:**
1. Check that all required columns have data:
   - Reference, Date, Vendor, Amount, Category, Status
2. If optional (like Travel Ref), only fill if applicable
3. When in doubt, mark "Incomplete" and review later

### Problem: Formula showing error (#REF! or #DIV/0!)

**Solution:**
1. Don't edit formulas in Month Summary or Shareholder Account
2. These are read-only calculation sheets
3. Only edit Expense Data sheet
4. If error appears, re-open the file and try again

---

## Next Steps

### After Using Excel for April

1. **Review:** Look at Month Summary - does it look right?
2. **Export:** Select Month Summary, copy to Word/PDF for records
3. **Archive:** Save April file, create May file (copy April and clear Expense Data)
4. **Plan:** In May, we can discuss automating reports or adding features

### Example: Creating May File

1. Open **Rabona_2026_04.xlsx**
2. **File → Save As**
3. Name it: **Rabona_2026_05.xlsx**
4. Click **Expense Data** sheet
5. Delete all rows 2-51 (keeps headers)
6. Save

Now you have a fresh May file ready to use!

---

## Support

**Questions about:**
- How to enter data → See "Common Tasks" section
- What a column means → See "How to Add an Expense Entry" table
- Month-end process → See "Month-End Checklist"
- Creating a new month → See "Next Steps"

**If something seems wrong:**
1. Check the Troubleshooting section
2. Remember: Only edit "Expense Data" sheet
3. Settings, Month Summary, and Shareholder Account handle calculations

---

**You're ready to go! Open Rabona_2026_04.xlsx and start entering April expenses.** 🎉

---

*Last Updated: April 27, 2026*
*Version: 1.0*
