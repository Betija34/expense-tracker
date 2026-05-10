# Dashboard Structure - LOCKED

## Final Dashboard Layout

The Rabona Holdings expense tracking dashboard is organized into 3 rows of metrics, followed by detailed tables for shareholder and inter-company analysis.

---

## **ROW 1: Core Financials** (Always Visible)

Two metrics showing the fundamental financial position:

### Card 1: Actual Income
- **Metric**: Total positive revenue received
- **Calculation**: Sum of all inbound transfers excluding:
  - Transfers to Connected Accounts (Espargos)
  - Personal Expenses of Shareholders
  - Movement Between Accounts
- **What It Shows**: Real income earned by the company
- **Example**: €25,000.00

### Card 2: Total Expenses  
- **Metric**: Total negative/outgoing amounts
- **Calculation**: Sum of all expenses with negative amounts
- **What It Shows**: Money spent/paid out
- **Example**: €8,500.00

**Purpose**: Quick snapshot of revenue vs expenses for the period

---

## **ROW 2: Account Movements & Inter-Company Transfers** (Who Owes Who)

Four metrics showing internal cash flows and external transfers:

### Card 1: Transfers to Connected Accounts
- **Metric**: Amount transferred to Espargos
- **Color**: Green (#4CAF50)
- **Calculation**: Sum of "Transfers to Connected Accounts" → "Espargos" category
- **What It Shows**: Money sent to connected company
- **Example**: €5,000.00

### Card 2: Current → Mastercard
- **Metric**: Transfers FROM Current Account TO Mastercard Account
- **Color**: Orange (#FF9800)
- **Calculation**: Sum of "Movement Between Accounts" → "Movement from Current Account to Mastercard Account"
- **What It Shows**: Money moved from primary to card account
- **Example**: €3,000.00

### Card 3: Mastercard → Current
- **Metric**: Transfers FROM Mastercard Account TO Current Account
- **Color**: Blue (#2196F3)
- **Calculation**: Sum of "Movement Between Accounts" → "Movement from Mastercard Account to Current Account"
- **What It Shows**: Money moved from card back to primary
- **Example**: €1,500.00

### Card 4: Net Internal Movement
- **Metric**: Balance showing "who owes who" at month-end
- **Color**: Dynamic (Purple base)
- **Calculation**: (Current→Mastercard) minus (Mastercard→Current)
- **Interpretation**:
  - **Positive value** (Orange) = Current Account has "lent" more to Mastercard than received back
  - **Negative value** (Blue) = Mastercard has "lent" more to Current than received back
  - **Zero** (Purple) = Balanced; both accounts equal
- **What It Shows**: Which account is net creditor/debtor within the company
- **Example**: €1,500.00 🟡 (Current has lent €1,500 more than it received)

**Purpose**: Monitor internal cash positioning and inter-company relationships

---

## **ROW 3: Reconciliation Status**

### Card: Bank Reconciliation %
- **Metric**: Percentage of bank transactions matched to expenses
- **Calculation**: (Matched transactions / Total bank transactions) × 100
- **Status Levels**:
  - 0-33% ⚠️ (Warning)
  - 34-99% 🟡 (In Progress)
  - 100% ✅ (Complete - Green)
- **What It Shows**: Progress on bank reconciliation
- **Example**: 75%

**Purpose**: Track reconciliation completion status

---

## **SECTION 1: Shareholder Transfers Table** (Below Main Cards)

Detailed breakdown of all shareholder transactions:

### Table Structure
```
Shareholder | Current→SH | MC→SH | SH→Current | SH→MC | Total
```

**Columns:**
- **Shareholder**: YK, BK, GK, IG, RG
- **Current→SH**: Money FROM Current Account TO shareholder
- **MC→SH**: Money FROM Mastercard TO shareholder
- **SH→Current**: Money FROM shareholder TO Current Account (incoming)
- **SH→MC**: Money FROM shareholder TO Mastercard Account (incoming)
- **Total**: Sum of all transfers with this shareholder

**What It Shows**: Complete shareholder cash flow activity

---

## **SECTION 2: Inter-Company Transfers** (Below Shareholder Table)

Two cards showing Rabona ↔ Espargos relationship:

### Card 1: Rabona → Espargos
- **Color**: Green
- **Shows**: Money sent to Espargos
- **Source**: Rabona's "Transfers to Connected Accounts" → "Espargos"

### Card 2: Espargos → Rabona  
- **Color**: Blue
- **Shows**: Money received from Espargos
- **Source**: Espargos' "Transfers to Connected Accounts" → "Other [Custom]" or "Rabona"

### Card 3: Net Inter-Company Flow
- **Color**: Dynamic
- **Calculation**: Rabona→Espargos minus Espargos→Rabona
- **Interpretation**:
  - Positive (Green) = Rabona has sent more to Espargos
  - Negative (Blue) = Espargos has sent more to Rabona
  - Zero (Purple) = Balanced relationship

---

## **Data Refresh & Updates**

✅ Dashboard automatically updates when:
- Dashboard tab is opened/clicked
- Expense is saved in Add Expense tab
- Expense is rendered in View Expenses tab

✅ All calculations are real-time from localStorage data

---

## **Complete Dashboard Visual**

```
═══════════════════════════════════════════════════════════════

ROW 1: CORE FINANCIALS
┌────────────────────┐  ┌────────────────────┐
│  Actual Income     │  │  Total Expenses    │
│    €25,000.00      │  │     €8,500.00      │
└────────────────────┘  └────────────────────┘

ROW 2: ACCOUNT MOVEMENTS & INTER-COMPANY TRANSFERS
┌─────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Connected  │  │  Current→MC      │  │  MC→Current      │  │  Net Movement    │
│ Accounts    │  │   €3,000.00 🟡   │  │   €1,500.00 🔵   │  │   €1,500.00 🟡   │
│ €5,000.00   │  │ (to Espargos)    │  │                  │  │ (who owes who)   │
│             │  │                  │  │                  │  │                  │
│ to Espargos │  │                  │  │                  │  │                  │
└─────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘

ROW 3: RECONCILIATION STATUS
┌────────────────────────────┐
│  Bank Reconciliation %      │
│       75% 🟡               │
│  Transactions matched      │
└────────────────────────────┘

SECTION 1: SHAREHOLDER TRANSFERS
┌──────────┬───────────┬───────────┬─────────────┬─────────┬─────────────┐
│Shareholder│Current→SH│MC→SH     │SH→Current  │SH→MC   │Total        │
├──────────┼───────────┼───────────┼─────────────┼─────────┼─────────────┤
│YK        │€2,000.00 │€500.00   │€800.00     │€0.00   │€3,300.00   │
│BK        │€1,500.00 │€0.00     │€0.00       │€400.00 │€1,900.00   │
└──────────┴───────────┴───────────┴─────────────┴─────────┴─────────────┘

SECTION 2: INTER-COMPANY TRANSFERS
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│ Rabona → Espargos    │  │ Espargos → Rabona    │  │ Net Inter-Co Flow    │
│    €5,000.00         │  │    €3,000.00         │  │    €2,000.00 🟢      │
│                      │  │                      │  │ (more sent out)      │
└──────────────────────┘  └──────────────────────┘  └──────────────────────┘

═══════════════════════════════════════════════════════════════
```

---

## **Dashboard Specifications - LOCKED ✅**

This structure is **FINAL and LOCKED**. It provides:

1. ✅ **Clear financial snapshot** (Row 1)
2. ✅ **Movement visibility** showing who owes who (Row 2)
3. ✅ **Reconciliation status** (Row 3)
4. ✅ **Shareholder details** (Section 1)
5. ✅ **Inter-company relationships** (Section 2)

All metrics are:
- ✅ Auto-calculated from expense data
- ✅ Real-time updated
- ✅ Color-coded for quick interpretation
- ✅ Based on locked category structure

**No further dashboard structure changes** unless explicitly requested.
