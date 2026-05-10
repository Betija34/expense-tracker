# Bank Reconciliation System - Final Specification
## **LOCKED ✅ - No Further Changes**

---

## Overview
The Bank Reconciliation system matches bank transactions extracted from bank statement screenshots with expenses entered in the system. This ensures all bank activity is accounted for and reconciled.

---

## System Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BANK RECONCILIATION WORKFLOW                      │
└─────────────────────────────────────────────────────────────────────┘

STEP 1: UPLOAD BANK STATEMENT
   └─→ Bank Statement Parser Tab
       └─→ Upload screenshot (JPG, PNG, PDF)
           └─→ Tesseract.js OCR extracts text
               └─→ Parse transactions (date | description | amount)
                   └─→ Detect account type from account number
                       └─→ Check for duplicates
                           └─→ Assign reference numbers
                               └─→ Display in extracted transactions table
                                   └─→ Save to localStorage

STEP 2: CREATE MATCHING EXPENSES
   └─→ Add Expense Tab
       └─→ Enter expense details
           └─→ Amount must match bank transaction amount
               └─→ Can use "Edit" button from Bank Parser to pre-fill
                   └─→ Save expense
                       └─→ Data stored in expenses array + localStorage

STEP 3: RECONCILE TRANSACTIONS
   └─→ Bank Reconciliation Tab
       └─→ Shows all bank transactions
           └─→ For each unmatched transaction:
               └─→ Click "Match" button
                   └─→ Modal shows eligible expenses (matching amount)
                       └─→ Select expense
                           └─→ Click "Confirm Match"
                               └─→ Status changes to ✅ Matched
                                   └─→ Reconciliation % updates
                                       └─→ Repeat for all unmatched

STEP 4: COMPLETION
   └─→ When all matched:
       └─→ Reconciliation % shows ✅ 100%
           └─→ Status: GREEN
               └─→ Ready for period close
```

---

## Part 1: Bank Statement Parser Tab - LOCKED ✅

### Purpose
Extract bank transactions from bank statement screenshots and prepare them for reconciliation.

### User Flow

#### Step 1: Select Screenshot
- **Action**: Click upload area "📸 Click to select bank statement screenshot"
- **Accept**: JPG, PNG, PDF files
- **Display**: Selected filename shown below upload button

#### Step 2: Upload Processes Automatically
**OCR Processing:**
1. Tesseract.js extracts all text from screenshot
2. System looks for account number in text (11-12 digits)
3. Maps account number to account type:
   - `357535881125` → Current Account (gray background)
   - `357032438089` → Mastercard Account (pink background)

**Transaction Parsing:**
1. Searches for lines with pattern: Date | Description | Amount
2. Date format: DD/MM/YYYY (e.g., 28/04/2026)
3. Amount format: European (1.234,56 = 1234.56)
4. Extracts:
   - Date
   - Description (text between date and amount)
   - Amount (converted to standard decimal format)
   - Account type (derived from first detected account number in file)

**European Number Format Handling:**
- Input: `-1.234,56` (European format)
- Process:
  1. Remove minus sign
  2. Remove periods (thousands separators)
  3. Replace comma with period (decimal separator)
  4. Parse as float
  5. Re-apply minus if was negative
- Output: `-1234.56` (JavaScript number format)

**Duplicate Detection:**
Compares new transactions against existing using:
- Date (must match exactly)
- Description (must match exactly)
- Amount (tolerance < 0.01 for floating point)
- If all match: Transaction marked as duplicate and skipped
- New transactions only: Added to list

**Reference Number Assignment:**
- Format: `YY/MM/SEQ`
- Example: `26/04/1`, `26/04/2`, `26/04/3`
- Starts from 1 for first upload in month
- Continues counting for multiple uploads in same month
- Maintains count from previous uploads

### Extracted Transactions Table

#### Display
```
┌────┬──────────┬──────────────────┬──────────┬────────┬────────┐
│Ref#│   Date   │  Description     │  Amount  │ Type   │ Action │
├────┼──────────┼──────────────────┼──────────┼────────┼────────┤
│26  │28/04/2026│Office Supplies   │€100.00   │Outward │ Edit   │
│04  │          │                  │          │        │        │
│1   │          │                  │          │        │        │
└────┴──────────┴──────────────────┴──────────┴────────┴────────┘
```

#### Styling
- **Current Account rows**: Gray background (#e8e8e8)
- **Mastercard rows**: Light pink background (#ffe8f0)
- **Incoming amounts** (positive): Bold green text
- **Outgoing amounts** (negative): Red text with minus sign
- **Edit button**: Pre-fills Add Expense form with transaction data

#### Edit Button Function
When clicked:
1. Populates Add Expense form:
   - **General Reference**: Sets to bank transaction ref number
   - **Invoice Date**: Sets to transaction date
   - **Vendor**: Sets to transaction description
   - **Amount**: Sets to absolute value of transaction
2. Sets form background color to match account type:
   - Gray for Current Account
   - Pink for Mastercard
3. Switches to "Add Expense" tab
4. User can now complete the expense form and save

#### Clear All Transactions Button
- **Warning**: "⚠️ Clear all uploaded bank statements? This will remove all extracted transactions. Make sure you've already reconciled them!"
- **Action on confirm**:
  - Deletes all bank transactions from localStorage
  - Deletes reconciliation data
  - Clears the display table
  - Resets file input
  - Shows success message

### Data Persistence
- **Storage Key**: `bankTransactions_{Company}`
- **Format**: JSON array of transaction objects
- **Properties per transaction**:
  ```javascript
  {
    date: "28/04/2026",
    description: "Office Supplies",
    amount: 100.00 (or -100.00),
    accountType: "current" or "mastercard",
    refNumber: "26/04/1",
    direction: "Inward" or "Outward"
  }
  ```

### Messages
- **Success**: "✅ Extracted X transactions from Current Account/Mastercard"
- **Duplicate Warning**: "⚠️ Found X duplicate transaction(s) - skipped. Adding Y new transaction(s)."
- **All Duplicates Error**: "❌ All transactions are duplicates. This file has already been uploaded."
- **No Transactions Error**: "⚠️ No transactions found. Try uploading a clearer screenshot."

---

## Part 2: Bank Reconciliation Tab - LOCKED ✅

### Purpose
Match bank transactions to expenses and track reconciliation progress.

### Summary Cards (Top of Page)

#### Card 1: Total Bank Transactions
- **Label**: "Total Bank Transactions"
- **Display**: Count of all uploaded transactions
- **Example**: 25

#### Card 2: Matched
- **Label**: "Matched"
- **Display**: Count of transactions marked as matched
- **Example**: 18

#### Card 3: Unmatched
- **Label**: "Unmatched"
- **Display**: Count of transactions still unmatched
- **Calculation**: Total - Matched
- **Example**: 7

#### Card 4: Reconciliation Status
- **Label**: "Reconciliation Status"
- **Display**: Percentage with icon + color
- **Calculation**: (Matched / Total) × 100
- **Status Levels**:
  - 0% = ⚠ Red (#F57F17) - "⚠ 0%"
  - 1-49% = ⚠ Orange (#F57F17) - "⚠ 33%"
  - 50-99% = 🟡 Orange (#FF9800) - "🟡 75%"
  - 100% = ✅ Green (#2E7D32) - "✅ 100%"
- **Example**: "🟡 72%"

### Filter Options
**Radio buttons** (mutually exclusive):
- **All**: Shows all bank transactions (default)
- **Unmatched Only**: Shows only transactions with status ⚠ Unmatched
- **Matched Only**: Shows only transactions with status ✅ Matched

### Reconciliation Table

#### Columns (8 columns)
1. **Ref #** (80px): Reference number (26/04/1 format)
2. **Date** (90px): Transaction date (DD/MM/YYYY)
3. **Description** (180px): Transaction description from bank
4. **Amount** (100px): Amount with currency (€X,XXX.XX)
5. **Type** (100px): "Inward" or "Outward"
6. **Status** (100px): Colored badge with icon
7. **Matched To** (150px): Reference and details of matched expense
8. **Action** (120px): Match or Unmatch button

#### Row Styling
- **Current Account rows**: Gray background (#e8e8e8)
- **Mastercard rows**: Light pink background (#ffe8f0)
- **Status background**:
  - Matched: Green (#E8F5E9)
  - Unmatched: Yellow (#FFF9C4)

#### Status Display
- **Unmatched**: "⚠ Unmatched" (yellow background, orange text)
- **Matched**: "✅ Matched" (green background, green text)

#### Matched To Display
When matched to an expense:
```
{expenseRefNumber} (€{absoluteAmount}) {statusIcon} {statusLabel}
```
Example: `26/04/1 (€100.00) ✅ Complete`

- Shows expense reference number
- Shows absolute amount in currency
- Shows status icon:
  - ✅ for Complete
  - ⏳ for In Progress
- Shows status label
- If no match: Shows "-"

#### Action Buttons

**For Unmatched Transactions**:
- **Button**: "Match" (green button)
- **Action**: Opens matching modal

**For Matched Transactions**:
- **Button**: "Unmatch" (secondary/gray button)
- **Action**: Unmatch with confirmation

### Matching Modal

#### Trigger
- User clicks "Match" button on unmatched transaction
- Modal displays with overlay

#### Modal Content
**If no matching expenses**:
```
No matching expenses found with the same amount (€100.00).
Add an expense with this amount in the Add Expense tab first.
```

**If matching expenses exist**:
```
Select the expense to match with this bank transaction (€100.00):

[Expense Card 1 - unselected]
[Expense Card 2 - selected - highlighted with green border]
[Expense Card 3 - unselected]
```

#### Expense Card Details
Per selectable expense:
```
{refNumber} - {vendor} - €{amount}
{invoiceDate} | {category}
```
Example:
```
26/04/1 - Office Depot - €100.00
28/04/2026 | Professional Services
```

#### Card Styling
- **Default**: White background, 1px gray border
- **Hover**: Light gray background (#f5f5f5)
- **Selected**: Green border (2px), stays highlighted
- **Interaction**: Click to select, visual feedback immediate

#### Modal Buttons
- **Cancel**: Secondary button (gray) - closes without changing anything
- **Confirm Match**: Primary button (green) - saves the match

### Matching Logic

#### Amount Matching
- Compares Bank Transaction amount with Expense amount
- Tolerance: < 0.01 (handles floating point differences)
- Logic: `Math.abs(expenseAmount - bankTransactionAmount) < 0.01`

#### Eligible Expenses
Only expenses that:
- Have NOT been matched to another transaction
- Have an amount that matches the bank transaction amount (within tolerance)
- Are in the same company

#### Reference Matching
- System stores match as: `reconData[bankTransRefNumber] = { matched: true, matchedToRef: expenseRefNumber }`
- When displaying: Shows both bank ref and expense ref
- Allows finding the expense even if amount was recorded differently

### Reconciliation Data Structure
**Storage Key**: `reconciliation_{Company}`
**Format**: Object with bank transaction refs as keys
```javascript
{
  "26/04/1": { matched: true, matchedToRef: "26/04/1" },
  "26/04/2": { matched: false, matchedToRef: null },
  "26/04/3": { matched: true, matchedToRef: "26/04/3" },
  ...
}
```

### User Actions

#### Match a Transaction
1. Click "Match" button
2. Modal opens showing eligible expenses
3. Click on an expense to select (visual feedback with green border)
4. Click "Confirm Match"
5. Result:
   - Row status changes from ⚠ Unmatched to ✅ Matched
   - Row background changes from yellow to green
   - "Match" button changes to "Unmatch"
   - Matched To column shows expense details
   - Unmatched count decreases
   - Matched count increases
   - Reconciliation % updates

#### Unmatch a Transaction
1. Click "Unmatch" button
2. Confirmation dialog: "Are you sure you want to unmatch this transaction?"
3. On confirm:
   - Status changes back to ⚠ Unmatched
   - Background changes back to yellow
   - "Unmatch" button changes to "Match"
   - Matched To column shows "-"
   - Matched count decreases
   - Unmatched count increases
   - Reconciliation % updates

#### Filter Transactions
1. Click radio button (All, Unmatched Only, or Matched Only)
2. Table immediately filters to show only selected status
3. Status cards still show totals (not filtered)
4. Reconciliation % still reflects all transactions (not filtered)

### Data Persistence
- **Auto-save**: Reconciliation data saved whenever:
  - Transaction is matched
  - Transaction is unmatched
  - Page refreshes
- **Loading**: Reconciliation data loaded from localStorage when:
  - Bank Reconciliation tab is clicked
  - Company is switched
  - Page initializes

### Messages
- **Matching Success**: "✅ Transaction matched successfully!"
- **Unmatching**: "⚠ Transaction unmatched."
- **Modal Error**: Alert - "Please select an expense to match."

---

## Part 3: Integration with Add Expense Tab

### Pre-filling from Bank Parser
When user clicks "Edit" on a bank transaction:
1. Form background set to match account type
2. Fields pre-filled:
   - **General Reference**: Bank transaction ref number
   - **Invoice Date**: Transaction date
   - **Vendor**: Transaction description
   - **Amount**: Absolute value (without sign)
3. User completes remaining required fields:
   - Payment Method
   - Category
   - Subcategory
   - Status
4. User saves expense

### Reference Matching Strategy
- If expense saved with same ref number as bank transaction, they auto-match
- System first tries to find expense by `matchedToRef`
- If not found, looks for expense with same ref as bank transaction

---

## Part 4: Reconciliation Completion Workflow

### Stages

**Stage 1: 0% Reconciled**
- Status: ⚠ 0% (red)
- Action: Start matching transactions

**Stage 2: 1-49% Reconciled**
- Status: ⚠ 25% (orange) - in progress
- Action: Continue matching

**Stage 3: 50-99% Reconciled**
- Status: 🟡 75% (orange) - almost done
- Action: Match remaining transactions

**Stage 4: 100% Reconciled**
- Status: ✅ 100% (green) - complete
- Action: Ready for period close

### Completion Indicators
When reconciliation reaches 100%:
- **Reconciliation Status** shows: "✅ 100%"
- **Status color**: Green (#2E7D32)
- **Matched count**: Equals Total count
- **Unmatched count**: 0
- **All rows**: Show ✅ Matched status
- **All buttons**: Show "Unmatch" (can undo if needed)

---

## Technical Implementation - LOCKED ✅

### Functions
- `parseOCRText()` - Extracts transactions from OCR text
- `displayParsedTransactions()` - Shows extracted transactions, handles appending multiple uploads
- `editBankTransaction()` - Pre-fills Add Expense form
- `clearBankTransactions()` - Clears all data with confirmation
- `renderReconciliation()` - Loads data and initializes reconciliation tab
- `displayReconciliationTable()` - Renders table with filtering
- `matchTransaction()` - Opens matching modal with eligible expenses
- `confirmMatch()` - Saves match to reconciliationData
- `unmatchTransaction()` - Removes match with confirmation
- `filterReconciliation()` - Filters table display
- `updateReconciliationStatus()` - Calculates and updates status cards

### Data Flow
```
Bank Statement (image) 
    ↓ OCR (Tesseract.js)
Text Content
    ↓ Parse (regex patterns)
Transaction Objects
    ↓ Duplicate Check
Unique Transactions
    ↓ Reference Assignment
Numbered Transactions
    ↓ Save to localStorage (bankTransactions_{Company})
Display in Parser Table
    ↓ Create Expenses (Add Expense Tab)
Expense Objects
    ↓ Save to localStorage (expenses_{Company})
Display in Expenses Table
    ↓ Reconciliation (Bank Reconciliation Tab)
Load bank + expense data
    ↓ Matching Process
Mark transactions as matched
    ↓ Save to localStorage (reconciliation_{Company})
Calculate & display reconciliation %
```

---

## Locking Statement

**This bank reconciliation system is FINAL and LOCKED as of April 28, 2026.**

No further changes to:
- Bank Statement Parser workflow
- OCR processing and duplicate detection
- Transaction extraction and parsing logic
- Reference number assignment
- Bank Reconciliation Tab layout
- Matching mechanism and logic
- Status calculations and display
- Data persistence structure
- User interaction flow

Any future enhancements or modifications must be approved in writing before implementation.

✅ **STATUS: PRODUCTION READY**
