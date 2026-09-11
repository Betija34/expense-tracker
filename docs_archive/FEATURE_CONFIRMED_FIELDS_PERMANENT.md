# Feature: Confirmed Fields Stay Locked Green

**Date**: 29 April 2026  
**Feature**: Permanent Field Confirmation  
**Status**: ✅ IMPLEMENTED

---

## The Problem (Solved)

Before: Pre-filled fields showed RED every time you edited, even if you'd already verified them were correct.

Now: Once you CONFIRM a field is correct, it turns GREEN and STAYS GREEN forever (until you change the value).

---

## How It Works

### Visual States

| State | Color | Meaning | Action |
|-------|-------|---------|--------|
| 🔴 RED | #C62828 | Needs your confirmation or editing | Click "Confirm These Fields" OR edit it |
| 🟢 GREEN | #2E7D32 | Already confirmed/locked | Don't touch - it's verified! |

---

## Step-by-Step Workflow

### First Time Editing an Extracted Transaction

```
1. Click [Edit] on extracted transaction
2. Form opens with pre-filled fields

   [Ref #: 🔴 RED]
   [Vendor: 🔴 RED]
   [Amount: 🔴 RED]
   [Date: 🔴 RED]
   [Payment Method: 🔴 RED]
   [Category: 🔴 RED] (empty, needs filling)

3. You review the pre-filled data:
   "Ref # is correct ✓"
   "Vendor is correct ✓"
   "Amount is correct ✓"
   "Dates are correct ✓"
   "Payment method is correct ✓"

4. Click "✓ Confirm These Fields"
   
   ALL pre-filled fields turn GREEN:
   [Ref #: 🟢 GREEN] ← Locked, won't need attention
   [Vendor: 🟢 GREEN] ← Locked, won't need attention
   [Amount: 🟢 GREEN] ← Locked, won't need attention
   [Date: 🟢 GREEN] ← Locked, won't need attention
   [Payment Method: 🟢 GREEN] ← Locked, won't need attention
   [Category: 🔴 RED] ← Still needs filling

5. Fill Category and other required fields

6. Click "Save Draft" or "Mark Complete"
```

### Later, When You Edit Again

```
You go to View Expenses and click [Edit] on the same transaction

Form opens:
   [Ref #: 🟢 GREEN] ← Still confirmed from before!
   [Vendor: 🟢 GREEN] ← Still confirmed from before!
   [Amount: 🟢 GREEN] ← Still confirmed from before!
   [Date: 🟢 GREEN] ← Still confirmed from before!
   [Payment Method: 🟢 GREEN] ← Still confirmed from before!
   [Category: 🟢 GREEN] ← Now filled/confirmed!

⚠️ Only TRULY unconfirmed/unfilled fields show RED
```

### Key Point: Only RED Fields Jump Out

Once you confirm a field, it NEVER shows RED again:
- ✅ Even if you save as Draft
- ✅ Even if you close and open later
- ✅ Even if you switch companies and come back
- ✅ The confirmation PERSISTS in your data

---

## What Fields Can Be Confirmed

These pre-filled fields can be confirmed:
- Ref # (Reference Number)
- Vendor Name
- Amount
- Payment Date
- Invoice Date
- Payment Method

Other fields (Category, Subcategory, Expense Type) must be filled manually - they can't be "confirmed" (they must have values).

---

## Important Behavior

### Confirming a Field
- Click "✓ Confirm These Fields"
- All RED pre-filled fields turn GREEN
- System remembers this confirmation
- You never have to verify them again

### Editing a Confirmed Field
- If you actually CHANGE the value of a confirmed field
- It turns RED again (because you changed it)
- You need to confirm it again if you're happy with the new value

### Permanently Locked
- Once confirmed, a field stays GREEN
- You can navigate away, come back, edit other expenses
- That confirmed field stays GREEN
- It's "locked as verified"

---

## Example: Real Workflow

**Day 1 - Initial Edit:**
```
Upload bank statement → €45.53 from Wolt Cyprus
Click Edit
See pre-filled:
  [Vendor: 🔴 Wolt Cyprus]
  [Amount: 🔴 45.53]
  [Date: 🔴 07/04/2026]
  
You check: "Yes, that's correct"
Click "✓ Confirm These Fields"

[Vendor: 🟢 Wolt Cyprus] ← Locked green
[Amount: 🟢 45.53] ← Locked green
[Date: 🟢 07/04/2026] ← Locked green

Fill Category: Food & Supplies
Click "Save Draft"
```

**Day 2 - Continue Editing:**
```
View Expenses → Click Edit on same transaction

See:
  [Vendor: 🟢 Wolt Cyprus] ← GREEN! Already confirmed
  [Amount: 🟢 45.53] ← GREEN! Already confirmed
  [Date: 🟢 07/04/2026] ← GREEN! Already confirmed
  [Category: 🟢 Food & Supplies] ← Already filled
  [Subcategory: 🔴 RED] ← Still needs filling

Only Subcategory shows RED - that's the only thing needing attention

Fill Subcategory: Meals
Click "Mark Complete"
```

---

## Benefits

✅ **No re-verification needed** - Once confirmed, you know it's locked  
✅ **Cleaner workflow** - Only RED fields grab your attention  
✅ **Persistent confirmation** - Confirmation survives draft saves  
✅ **Flexible** - Can still edit confirmed fields if needed  
✅ **Visible status** - GREEN = done, RED = needs work  

---

## Message You'll See

When editing a transaction:
```
"✏️ Red borders = need confirmation. 
 Click "✓ Confirm These Fields" to lock them green 
 (they'll stay green forever). 
 Or edit fields individually. 
 Only RED fields need attention."
```

---

## Technical Details

### How Confirmation is Stored
- Each expense stores a `confirmedFields` array
- Example: `confirmedFields: ['genRef', 'vendor', 'amount', 'paymentDate', 'invoiceDate', 'paymentMethod']`
- Saved with the expense to your browser storage
- Persists across sessions

### What Happens When You Edit a Confirmed Field
```
Confirmed field: [Vendor: 🟢 GREEN - "Wolt Cyprus"]
You change it to: "Starbucks"
Result: [Vendor: 🔴 RED - "Starbucks"]
Reason: You changed the value, so it needs re-confirmation

You can:
- Click "Confirm These Fields" again (locks it as "Starbucks")
- Or revert to original (Vendor goes back to 🟢 GREEN - "Wolt Cyprus")
```

---

## FAQ

**Q: If I confirm a field, can I change it?**
A: Yes. If you edit the value, it turns RED again. You'd need to confirm the new value.

**Q: Do confirmed fields carry over when switching companies?**
A: No. When you switch from Rabona to Espargos, each company has its own expenses and confirmations.

**Q: What if I confirm a field by mistake?**
A: Just edit the field (change its value), and it turns RED so you can re-confirm.

**Q: Do confirmed fields prevent me from editing?**
A: No. GREEN fields can still be edited. They're "confirmed correct" but not "locked from editing."

**Q: Will confirmed fields stay green if I close the browser?**
A: Yes. Confirmations are stored in your browser's local storage and survive restarts.

---

**Version**: 1.0  
**Date**: 29 April 2026  
**Status**: ✅ READY FOR USE

Confirmed fields stay green and locked forever!
