# 🔒 LOCKED: Split Expense Display Feature

**Date**: 29 April 2026  
**Status**: ✅ LOCKED - No modifications without explicit written permission

---

## What's Locked

The **Split Expense Display** feature in the View Expenses table is now **LOCKED**.

### Features Protected:
- ✅ Three new sub-reference columns (Travel Sub, Reimbursable Sub, Salary Sub)
- ✅ Split indicator (🔀) on main reference numbers
- ✅ Sub-reference display logic (T04/1, R04/1, S04/1)
- ✅ Consecutive grouping of split portions
- ✅ Portion ordering (Company → YK → BK → Client)
- ✅ Data structure (mainRefNumber, travelSubRef, reimbursableSubRef, salarySubRef)
- ✅ Display formatting and styling
- ✅ Sorting algorithm
- ✅ Empty column display ("-")
- ✅ Color coding and visual indicators

---

## Protection Agreement

**No changes will be made to the Split Expense Display feature unless:**
1. You explicitly request a change in writing
2. You describe exactly what needs to change
3. You approve the changes before they are implemented

---

## Current Feature Functionality

### Table Columns
1. Select (checkbox)
2. **Ref #** (main reference with 🔀 for splits)
3. **Travel Sub** (T04/1 if applicable)
4. **Reimbursable Sub** (R04/1 if applicable)
5. **Salary Sub** (S04/1 if applicable)
6. Date
7. Vendor
8. Category
9. Subcategory
10. Amount
11. Payment Method
12. Status
13. Actions

### Split Display Logic
- **Main Reference**: Shows base reference (26/04/1)
- **Split Indicator**: 🔀 appears next to all split portion references
- **Sub-References**: Show in appropriate columns based on expense type
  - Travel portions: T04/1 in Travel Sub column
  - Reimbursable portions: R04/1 in Reimbursable Sub column
  - Salary portions: S04/1 in Salary Sub column
  - If not applicable: "-" displayed

### Grouping & Order
- Split portions from same main reference appear consecutively
- Order within split: Company → YK → BK → Client
- Then sorted by date for other transactions

### Data Storage
Each split portion stores:
- `mainRefNumber` - Base reference for grouping
- `travelSubRef` - Travel sub-reference
- `reimbursableSubRef` - Reimbursable sub-reference
- `salarySubRef` - Salary sub-reference
- `isSplit` - Boolean flag marking as split
- `splitPortion` - Type (Company/YK/BK/Client)

---

## Example Display

### Travel Expense Split (26/04/1)
```
26/04/1 🔀 | T04/1 | -     | -     | Company Travel
26/04/1 🔀 | -     | -     | -     | YK Shareholder
26/04/1 🔀 | -     | -     | -     | BK Shareholder
26/04/1 🔀 | -     | R04/1 | -     | Client Reimbursable
```

### Regular Expense Not Split (26/04/2)
```
26/04/2    | -     | -     | -     | Regular transaction
```

---

## Interaction with Other Features

**Editing**: Can edit any split portion individually  
**Deleting**: Can delete split portions without affecting others  
**Duplicates**: Works across all split portions  
**Reconciliation**: Matches based on main reference or sub-reference  
**Export**: Includes all columns with split indicators

---

## If You Want Changes

**Please state:**
- What specific column or display element needs to change
- How you want it to work
- Whether it affects sorting, grouping, or data storage
- Any examples of how it should appear

Then I will update this document and implement the change only after your written approval.

---

**🔒 LOCKED**: 29 April 2026  
**File**: expense_tracker_V5_COMPLETE_FINAL.html  
**Contact**: Do not modify without explicit permission from user
