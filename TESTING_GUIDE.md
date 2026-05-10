# Bank Reconciliation System - Testing Guide

## Overview
The Bank Reconciliation system matches bank transactions extracted from bank statement screenshots with expenses entered in the system. This guide walks through the complete testing workflow.

---

## Test Workflow

### Step 1: Open the System
1. Open `/System/expense_tracker_v4.html` in your web browser
2. Ensure you're on the **Rabona Holdings** company (dropdown in top-left)

### Step 2: Upload Bank Statement (Bank Statement Parser Tab)
1. Click the **Bank Statement Parser** tab
2. Click the upload area: "📸 Click to select bank statement screenshot"
3. Select a bank statement screenshot (JPG, PNG, or PDF)
4. The system will:
   - Extract account number from the statement
   - Identify all transactions (dates, descriptions, amounts)
   - Parse European number format (e.g., 1.234,56 → 1234.56)
   - Assign reference numbers (YY/MM/SEQ)
   - Display as color-coded rows:
     - **Gray rows** = Current Account (357535881125)
     - **Pink rows** = Mastercard Account (357032438089)
5. **Expected Result**: All transactions displayed with correct amounts and color coding

### Step 3: Test Multiple Screenshots
1. Upload a **second** bank statement screenshot
2. **Expected Result**:
   - New transactions are **appended** to existing ones
   - Reference numbers continue (e.g., 26/04/1, 26/04/2, 26/04/3...)
   - All previous transactions remain visible

### Step 4: Add Expenses (Add Expense Tab)
1. Click **Add Expense** tab
2. For each extracted bank transaction, create a matching expense:
   - **General Reference**: Auto-filled (already assigned)
   - **Payment Method**: Select appropriate method (RCC BT, RCC DD, etc.)
   - **Invoice Date**: Enter date (DD/MM/YYYY)
   - **Vendor**: Enter vendor name
   - **Amount**: Should match the bank transaction amount
   - **Category**: Select category (e.g., Professional Services)
   - **Subcategory**: Auto-populated based on category
   - **Status**: Complete or Incomplete
3. Click **Save Expense**
4. Repeat for 3-5 transactions
5. **Expected Result**: Expenses appear in View Expenses tab

### Step 5: Open Bank Reconciliation (Bank Reconciliation Tab)
1. Click **Bank Reconciliation** tab
2. System automatically loads:
   - All extracted bank transactions
   - All entered expenses
   - Current reconciliation status

### Step 6: Check Summary Cards
You should see:
- **Total Bank Transactions**: Count of uploaded bank statements
- **Matched**: 0 (initially)
- **Unmatched**: Same as total
- **Reconciliation Status**: ⚠ 0% (yellow/orange indicator)

### Step 7: Match First Transaction
1. Find first **unmatched** transaction in the table
2. Click the **Match** button
3. Modal opens showing list of expenses with matching amounts
4. **Select** an expense from the list (highlighted in blue)
5. Click **Confirm Match**
6. **Expected Result**:
   - Transaction row changes to ✅ Matched (green background)
   - Matched-to column shows expense reference and amount
   - Match button changes to "Unmatch" button
   - Unmatched count decreases by 1
   - Reconciliation % increases

### Step 8: Match Additional Transactions
1. Repeat Step 7 for 2-3 more transactions
2. **Expected Result**: Status % increases with each match

### Step 9: Test Filtering
1. Click **Unmatched Only** radio button
2. **Expected Result**: Only unmatched transactions display
3. Click **Matched Only** radio button
4. **Expected Result**: Only matched transactions display
5. Click **All** radio button
6. **Expected Result**: All transactions display

### Step 10: Test Unmatching
1. Find a matched transaction
2. Click **Unmatch** button
3. Confirm when prompted
4. **Expected Result**:
   - Status changes back to ⚠ Unmatched
   - Background color changes to yellow
   - Matched count decreases
   - Status % recalculates

### Step 11: Complete Reconciliation
1. Match all remaining unmatched transactions
2. When last transaction is matched:
   - **Matched**: Should equal Total Bank Transactions
   - **Unmatched**: Should be 0
   - **Reconciliation Status**: Changes to **✅ 100%** (GREEN)
   - Background color: Green (#E8F5E9)
3. **Expected Result**: System is fully reconciled

---

## Testing Checklist

### Amount Parsing (European Format)
- [ ] Amount like "45,53" displays correctly (not 4,553)
- [ ] Thousands separator "1.234,56" parses as 1234.56
- [ ] Negative amounts show with minus sign

### Multiple Screenshots
- [ ] Second upload appends transactions (doesn't replace)
- [ ] Reference numbers continue sequentially
- [ ] Previous transactions remain in parser table
- [ ] Reconciliation loads all transactions combined

### Matching System
- [ ] Can only match transactions with same amount
- [ ] Matching modal shows only eligible expenses
- [ ] Matched transactions turn green (✅)
- [ ] Unmatched transactions are yellow (⚠)
- [ ] Can unmatch and re-match transactions

### Status Calculation
- [ ] 0% transactions matched = ⚠ (orange/red)
- [ ] 50% transactions matched = 🟡 (orange)
- [ ] 100% transactions matched = ✅ (green)

### Data Persistence
- [ ] Refresh page: all data persists
- [ ] Switch companies: data stays separate
- [ ] Bank transactions in localStorage
- [ ] Reconciliation data in localStorage

### Color Coding
- [ ] Current Account rows: Gray background
- [ ] Mastercard rows: Light pink background
- [ ] Matched: Green status background
- [ ] Unmatched: Yellow status background

---

## Expected Amount Parsing Examples

| Bank Statement | Parsed As | Correct? |
|---|---|---|
| 45,53 | 45.53 | ✅ |
| 1.234,56 | 1234.56 | ✅ |
| -100,00 | -100.00 | ✅ |
| 5,99 | 5.99 | ✅ |

---

## Troubleshooting

### Issue: Amounts showing incorrectly
**Solution**: Check that OCR is extracting full numbers. European format requires periods as thousands separators.

### Issue: No matching expenses available
**Solution**: Create expenses with exact amounts first in Add Expense tab before attempting to match.

### Issue: Matched status not updating
**Solution**: 
1. Ensure browser console has no errors (F12 → Console)
2. Clear browser cache and reload
3. Check localStorage (F12 → Application → Storage)

### Issue: Transactions not loading in reconciliation
**Solution**: Upload bank statements first, then add expenses, THEN open reconciliation tab.

---

## Success Indicators

✅ All tests pass when:
1. Bank statements upload with correct account identification
2. Amounts parse correctly (European format)
3. Multiple screenshots append transactions
4. Expenses can be matched to bank transactions
5. Status turns green (✅ 100%) when fully reconciled
6. Data persists after page refresh
