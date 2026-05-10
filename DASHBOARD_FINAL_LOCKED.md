# Rabona Holdings Expense Tracker - Dashboard Final Specification
## **LOCKED ✅ - No Further Changes**

---

## Dashboard Overview
The dashboard is the primary financial snapshot of Rabona Holdings and Espargos operations. It displays 6 locked rows of metrics calculated in real-time from expense data.

---

## **ROW 1: CORE FINANCIALS** ✅ LOCKED
**Purpose**: Quick snapshot of revenue vs expenses for the period
**Layout**: 2 cards in one row
**Auto-Calculated**: Yes - updates on every expense save

### Card 1: Actual Income
- **Label**: "Actual Income"
- **Metric**: Total positive revenue received
- **Calculation**: Sum of all amounts where:
  - `amount > 0` (positive/incoming)
  - AND `category ≠ 'Transfers to Connected Accounts'`
  - AND `category ≠ 'Personal Expenses of Shareholders'`
  - AND `category ≠ 'Movement Between Accounts'`
- **Display Format**: €X,XXX.XX
- **Example**: €25,000.00

### Card 2: Total Expenses
- **Label**: "Total Expenses"
- **Metric**: Total negative/outgoing amounts
- **Calculation**: Sum of all amounts where `amount < 0`, then convert to absolute value
- **Display Format**: €X,XXX.XX
- **Example**: €8,500.00

---

## **ROW 2: INTERNAL ACCOUNT MOVEMENTS** ✅ LOCKED
**Purpose**: Monitor internal cash positioning between Current Account and Mastercard
**Layout**: 3 cards in one row
**Auto-Calculated**: Yes
**No Color Coding**: Plain white cards

### Card 1: Mastercard → Current
- **Label**: "Mastercard → Current"
- **Metric**: Transfers FROM Mastercard TO Current Account
- **Calculation**: Sum of amounts where:
  - `category = 'Movement Between Accounts'`
  - AND `subcategory = 'Movement from Mastercard Account to Current Account'`
- **Display Format**: €X,XXX.XX
- **Example**: €1,500.00

### Card 2: Current → Mastercard
- **Label**: "Current → Mastercard"
- **Metric**: Transfers FROM Current Account TO Mastercard
- **Calculation**: Sum of amounts where:
  - `category = 'Movement Between Accounts'`
  - AND `subcategory = 'Movement from Current Account to Mastercard Account'`
- **Display Format**: €X,XXX.XX
- **Example**: €3,000.00

### Card 3: Net Internal Movement
- **Label**: "Net Internal Movement"
- **Metric**: Balance showing which account is net lender/borrower
- **Calculation**: (Current→Mastercard) - (Mastercard→Current)
- **Display Format**: €X,XXX.XX
- **Example**: €1,500.00

---

## **ROW 3: SHAREHOLDER MOVEMENTS** ✅ LOCKED
**Purpose**: Track transfers to/from shareholders (YK and BK only)
**Layout**: 2 shareholder groups, 3 cards each = 6 cards total (2 visual rows)
**Auto-Calculated**: Yes
**No Color Coding**: Plain white cards

### YK Section
**Header**: "YK" (shown above the row of 3 cards)

#### Card 1: Transfers From 🟢
- **Label**: "Transfers From 🟢"
- **Subtitle**: "Incoming from shareholder"
- **Metric**: Money received from YK
- **Calculation**: Sum of amounts where:
  - `category = 'Personal Expenses of Shareholders'`
  - AND `subcategory` includes 'YK'
  - AND amount is incoming (specifically marked or negative)
- **Display Format**: €X,XXX.XX

#### Card 2: Transfers To 🔴
- **Label**: "Transfers To 🔴"
- **Subtitle**: "Outgoing to shareholder"
- **Metric**: Money transferred to YK
- **Calculation**: Sum of amounts where:
  - `category = 'Personal Expenses of Shareholders'`
  - AND `subcategory` includes 'YK'
  - AND `subcategory` includes ('Transfers to SH' OR 'Payments Made on Behalf')
- **Display Format**: €X,XXX.XX

#### Card 3: Balance
- **Label**: "Balance"
- **Subtitle**: "Net position"
- **Metric**: Who owes who
- **Calculation**: (Transfers To) - (Transfers From)
- **Display Format**: €X,XXX.XX

### BK Section
**Header**: "BK" (shown above the row of 3 cards)

#### Card 1: Transfers From 🟢
- Same calculation as YK but for BK
- **Display Format**: €X,XXX.XX

#### Card 2: Transfers To 🔴
- Same calculation as YK but for BK
- **Display Format**: €X,XXX.XX

#### Card 3: Balance
- Same calculation as YK but for BK
- **Display Format**: €X,XXX.XX

---

## **ROW 4: EXPENSES TO BE REIMBURSED TO CLIENTS** ✅ LOCKED
**Purpose**: Track expenses allocated to clients for invoicing
**Layout**: 1 card spanning full width
**Auto-Calculated**: Yes

### Card: Total Expenses to be Reimbursed
- **Label**: "Total Expenses to be Reimbursed"
- **Subtitle**: "To be reimbursed to clients"
- **Metric**: Sum of client-allocated expenses
- **Calculation**: Sum of amounts where:
  - (`expenseType = 'Reimbursable'` AND `amount < 0`)
  - OR (`splitPortion = 'Client'` AND `amount < 0`)
- **Display Format**: €X,XXX.XX
- **Example**: €5,200.00

---

## **ROW 5: INTER-COMPANY TRANSFERS** ✅ LOCKED
**Purpose**: Track Rabona ↔ Espargos relationship
**Layout**: 3 cards in one row
**Auto-Calculated**: Yes
**No Color Coding**: Plain white cards
**Note**: Only visible when viewing Rabona company

### Card 1: Espargos → Rabona 🟢
- **Label**: "Espargos → Rabona 🟢"
- **Subtitle**: "Incoming"
- **Metric**: Money transferred FROM Espargos TO Rabona
- **Calculation**: 
  - If current company is Rabona: Check Espargos expenses where
    - `category = 'Transfers to Connected Accounts'`
    - AND (`subcategory = 'Other [Custom]'` OR `subcategory` includes 'Rabona')
  - OR check Rabona expenses where vendor includes 'from Espargos'
- **Display Format**: €X,XXX.XX
- **Example**: €3,000.00

### Card 2: Rabona → Espargos 🔴
- **Label**: "Rabona → Espargos 🔴"
- **Subtitle**: "Outgoing"
- **Metric**: Money transferred FROM Rabona TO Espargos
- **Calculation**: Sum of amounts where:
  - `category = 'Transfers to Connected Accounts'`
  - AND `subcategory = 'Espargos'`
- **Display Format**: €X,XXX.XX
- **Example**: €5,000.00

### Card 3: Net Inter-Company Flow
- **Label**: "Net Inter-Company Flow"
- **Subtitle**: "Balance"
- **Metric**: Net flow direction
- **Calculation**: (Rabona→Espargos) - (Espargos→Rabona)
- **Interpretation**:
  - Positive = Rabona has sent more to Espargos
  - Negative = Espargos has sent more to Rabona
  - Zero = Balanced relationship
- **Display Format**: €X,XXX.XX
- **Example**: €2,000.00

---

## **ROW 6: INTER-COMPANY REIMBURSEMENTS** ✅ LOCKED
**Purpose**: Track expenses paid by one company on behalf of another
**Layout**: 3 cards in one row
**Auto-Calculated**: Yes
**No Color Coding**: Plain white cards

### Card 1: Expenses Paid on Behalf of Espargos
- **Label**: "Expenses Paid on Behalf of Espargos"
- **Subtitle**: "Rabona paid for Espargos"
- **Metric**: When Rabona pays an Espargos expense
- **Calculation**: Sum of Rabona expenses where:
  - Vendor name contains (case-insensitive):
    - "Espargos:" (e.g., "Espargos: Office Supplies")
    - "for Espargos" (e.g., "Purchased for Espargos")
    - "@Espargos" (e.g., "Legal Services @Espargos")
  - AND `amount < 0`
- **Display Format**: €X,XXX.XX
- **Example**: €2,150.00

### Card 2: Expenses Paid on Behalf of Rabona
- **Label**: "Expenses Paid on Behalf of Rabona"
- **Subtitle**: "Espargos paid for Rabona"
- **Metric**: When Espargos pays a Rabona expense
- **Calculation**: Sum of Espargos expenses where:
  - Vendor name contains (case-insensitive):
    - "Rabona:" (e.g., "Rabona: Equipment")
    - "for Rabona" (e.g., "Courier for Rabona")
    - "@Rabona" (e.g., "Services @Rabona")
  - AND `amount < 0`
- **Display Format**: €X,XXX.XX
- **Example**: €800.00

### Card 3: Balance - Who Owes Who
- **Label**: "Balance - Who Owes Who"
- **Subtitle**: "Net reimbursement owed"
- **Metric**: Net balance between companies
- **Calculation**: (Paid for Espargos) - (Paid for Rabona)
- **Interpretation**:
  - Positive = Espargos owes Rabona (Rabona paid more)
  - Negative = Rabona owes Espargos (Espargos paid more)
  - Zero = Balanced - no outstanding reimbursement
- **Display Format**: €X,XXX.XX
- **Example**: €1,350.00

---

## Dashboard Features - LOCKED ✅

### Real-Time Updates
- Dashboard recalculates automatically when:
  - A new expense is saved (single or split)
  - Dashboard tab is clicked/opened
  - Company is switched
  - Any expense is modified

### Company Awareness
- Dashboard displays metrics for currently selected company only
- Switching company immediately updates all displayed values
- Row 5 (Inter-Company) compares against the OTHER company
- Company name displayed in header: "Dashboard - [Company Name]"

### No Manual Input
- All values are auto-calculated from expense data
- No manual entry fields on dashboard
- All calculations are performed in updateDashboard() JavaScript function

### Data Source
- All calculations pull from: `this.expenses[this.currentCompany]`
- For inter-company: also checks `this.expenses['Espargos']` or `this.expenses['Rabona']`
- Data persists via localStorage

### Display Format Standards
- All currency amounts: €X,XXX.XX (European format with period as thousands separator)
- All cards have consistent styling
- All cards show metric label and calculated value
- Optional subtitle for clarity on what metric represents

---

## Complete Visual Layout

```
═══════════════════════════════════════════════════════════════
              DASHBOARD - RABONA HOLDINGS
═══════════════════════════════════════════════════════════════

ROW 1: CORE FINANCIALS
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  Actual Income              │  │  Total Expenses             │
│    €25,000.00               │  │     €8,500.00               │
└─────────────────────────────┘  └─────────────────────────────┘

ROW 2: INTERNAL ACCOUNT MOVEMENTS
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Mastercard → Current │  │ Current → Mastercard │  │ Net Internal Movement│
│    €1,500.00         │  │    €3,000.00         │  │    €1,500.00         │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘

ROW 3: SHAREHOLDER MOVEMENTS
YK
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Transfers From 🟢 │  │ Transfers To 🔴   │  │ Balance          │
│    €500.00       │  │    €2,000.00     │  │    €1,500.00     │
└──────────────────┘  └──────────────────┘  └──────────────────┘

BK
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Transfers From 🟢 │  │ Transfers To 🔴   │  │ Balance          │
│    €0.00         │  │    €1,500.00     │  │    €1,500.00     │
└──────────────────┘  └──────────────────┘  └──────────────────┘

ROW 4: EXPENSES TO BE REIMBURSED TO CLIENTS
┌──────────────────────────────────────────────────────────────┐
│  Total Expenses to be Reimbursed                             │
│    €5,200.00                                                 │
└──────────────────────────────────────────────────────────────┘

ROW 5: INTER-COMPANY TRANSFERS
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Espargos → Rabona 🟢 │  │ Rabona → Espargos 🔴 │  │ Net Inter-Co Flow    │
│    €3,000.00         │  │    €5,000.00         │  │    €2,000.00         │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘

ROW 6: INTER-COMPANY REIMBURSEMENTS
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Paid on Behalf of    │  │ Paid on Behalf of    │  │ Balance - Who Owes   │
│ Espargos             │  │ Rabona               │  │ Who                  │
│    €2,150.00         │  │    €800.00           │  │    €1,350.00         │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘

═══════════════════════════════════════════════════════════════
```

---

## JavaScript Implementation Details - LOCKED ✅

### Function: updateDashboard()
**Location**: Line ~1329 in expense_tracker_v4.html
**Trigger**: 
- On page load via init()
- When saving an expense
- When switching companies
- When clicking dashboard tab

**Process**:
1. Gets current company expenses
2. Initializes all metric variables to 0
3. Loops through each expense once, calculating:
   - Row 1: actualIncome, totalExpenses
   - Row 2: currentToMastercard, mastercardToCurrent
   - Row 3: ykData (from, to), bkData (from, to)
   - Row 4: clientReimbTotal
   - Row 5: rabonaToEspargos
   - Row 6: paidForEspargos, paidForRabona
4. Checks Espargos/Rabona company (whichever is not current) for inter-company metrics
5. Updates DOM elements with calculated values
6. Calls updateReconciliationStatus()

---

## Locking Statement

**This dashboard structure is FINAL and LOCKED as of April 28, 2026.**

No further changes to:
- Row organization (6 rows, exact order)
- Card layouts (cards per row)
- Calculation logic
- Display format
- Metric definitions
- Update triggers

Any future enhancements must be approved in writing before changes.

✅ **STATUS: PRODUCTION READY**
