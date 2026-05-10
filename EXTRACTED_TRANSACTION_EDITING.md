# Editing Extracted Transactions - Workflow Guide

**Date**: 29 April 2026  
**Feature**: Two-Button Save Workflow with Visual Field Review

---

## Visual Field Status

When you click **[Edit]** on an extracted transaction, the form shows:

### 🔴 Red Border = Pre-Filled Field
- **What it means**: This field was automatically filled from the bank statement
- **Your action**: Review it and either accept it or edit it
- **Example**: Vendor name, payment method, amount, dates

### 🟢 Green Border = You Edited It
- **What it means**: You have reviewed and confirmed/changed this field
- **When it appears**: As soon as you make any change to a red-bordered field
- **Example**: Changed amount from €100.00 to €95.00

### ⚪ No Border = Your Choice Fields
- **What it means**: These fields are for you to fill (not pre-filled from bank statement)
- **Example**: Category, Subcategory, Expense Type
- **Red border appears**: Until you select a value

---

## Pre-Filled Fields (Auto-Filled from Bank Transaction)

When you click **[Edit]**:

✅ **Reference Number** (Read-only) - Locked from bank statement  
✅ **Vendor Name** - From transaction description  
✅ **Amount** - From transaction amount  
✅ **Payment Date** - From transaction date  
✅ **Invoice Date** - Smart auto-fill (see section below)  
✅ **Payment Method** - Auto-selected:
   - Current Account → **RCC BT** (Rabona Credit Card)
   - Mastercard → **RMC BT** (Rabona Mastercard)

---

## Smart Invoice Date Auto-Fill

**Default**: Transaction date pre-filled (e.g., "28/04/2026")

**You can edit by typing:**
- **Just day** (e.g., "15") → Auto-completes to "15/04/2026"
- **Day/Month** (e.g., "15/03") → Auto-completes to "15/03/2026"  
- **Full date** (e.g., "15/03/2025") → Uses exactly what you typed

**Placeholder shows**: "DD/04/2026" (suggested month/year based on transaction)

---

## Fields You Must Fill

These appear with **red borders** until completed:

🔴 **Category** - Select the expense category  
🔴 **Subcategory** - Select based on category  
🔴 **Expense Type** - Regular, Travel, Reimbursable, or Salary  
🔴 **Status** - Complete or Incomplete (defaults to Incomplete)

---

## Two-Button Workflow

### 💾 Save Draft Button
- **When to use**: You want to save progress but haven't finished reviewing all fields
- **Red borders allowed**: Yes, you can have red/green borders mixed
- **Status saved as**: "Incomplete"
- **Next time**: You can edit again and the same fields will have red borders again

**Example**:
1. Click [Edit] on extracted transaction
2. Review vendor name (turn border green by confirming)
3. Select Category
4. Click **Save Draft** (haven't filled Subcategory yet - that's fine)
5. Later, continue editing and select Subcategory
6. Click **Save Draft** again

### ✓ Mark Complete Button
- **When to use**: All required fields are filled and reviewed
- **Enabled when**: ALL red borders are gone (everything reviewed or you selected a value)
- **Red borders allowed**: NO - button is DISABLED (grayed out) if any red borders remain
- **Status saved as**: "Complete"
- **Result**: Extracted transaction is matched and hidden from View Expenses (shows only as saved expense)

**Example**:
1. Click [Edit] on extracted transaction
2. Review all pre-filled fields (they turn green as you touch them)
3. Select Category, Subcategory, Expense Type, Status
4. **Mark Complete button becomes enabled** (turns from gray to bright green)
5. Click **Mark Complete**
6. Done! Transaction is now a complete expense

---

## Visual Workflow Example

```
EXTRACTED TRANSACTION in View Expenses
├─ Status: ⏳ Pending
└─ Click [Edit]

FORM OPENS with PRE-FILLED FIELDS:
├─ Vendor: "Office Supplies" [RED BORDER]
├─ Amount: "€150.00" [RED BORDER]
├─ Payment Method: "RCC BT" [RED BORDER]
├─ Invoice Date: "28/04/2026" [RED BORDER]
├─ Category: "" [RED BORDER - you need to select]
├─ Subcategory: "" [RED BORDER - you need to select]
├─ Expense Type: "" [RED BORDER - you need to select]
└─ Status: "Incomplete"

YOU REVIEW & EDIT:
├─ Vendor: "Office Supplies" [EDIT] → Green: "Office Supplies" ✓
├─ Amount: "€150.00" [ACCEPT - touch the field] → Green: "€150.00" ✓
├─ Payment Method: "RCC BT" [ACCEPT] → Green: "RCC BT" ✓
├─ Invoice Date: "28/04/2026" [ACCEPT] → Green: "28/04/2026" ✓
├─ Category: [SELECT] "Professional Services" → Green ✓
├─ Subcategory: [SELECT] "Office Supplies" → Green ✓
├─ Expense Type: [SELECT] "Regular" → Green ✓
└─ Status: [SELECT] "Complete" → No border (normal field)

ALL FIELDS REVIEWED:
├─ No red borders remaining
├─ ✓ Mark Complete button is ENABLED (bright green)
└─ Click ✓ Mark Complete

RESULT:
├─ Expense saved with status "Complete"
├─ Extracted transaction auto-matched
└─ Shows in View Expenses as ONE entry (not duplicated)
```

---

## Button States

### Save Draft Button
- **Always enabled** (gray/blue color)
- **Use anytime**: Even if you have red borders
- **Saves progress**: With incomplete status

### Mark Complete Button
- **State 1**: DISABLED & Grayed out - Red borders exist
- **State 2**: ENABLED & Bright green - All red borders gone
- **Click only when**: Button is bright green (enabled)

---

## Tips for Efficient Editing

1. **Just touch to confirm**: You don't have to change a field - just click it once to turn red border green
2. **Save draft early**: Don't worry if you need to step away - save draft and come back
3. **Batch edits**: Edit multiple extracted transactions and save drafts, then complete them together
4. **Check your edits**: Green borders show what you reviewed/changed vs. red = pre-filled

---

## After Marking Complete

✅ **Automatic deduplication**: The extracted transaction is hidden  
✅ **Shows as saved expense**: Only appears once in View Expenses (as manual entry)  
✅ **Auto-matched**: Reconciliation is updated automatically  
✅ **Status shows**: "✅ Complete" badge in View Expenses  

---

## Troubleshooting

**Q: Mark Complete button is still grayed out**  
A: Check for red borders. Review each red-bordered field (click it to turn green) or fill empty fields.

**Q: I see the same transaction twice in View Expenses**  
A: It was saved as "Incomplete" status. Click [Edit] again and click **Mark Complete** to deduplicate.

**Q: I want to save but still have changes to review**  
A: Perfect! Click **Save Draft**. You can continue editing anytime.

**Q: What if I accidentally approve a field (turned it green) but want it red again?**  
A: Click **Clear** to reset the form and start over.

---

## Color Scheme Reference

| Status | Color | Meaning |
|--------|-------|---------|
| Red Border (#C62828) | 🔴 | Pre-filled field or required empty field - needs your attention |
| Green Border (#2E7D32) | 🟢 | You reviewed/confirmed/edited this field |
| No Border | ⚪ | This field doesn't need visual review |
| Button Disabled | Gray | Mark Complete not ready - red borders still exist |
| Button Enabled | Bright Green | Mark Complete ready - all fields reviewed |

---

✅ **WORKFLOW COMPLETE**

You now have full control over extracted transaction editing with clear visual feedback at every step.

