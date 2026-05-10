# Dashboard Guide - Internal Transfers Tracking

## Overview
The Dashboard now provides real-time visibility into your financial metrics, including detailed internal account transfers between Rabona's Current Account and Mastercard Account.

---

## Dashboard Sections

### 1. Main Metrics
These cards show your overall financial position:

| Metric | Description | What It Tracks |
|--------|-------------|-----------------|
| **Actual Income** | Positive revenues received | All inward transfers excluding internal transfers |
| **Total Expenses** | Negative/outgoing amounts | All expenses excluding internal transfers |
| **Transfers to Connected Accounts** | Amounts to Espargos | "Transfers to Connected Accounts" category only |
| **Bank Reconciliation %** | Match percentage | % of bank transactions matched to expenses |

---

### 2. Internal Account Movements (NEW)
This section specifically tracks money moving between your two Rabona accounts:

#### **Current → Mastercard**
- **Color**: Orange (🟡)
- **Shows**: Total amount transferred FROM Current Account TO Mastercard Account
- **Category**: "Movement Between Accounts" → "Movement from Current Account to Mastercard Account"
- **Example**: €1,500.00 = you moved €1,500 from Current to Mastercard

#### **Mastercard → Current**
- **Color**: Blue (🔵)
- **Shows**: Total amount transferred FROM Mastercard Account TO Current Account
- **Category**: "Movement Between Accounts" → "Movement from Mastercard Account to Current Account"
- **Example**: €800.00 = you moved €800 from Mastercard back to Current

#### **Net Internal Movement**
- **Color**: Purple (🟣) - changes based on direction
- **Shows**: Difference between the two directions
- **Calculation**: (Current→MC) minus (MC→Current)
- **Color Indicators**:
  - 🟡 **Orange** = Net movement toward Mastercard (Current→MC is higher)
  - 🔵 **Blue** = Net movement toward Current (MC→Current is higher)
  - 🟣 **Purple** = Balanced (equal amounts both directions)

#### **Total Internal Transfers**
- **Color**: Green (✅)
- **Shows**: Combined total of both directions
- **Calculation**: (Current→MC) + (MC→Current)
- **Example**: €1,500 + €800 = €2,300 total internal movements

---

## How to Log Internal Transfers

### When You Move Money Between Accounts:

1. Go to **Add Expense** tab
2. Click **General Reference** → Auto-filled
3. Select **Payment Method**: RCC BT (for bank transfer)
4. Enter **Invoice Date** and **Payment Date**
5. **Vendor**: Enter the type of transfer (e.g., "Account Transfer", "Card Funding")
6. **Amount**: Enter the transfer amount
7. **Category**: Select **"Movement Between Accounts"**
8. **Subcategory**: Choose:
   - "Movement from Current Account to Mastercard Account" (if Current→MC)
   - "Movement from Mastercard Account to Current Account" (if MC→Current)
9. **Status**: Mark as Complete
10. Click **Save Expense**

The Dashboard will automatically recalculate and display the updated internal transfer metrics.

---

## Examples

### Example 1: Moving €1,000 from Current to Mastercard
```
Category: Movement Between Accounts
Subcategory: Movement from Current Account to Mastercard Account
Amount: €1,000.00

Dashboard Shows:
Current → Mastercard: €1,000.00
Mastercard → Current: €0.00
Net Internal Movement: €1,000.00 (🟡 Orange)
Total Internal Transfers: €1,000.00
```

### Example 2: Two-Way Movement
```
First Entry:
Category: Movement Between Accounts
Subcategory: Movement from Current Account to Mastercard Account
Amount: €1,500.00

Second Entry:
Category: Movement Between Accounts
Subcategory: Movement from Mastercard Account to Current Account
Amount: €800.00

Dashboard Shows:
Current → Mastercard: €1,500.00
Mastercard → Current: €800.00
Net Internal Movement: €700.00 (🟡 Orange - more moved to MC)
Total Internal Transfers: €2,300.00
```

### Example 3: Balanced Movement
```
Current → Mastercard: €1,000.00
Mastercard → Current: €1,000.00

Dashboard Shows:
Net Internal Movement: €0.00 (🟣 Purple - balanced)
Total Internal Transfers: €2,000.00
```

---

## Key Features

✅ **Real-Time Updates**: Dashboard refreshes automatically when you:
- Save a new expense
- Click on the Dashboard tab
- Switch between companies

✅ **Clear Color Coding**:
- 🟡 Orange = Current to Mastercard
- 🔵 Blue = Mastercard to Current
- 🟣 Purple = Net movement (balanced when €0)
- ✅ Green = Total of both

✅ **Separate from Regular Expenses**:
- Internal transfers are tracked separately
- Don't count as "expenses" or "income"
- Only appear in "Internal Account Movements" section

✅ **Period Tracking**:
- Metrics show current period only
- Updates whenever you add/modify expenses
- Persists across sessions via localStorage

---

## Dashboard Layout

```
MAIN METRICS
┌─────────────────┬─────────────────┬──────────────────┬──────────────────────┐
│  Actual Income  │ Total Expenses  │ Transfers to     │ Bank Reconciliation% │
│     €5,000      │     €1,200      │ Connected Accts  │       75%            │
│                 │                 │      €1,000      │                      │
└─────────────────┴─────────────────┴──────────────────┴──────────────────────┘

INTERNAL ACCOUNT MOVEMENTS
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Current → MC     │ Mastercard → Cur │ Net Movement     │ Total Internal   │
│    €1,500.00     │     €800.00      │    €700.00 🟡    │    €2,300.00     │
│                  │                  │                  │                  │
│ Transfers from   │ Transfers from   │ Current - MC     │ Combined total   │
│ Current to MC    │ MC to Current    │ (+ = toward MC)  │ of both ways     │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

---

## Tips & Best Practices

💡 **Track All Transfers**: Log every internal transfer for accurate financial reporting

💡 **Use Correct Subcategory**: Select the right direction so calculations are accurate

💡 **Check Net Movement**: Quickly see if you're holding more in Current or Mastercard

💡 **Compare Over Time**: Monitor internal movements month-to-month for cash management insights

💡 **Reconciliation**: Match these transfers to your bank statements in Bank Reconciliation tab

---

## Troubleshooting

**Q: Internal transfers not showing in Dashboard?**
A: Make sure you selected category "Movement Between Accounts" and saved the expense

**Q: Numbers seem wrong?**
A: Verify the subcategory is correct (Current→MC vs MC→Current)

**Q: Want to clear and start over?**
A: Delete the expense entries, or use "Clear All Transactions" in Bank Statement Parser

---

## Integration with Other Features

- **Bank Reconciliation**: Match these transfers to bank statement transactions
- **Reports**: Internal transfers export separately from regular expenses
- **Shareholder Reports**: These don't count as shareholder expenses/transfers
- **Company Switching**: Each company (Rabona/Espargos) has separate tracking
