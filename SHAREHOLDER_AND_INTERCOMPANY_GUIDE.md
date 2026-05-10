# Shareholder & Inter-Company Transfer Tracking

## Overview
The Dashboard now provides detailed tracking of shareholder transfers and inter-company movements between Rabona Holdings and Espargos, giving you complete visibility into cash flows.

---

## Part 1: Shareholder Transfers

### Table Structure

The Shareholder Transfers section displays a table with the following columns:

| Column | Description | Direction |
|--------|-------------|-----------|
| **Shareholder** | Name/Code of the shareholder | - |
| **Current→SH** | Transfers FROM Current Account TO Shareholder | Outgoing from Rabona |
| **MC→SH** | Transfers FROM Mastercard TO Shareholder | Outgoing from Rabona |
| **SH→Current** | Transfers FROM Shareholder TO Current Account | Incoming to Rabona |
| **SH→MC** | Transfers FROM Shareholder TO Mastercard Account | Incoming to Rabona |
| **Total** | Sum of all four directions | Complete picture |

### Supported Shareholders

The system automatically tracks these shareholder codes:
- **YK** - Shareholder YK
- **BK** - Shareholder BK
- **GK** - Shareholder GK
- **IG** - Shareholder IG
- **RG** - Shareholder RG

### How to Log Shareholder Transfers

#### TO a Shareholder (from company accounts)

1. **Add Expense** tab
2. **Category**: "Personal Expenses of Shareholders"
3. **Subcategory**: Choose based on shareholder:
   - "Transfers to SH A/C and Cash Withdrawal (YK)" → Current→YK
   - "Transfers to SH A/C and Cash Withdrawal (BK)" → Current→BK
   - Or "Payments Made on Behalf of SH (YK/BK)" → Current→YK/BK
4. **Payment Method**: 
   - Use **RCC** (Rabona Current Account) for Current→SH
   - Use **RMC** (Rabona Mastercard) for MC→SH
5. **Amount**: Enter transfer amount
6. **Status**: Mark as Complete
7. **Save**

#### FROM a Shareholder (to company accounts)

1. **Add Expense** tab
2. **Category**: "Personal Expenses of Shareholders"
3. **Subcategory**: Same options as above (system will identify direction by amount sign)
4. **Payment Method**: 
   - Use **RCC** for SH→Current
   - Use **RMC** for SH→MC
5. **Amount**: Enter as negative (e.g., -500 for €500 received)
6. **Save**

---

## Part 2: Inter-Company Transfers

### Metrics Displayed

#### **Rabona → Espargos** (🟢 Green)
- Total amount transferred FROM Rabona TO Espargos
- Sourced from Rabona's "Transfers to Connected Accounts" → "Espargos"
- Shows money flowing out of Rabona

#### **Espargos → Rabona** (🔵 Blue)
- Total amount transferred FROM Espargos TO Rabona
- Sourced from Espargos' "Transfers to Connected Accounts" → "Other [Custom]" (or mentioning Rabona)
- Shows money flowing into Rabona

#### **Net Inter-Company Flow** (🟣 Dynamic Color)
- Calculated as: Rabona→Espargos minus Espargos→Rabona
- Color Indicators:
  - 🟢 **Green** = Net positive (more sent to Espargos)
  - 🔵 **Blue** = Net negative (more received from Espargos)
  - 🟣 **Purple** = Balanced (equal both directions)

### How to Log Inter-Company Transfers

#### Rabona Sending to Espargos

1. Go to **Rabona company** (dropdown)
2. **Add Expense** tab
3. **Category**: "Transfers to Connected Accounts"
4. **Subcategory**: "Espargos"
5. **Amount**: Enter transfer amount (positive)
6. **Save**

#### Espargos Sending to Rabona

1. Go to **Espargos company** (dropdown)
2. **Add Expense** tab
3. **Category**: "Transfers to Connected Accounts"
4. **Subcategory**: "Other [Custom]"
5. **Description/Vendor**: "Transfer to Rabona" (for clarity)
6. **Amount**: Enter transfer amount (positive)
7. **Save**

The system will automatically detect this when viewing Rabona's dashboard.

---

## Examples

### Example 1: Shareholder Transfer

Scenario: You transfer €2,000 from Rabona Current Account to Shareholder YK

```
Category: Personal Expenses of Shareholders
Subcategory: Transfers to SH A/C and Cash Withdrawal (YK)
Payment Method: RCC BT
Amount: €2,000.00
```

**Dashboard Shows:**
```
Shareholder Table:
YK | Current→SH: €2,000.00 | MC→SH: €0.00 | SH→Current: €0.00 | SH→MC: €0.00 | Total: €2,000.00
```

### Example 2: Shareholder Receives Payment

Scenario: Shareholder BK transfers €500 to Rabona Mastercard

```
Category: Personal Expenses of Shareholders
Subcategory: Payments Made on Behalf of SH (BK)
Payment Method: RMC CardP
Amount: -€500.00 (negative = incoming)
```

**Dashboard Shows:**
```
Shareholder Table:
BK | Current→SH: €0.00 | MC→SH: €0.00 | SH→Current: €0.00 | SH→MC: €500.00 | Total: €500.00
```

### Example 3: Multiple Shareholders

```
YK transfers:
- Current→YK: €2,000
- SH→Current: €500
- Subtotal: €2,500

BK transfers:
- MC→BK: €1,500
- SH→MC: €800
- Subtotal: €2,300

Dashboard Shows:
YK | €2,000.00 | €0.00 | €500.00 | €0.00 | €2,500.00
BK | €0.00    | €1,500.00 | €0.00  | €800.00 | €2,300.00
```

### Example 4: Inter-Company Transfers

**Month Activity:**
- Rabona sends €5,000 to Espargos
- Espargos sends €3,000 to Rabona

**Dashboard Shows:**
```
Rabona → Espargos: €5,000.00
Espargos → Rabona: €3,000.00
Net Inter-Company Flow: €2,000.00 (🟢 Green - net out)
```

---

## Key Features

✅ **Automatic Shareholder Detection**: System identifies YK, BK, GK, IG, RG from subcategories

✅ **Directional Tracking**: Separates outgoing vs incoming transfers for each shareholder

✅ **Account-Aware**: Distinguishes between Current Account and Mastercard transfers

✅ **Cross-Company Visibility**: Automatically tracks Espargos→Rabona transfers

✅ **Real-Time Updates**: Dashboard refreshes automatically when you save transfers

✅ **Color-Coded Status**: Quick visual indicators for net flows (green/blue/purple)

✅ **Total Calculations**: Automatic totals for each shareholder and inter-company

---

## Dashboard Layout

```
SHAREHOLDER TRANSFERS TABLE
┌────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────┐
│Share   │Current→SH    │MC→SH         │SH→Current    │SH→MC         │Total     │
├────────┼──────────────┼──────────────┼──────────────┼──────────────┼──────────┤
│YK      │€2,000.00    │€0.00        │€500.00      │€0.00        │€2,500.00 │
│BK      │€0.00        │€1,500.00    │€0.00        │€800.00      │€2,300.00 │
│GK      │€1,200.00    │€0.00        │€0.00        │€0.00        │€1,200.00 │
└────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────┘

INTER-COMPANY TRANSFERS
┌───────────────────┬───────────────────┬──────────────────┐
│ Rabona→Espargos   │ Espargos→Rabona   │ Net Inter-Co Flow│
│   €5,000.00       │   €3,000.00       │   €2,000.00 🟢   │
│                   │                   │ (more sent out)  │
└───────────────────┴───────────────────┴──────────────────┘
```

---

## Integration Points

**Bank Reconciliation**: Match shareholder transfers to bank statements

**Financial Reports**: Shareholder transfers separate from regular expenses

**Company Switching**: View each company independently or see cross-company flows

**Period Tracking**: Monthly/period summaries for shareholder settlements

---

## Tips & Best Practices

💡 **Use Consistent Categories**: Always use "Personal Expenses of Shareholders" for SH transfers

💡 **Track All Directions**: Log both outgoing and incoming transfers for complete picture

💡 **Regular Monitoring**: Check shareholder totals monthly for settlement purposes

💡 **Inter-Company Audits**: Compare Rabona→Espargos with Espargos→Rabona balances

💡 **Clear Descriptions**: Use vendor field to note "Transfer to YK" or "Espargos contribution"

---

## Troubleshooting

**Q: Shareholder not appearing in table?**
A: Ensure you used correct subcategory (with YK/BK/GK/IG/RG code)

**Q: Amounts seem incorrect?**
A: Check if using correct payment method (RCC vs RMC) and amount sign (positive/negative)

**Q: Inter-company transfers not showing?**
A: Verify both companies have the transfers logged in "Transfers to Connected Accounts"

**Q: Numbers not updating?**
A: Open Dashboard tab to refresh, or save a new expense to trigger update
