# Feature: Split Expense References & Structure

**Date**: 29 April 2026  
**Status**: ✅ IMPLEMENTED & LOCKED
**Feature**: Smart reference numbering for split expenses

---

## How Split References Work

When you split an expense, each portion gets a reference structure based on its type:

### Base Reference
All split portions use the **same base reference** from the original expense
- Example: **26/04/1** (the original extracted transaction)

### Each Portion's Reference

#### Company Portion
Gets the **base reference + optional sub-reference based on expense type**
- Regular expense: `26/04/1`
- Travel expense: `T04/1` (Travel reference)
- Reimbursable expense: `R04/1` (Reimbursable reference)
- Salary expense: `S04/1` (Salary reference)

#### YK Shareholder Portion
**Always gets base reference + -YKNM**
- Regardless of expense type
- Example: `26/04/1-YKNM`

#### BK Shareholder Portion
**Always gets base reference + -BKNM**
- Regardless of expense type
- Example: `26/04/1-BKNM`

#### Client Portion
**ALWAYS gets Reimbursable reference + REQUIRED project selection**
- ALWAYS marked as Reimbursable type (not configurable)
- ALWAYS gets R sub-reference: `R04/1`
- MUST specify which client it will be reimbursed to
- Projects include: Urban City, Blue Lagoon, Green Field Hotel, Kypseli, BAD City Hall, BAD City SPA Hotel, Evia Mare, or custom project name

---

## Example Scenarios

### Scenario 1: Travel Expense (26/04/1) Split 3 Ways
```
Company:    T04/1 (Travel reference)
YK:         26/04/1-YKNM
BK:         26/04/1-BKNM
```

### Scenario 2: Regular Expense (26/04/1) Split 4 Ways
```
Company:    26/04/1
YK:         26/04/1-YKNM
BK:         26/04/1-BKNM
Client:     R04/1 (must select project: e.g., Urban City)
```

### Scenario 3: Reimbursable Expense (26/04/1, with R04/1) Split 4 Ways
```
Company:    R04/1 (Reimbursable reference)
YK:         26/04/1-YKNM
BK:         26/04/1-BKNM
Client:     R04/1 (Project: Green Field Hotel)
```

---

## Client Portion - Special Requirements

The **Client portion is always Reimbursable**:

✅ **Required Fields**:
- Amount to reimburse to client
- Client/Project name (mandatory)
- Category & Subcategory
- Payment Method
- Reimbursable sub-reference (R04/1)

✅ **Project Selection**:
- Predefined projects: Urban City, Blue Lagoon, Green Field Hotel, Kypseli, BAD City Hall, BAD City SPA Hotel, Evia Mare
- Custom project option available if needed
- Must be selected before saving split

✅ **Validation**:
- If client portion amount > 0, project MUST be selected
- System will not save split without client project specified

---

## View Expenses Display

In the **View Expenses** table, split portions appear as separate rows:

| Ref # | Vendor | Amount | Status | Notes |
|-------|--------|--------|--------|-------|
| 26/04/1 | Wolt Cyprus | -€100.00 | Complete | Company portion |
| 26/04/1-YKNM | Wolt Cyprus | -€30.00 | Complete | YK Shareholder |
| 26/04/1-BKNM | Wolt Cyprus | -€20.00 | Complete | BK Shareholder |
| R04/1 | Wolt Cyprus | -€50.00 | Complete | 💼 Urban City (Client reimbursement) |

---

## Data Stored for Each Split Portion

```javascript
{
  refNumber: "26/04/1-YKNM",        // Base + shareholder code
  vendor: "Wolt Cyprus",             // Shared
  amount: -30.00,                    // Portion amount
  date: "07/04/2026",                // Shared
  paymentDate: "07/04/2026",         // Shared
  category: "Travel Expenses",       // Can differ per portion
  subcategory: "Allowances",         // Can differ per portion
  expenseType: "Regular",            // Can differ per portion
  isSplit: true,                     // Marked as split
  splitPortion: "YK",                // Which portion
  status: "Complete",                // All split portions complete
  reimbursableProject: undefined,    // Only for Client portion
  timestamp: "2026-04-29T..."        // When created
}
```

---

## How to Use

### Creating a Split Expense

1. **Start with regular expense form**
   - Fill: Vendor, Amount, Dates, Payment Method
   - Select Expense Type (Travel, Regular, Reimbursable, or Salary)

2. **Toggle "Is this a split expense?"**
   - Form switches to split view
   - Pre-filled data is copied to split form

3. **Distribute the amount**
   - Company: Enter amount
   - YK: Enter amount
   - BK: Enter amount
   - Client: Enter amount (if reimbursable)

4. **Fill in portion-specific details**
   - Each portion can have different category/subcategory
   - Company gets travel/reimbursable/salary sub-reference automatically
   - Client MUST have project selected

5. **Save Split Expense**
   - System validates that portions equal total amount
   - System validates client portion has project if amount > 0
   - Creates separate records for each portion
   - Each portion is marked as "Complete"

---

## Validation Rules

✅ **Sum of portions must equal total amount**
- Company + YK + BK + Client = Total

✅ **Client portion project is required**
- If client amount > 0, must select a project
- Cannot save split without client project

✅ **Each portion must have required fields**
- Category, Subcategory, Payment Method required for each

---

## Reference Numbering System

| Portion | Pattern | Example |
|---------|---------|---------|
| Company (Regular) | Base ref | 26/04/1 |
| Company (Travel) | T-SubRef | T04/1 |
| Company (Reimb) | R-SubRef | R04/1 |
| Company (Salary) | S-SubRef | S04/1 |
| YK Shareholder | Base-YKNM | 26/04/1-YKNM |
| BK Shareholder | Base-BKNM | 26/04/1-BKNM |
| Client | R-SubRef (Reimbursable) | R04/1 |

---

## Bank Reconciliation

Split portions interact with reconciliation as follows:

- **Company portion** with base ref (26/04/1) can match original bank transaction if Regular
- **Company portion** with sub-ref (T04/1, R04/1, S04/1) won't match bank transaction (new references)
- **YK & BK portions** (26/04/1-YKNM, 26/04/1-BKNM) won't match bank transactions
- **Client portion** (R04/1) can match reimbursable reference if it exists

---

**System**: Rabona Holdings & Espargos Expense Tracker V5  
**File**: expense_tracker_V5_COMPLETE_FINAL.html  
**Date**: 29 April 2026  
**Status**: 🔒 LOCKED
