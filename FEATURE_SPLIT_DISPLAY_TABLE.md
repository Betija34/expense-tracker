# Feature: Split Expense Display in View Expenses Table

**Date**: 29 April 2026  
**Status**: ✅ IMPLEMENTED & LOCKED  
**Feature**: Visual display of split expenses with sub-references

---

## Overview

Split expenses now display intelligently in the View Expenses table with:
1. **Three new sub-reference columns** (Travel, Reimbursable, Salary)
2. **Split indicator** (🔀) showing which expenses are split
3. **Consecutive grouping** of split portions
4. **Separate main & sub-references** for clarity

---

## Table Structure

### Columns (Left to Right)
1. **Select** - Checkbox for duplicate detection
2. **Ref #** - Main reference number with split indicator (if split)
3. **Travel Sub** - Travel sub-reference (T04/1) or empty
4. **Reimbursable Sub** - Reimbursable sub-reference (R04/1) or empty
5. **Salary Sub** - Salary sub-reference (S04/1) or empty
6. **Date** - Transaction date
7. **Vendor** - Vendor/Description
8. **Category** - Expense category
9. **Subcategory** - Expense subcategory
10. **Amount** - Amount in euros
11. **Payment Method** - How it was paid
12. **Status** - Complete/Pending
13. **Actions** - Edit/Delete buttons

---

## Display Examples

### Example 1: Regular Split Expense
```
Travel Expense split 4 ways (main ref 26/04/1):

Ref #        | Travel Sub | Reimburse Sub | Salary Sub | Date    | Vendor        | ...
-------------|-----------|---------------|-----------|---------|----------------|
26/04/1 🔀   | T04/1     | -             | -         | 7/4/26  | Wolt Cyprus   | ... (Company)
26/04/1 🔀   | -         | -             | -         | 7/4/26  | Wolt Cyprus   | ... (YK)
26/04/1 🔀   | -         | -             | -         | 7/4/26  | Wolt Cyprus   | ... (BK)
26/04/1 🔀   | -         | R04/1         | -         | 7/4/26  | Wolt Cyprus   | ... (Client)
```

**Key observations:**
- All show **same main ref** (26/04/1) with **🔀 indicator**
- Company shows **T04/1** in Travel Sub column
- Client shows **R04/1** in Reimbursable Sub column
- All appear **consecutively**

### Example 2: Mixed Transactions
```
Ref #        | Travel Sub | Reimburse Sub | Salary Sub | Date    | Vendor        | ...
-------------|-----------|---------------|-----------|---------|----------------|
26/04/1 🔀   | T04/1     | -             | -         | 7/4/26  | Wolt Cyprus   | ... (Travel split)
26/04/1 🔀   | -         | -             | -         | 7/4/26  | Wolt Cyprus   |
26/04/1 🔀   | -         | -             | -         | 7/4/26  | Wolt Cyprus   |
26/04/1 🔀   | -         | R04/1         | -         | 7/4/26  | Wolt Cyprus   |
26/04/2      | -         | -             | -         | 15/4/26 | Bank Transfer | ... (Not split)
26/04/3      | -         | R04/1         | -         | 16/4/26 | GRC Transfer  | ... (Reimbursable, not split)
```

---

## How It Works

### Main Reference (Ref # Column)
- **Non-split expenses**: Shows the reference only
  - Example: `26/04/1`
  
- **Split expenses**: Shows main reference + split indicator (🔀)
  - Example: `26/04/1 🔀`
  - All portions of the same split show the same main reference
  - Makes it visually obvious they're parts of the same payment

### Sub-Reference Columns
Each sub-reference column shows the specific sub-reference IF applicable:

**Travel Sub Column:**
- Shows `T04/1` if the portion has a Travel sub-reference
- Shows `-` or empty if no Travel sub-reference
- Only populated for Company portions with Travel expense type

**Reimbursable Sub Column:**
- Shows `R04/1` if the portion has a Reimbursable sub-reference
- Shows `-` or empty if no Reimbursable sub-reference
- Populated for Company portions with Reimbursable type
- Populated for Client portions (which are ALWAYS reimbursable)

**Salary Sub Column:**
- Shows `S04/1` if the portion has a Salary sub-reference
- Shows `-` or empty if no Salary sub-reference
- Only populated for Company portions with Salary expense type

### Sorting & Grouping
Split portions automatically appear together:
1. **Grouped by main reference** (26/04/1 stays with 26/04/1)
2. **Ordered by portion type** (Company → YK → BK → Client)
3. **Then by date** for non-split items

---

## Data Storage

Each expense item now stores:

```javascript
{
  refNumber: "26/04/1",              // Original/full reference
  mainRefNumber: "26/04/1",          // Main ref for display
  travelSubRef: "T04/1",             // Travel sub if applicable
  reimbursableSubRef: "R04/1",       // Reimbursable sub if applicable
  salarySubRef: "",                  // Salary sub if applicable
  date: "07/04/2026",
  vendor: "Wolt Cyprus",
  category: "Travel Expenses",
  subcategory: "Allowances",
  amount: -45.53,
  paymentMethod: "RCC BT",
  status: "Complete",
  isSplit: true,                     // Marks as split portion
  splitPortion: "Company",           // Which portion (Company/YK/BK/Client)
  reimbursableProject: "",           // Project if applicable
  expenseType: "Travel"
}
```

---

## Split Portion Details

### Company Portion
- Shows expense type's sub-reference
- Regular: No sub-reference column filled
- Travel: T04/1 in Travel Sub column
- Reimbursable: R04/1 in Reimbursable Sub column
- Salary: S04/1 in Salary Sub column

### YK & BK Portions
- Never have sub-references (always empty in sub columns)
- Main reference displayed with split indicator
- Shows their own category/subcategory

### Client Portion
- ALWAYS has Reimbursable sub-reference (R04/1)
- Shows R04/1 in Reimbursable Sub column
- Includes project/client name in Vendor column
- Example: "Urban City (Client reimbursement)" in notes

---

## Benefits

✅ **Visual Clarity** - Split indicator (🔀) makes split expenses obvious  
✅ **Easy Grouping** - All split portions appear together, not scattered  
✅ **Sub-Reference Tracking** - See exactly which sub-references apply to each portion  
✅ **Correct Order** - Portions appear in logical order (Company, YK, BK, Client)  
✅ **Full Details** - All information visible at a glance without scrolling  

---

## Interaction with Other Features

### Editing Split Portions
- Click Edit on any split portion
- Form loads with all pre-filled data
- Main reference and sub-references are preserved
- Can modify category/subcategory per portion

### Deleting Split Portions
- Can delete individual portions
- Other portions remain (not all-or-nothing)
- Main reference display updates automatically

### Duplicate Detection
- Works across all split portions
- If portion has same vendor + amount + date, it's marked as duplicate
- Can select individual split portions for deletion

### Bank Reconciliation
- Company portion can match original bank transaction (if not Travel/Reimbursable/Salary)
- Other portions don't match bank transactions
- Reconciliation matches on main reference or sub-reference as appropriate

---

## CSV/Export Behavior

When exporting View Expenses:
- **Ref #** column shows: `26/04/1 🔀` (with split indicator)
- **Travel Sub** column shows: `T04/1` or empty
- **Reimbursable Sub** column shows: `R04/1` or empty
- **Salary Sub** column shows: `S04/1` or empty
- Each split portion appears as a separate row

---

## Validation & Rules

✅ **Split portions must total the main amount**  
✅ **Client portion always requires a project**  
✅ **All split portions marked as isSplit: true**  
✅ **Main reference stored for grouping**  
✅ **Sub-references auto-assigned based on expense type**  

---

**System**: Rabona Holdings & Espargos Expense Tracker V5  
**File**: expense_tracker_V5_COMPLETE_FINAL.html  
**Date**: 29 April 2026  
**Status**: 🔒 LOCKED
