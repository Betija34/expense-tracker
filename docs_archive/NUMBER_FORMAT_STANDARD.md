# Number Format Standard - Euros & Cents

**Date**: 29 April 2026  
**Status**: ✅ IMPLEMENTED & VERIFIED  
**Standard**: All amounts display with euros AND cents

---

## Format Rule

**All monetary amounts MUST display with exactly 2 decimal places (cents).**

### Examples
- €336.00 ✅ (not €336)
- €45.50 ✅ (not €45.5)
- €0.01 ✅ (not €0)
- €1,234.99 ✅ (not €1,234.9)

---

## Technical Implementation

All amounts use JavaScript `.toFixed(2)` method to ensure 2 decimal places:

```javascript
// Always shows 2 decimals
amount.toFixed(2)  // 336 → "336.00", 45.5 → "45.50", 0 → "0.00"
```

---

## Verified Locations

### ✅ Dashboard Tab
- Line 2432-2469: All metrics display with `.toFixed(2)`
  - Actual Income: €336.00
  - Total Expenses: €336.00
  - All transfers and balances: €336.00

### ✅ View Expenses Tab
- Line 2158-2159: Expense table amounts with `.toFixed(2)`
  - Positive amounts (green): €336.00
  - Negative amounts (red): -€336.00

### ✅ Add Expense Tab
- Line 1350-1351: Split expense portions with `.toFixed(2)`
  - Company portion: €336.00
  - YK portion: €336.00
  - BK portion: €336.00
  - Client portion: €336.00
  - Total: €336.00

### ✅ Bank Reconciliation Tab
- Line 2695, 2873: Transaction amounts with `.toFixed(2)`
  - All bank transactions: €336.00

### ✅ Shareholder Report
- Line 2503-2507: All shareholder amounts with `.toFixed(2)`

### ✅ Matching & Selection Dialogs
- Line 2025, 2938: Expense selection displays with `.toFixed(2)`
- Line 2888: Matched transaction amounts with `.toFixed(2)`

---

## What This Means

### For You:
- Every amount you see will always show cents, even when it's .00
- €336 will display as €336.00
- €45 will display as €45.00
- No guessing whether something is €336 or €336.50

### For Data Entry:
- When you enter 336, it saves as 336.00
- When you enter 45.5, it saves and displays as 45.50
- All calculations round to 2 decimals automatically

---

## Standard Compliance

✅ **VERIFIED**: All 40+ amount displays comply with this standard  
✅ **LOCKED**: This format will not change without explicit permission  
✅ **CONSISTENT**: Same formatting everywhere in the system

---

**System**: Rabona Holdings & Espargos Expense Tracker V5  
**File**: expense_tracker_V5_COMPLETE_FINAL.html  
**Date**: 29 April 2026
