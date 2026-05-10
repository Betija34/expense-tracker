# Feature: Dashboard Month Selector

**Date**: 29 April 2026  
**Feature**: Month switching for Dashboard metrics  
**Status**: ✅ IMPLEMENTED

---

## Overview

The Dashboard now includes a **month selector** that allows you to view financial metrics for any month, not just the current month. All dashboard calculations automatically update when you change the month.

---

## How to Use

### Selecting a Different Month:

1. **Open the Dashboard tab**
2. **Look for the month selector at the top** (light gray box)
3. **Click on the month input field** to open the date picker
4. **Select the month and year** you want to view
5. **All dashboard metrics instantly update** to show data for that month

### Returning to Current Month:

- **Click the "Current Month" button** to jump back to today's month
- The month selector automatically updates to show the current month

---

## Dashboard Elements Updated by Month Selection

When you select a different month, ALL of the following metrics recalculate for that month only:

### ROW 1: Core Financials
- **Actual Income** - Income excluding transfers and shareholder expenses
- **Total Expenses** - All negative transactions for the month

### ROW 2: Internal Account Movements
- **Mastercard → Current** - Transfers from Mastercard to Current Account
- **Current → Mastercard** - Transfers from Current Account to Mastercard
- **Net Internal Movement** - Net of the above two

### ROW 3: Shareholder Movements
- **YK Payments Made** - Amounts transferred to YK shareholder
- **YK Received From** - Amounts received from YK shareholder
- **BK Payments Made** - Amounts transferred to BK shareholder
- **BK Received From** - Amounts received from BK shareholder

### ROW 4: Client Reimbursements
- **Expenses to Reimburse Clients** - Total of reimbursable expenses for the month

### ROW 5: Inter-Company Transfers
- **Rabona → Espargos** - Transfers to the connected company
- **Espargos → Rabona** - Transfers received from connected company
- **Net Inter-Company Movement** - Net of the above

### ROW 6: Expenses Paid on Behalf
- **Paid for Espargos** - Expenses Rabona paid on behalf of Espargos
- **Paid for Rabona** - Expenses Espargos paid on behalf of Rabona

---

## Example Usage

**Scenario**: You want to see the financial summary for March 2026

1. Click on the month input field
2. Select "March 2026" (2026-03)
3. All metrics instantly recalculate for March only
4. You see:
   - March income only
   - March expenses only
   - March transfers only
   - March reimbursables only

**Back to Current**: Click "Current Month" button to return to today's month

---

## Date Range Behavior

### Current Month (Default)
- When the page loads, the selector shows the current month
- Dashboard shows data for the current calendar month
- Example: If today is April 15, 2026, dashboard shows April 2026 data

### Past Months
- Can select any month in the past to view historical data
- Dashboard filters expenses by exact month/year match
- Example: Select January 2026 to see only January transactions

### Future Months
- Can select future months (though typically no data will exist)
- Dashboard remains empty if no transactions exist for that month

---

## Technical Details

### Date Filtering Logic
- **Expense dates format**: DD/MM/YYYY (e.g., "15/04/2026")
- **Month selector format**: YYYY-MM (e.g., "2026-04")
- **Filter operation**: Exact month-year match
  - Expenses from April 1-30 shown when April 2026 selected
  - Expenses from May 1+ NOT shown

### Behavior When Switching Companies
- When you switch between Rabona and Espargos, the month selector resets to current month
- Each company view starts fresh from the current month
- Previous month selections don't carry over

---

## Features

✅ **Month picker interface** - Standard HTML5 month input  
✅ **Instant updates** - All metrics recalculate immediately  
✅ **Current month button** - Quick return to today  
✅ **All metrics included** - Every dashboard row updates  
✅ **Company switching** - Resets to current month when switching companies  
✅ **Date precision** - Exact month/year matching (not approximate)  

---

## Visual Indicators

- **Month selector box**: Light gray background (#f5f5f5)
- **Input field**: Standard date input with month picker
- **Current Month button**: Blue (#1976D2) for easy access
- **Location**: Top of Dashboard, below the heading

---

## What Stays the Same

The following do NOT change based on month selection (they're company-wide):
- Company selector dropdown
- Tab navigation
- Dashboard layout and structure
- Color scheme and formatting

---

**Version**: 1.0  
**Date**: 29 April 2026  
**Status**: ✅ READY FOR USE

All dashboard metrics now support month-by-month viewing!
