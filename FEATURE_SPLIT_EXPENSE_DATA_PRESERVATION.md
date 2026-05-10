# Feature: Split Expense Data Preservation

**Date**: 29 April 2026  
**Feature**: Pre-filled data preserved when switching to split mode  
**Status**: ✅ IMPLEMENTED

---

## The Problem (Solved)

**Before**: When you switched to "Is this a split expense?" mode, all the pre-filled information disappeared:
- Vendor name gone ❌
- Payment dates gone ❌
- Amount gone ❌
- Payment method gone ❌

**Now**: All pre-filled data is automatically copied to the split form when you toggle split mode ✅

---

## How It Works

### Step 1: Fill the Regular Expense Form
```
[Vendor: 🟢 Wolt Cyprus]
[Invoice Date: 🟢 07/04/2026]
[Payment Date: 🟢 07/04/2026]
[Amount: 🟢 45.53]
[Payment Method: 🟢 RCC BT]
```

### Step 2: Check "Is this a split expense?"
```
Checkbox: ☑ Is this a split expense?
```

### Step 3: Form Automatically Switches
```
Regular form disappears
Split form appears WITH YOUR DATA:

SHARED DETAILS (Pre-populated):
[Vendor: Wolt Cyprus] ✅
[Invoice Date: 07/04/2026] ✅
[Payment Date: 07/04/2026] ✅
[Total Amount: 45.53] ✅

PORTIONS (Ready to split):
[Company Portion: € ___] (Payment Method: RCC BT ✅)
[YK Shareholder: € ___] (Payment Method: RCC BT ✅)
[BK Shareholder: € ___] (Payment Method: RCC BT ✅)
[Client: € ___] (Payment Method: RCC BT ✅)
```

---

## What Gets Copied

When you toggle to split mode, these fields are copied:

### Shared Details
✅ Vendor Name  
✅ Invoice Date  
✅ Payment Date  
✅ Total Amount  

### Payment Methods (for all portions)
✅ Company Payment Method  
✅ YK Shareholder Payment Method  
✅ BK Shareholder Payment Method  
✅ Client Payment Method  

(All portions get the same payment method from your original selection)

---

## Workflow Example

### Original Expense Entry:
```
Bank statement extracted:
  Vendor: Amazon
  Date: 15/04/2026
  Amount: €150.00
  Payment Method: RCC BT
```

### Step 1: Fill the form
```
[Vendor: Amazon]
[Invoice Date: 15/04/2026]
[Payment Date: 15/04/2026]
[Amount: 150.00]
[Payment Method: RCC BT]
```

### Step 2: Realize it's a split
"Wait, this €150 needs to be split between Company (€100), YK (€30), Client (€20)"

### Step 3: Check Split Checkbox
```
☑ Is this a split expense?

System automatically switches to split form and shows:

SHARED DETAILS:
[Vendor: Amazon] ← Preserved!
[Invoice Date: 15/04/2026] ← Preserved!
[Payment Date: 15/04/2026] ← Preserved!
[Total Amount: 150.00] ← Preserved!

PORTIONS TO SPLIT:
Company: [100.00] (Method: RCC BT ← Preserved!)
YK: [30.00] (Method: RCC BT ← Preserved!)
Client: [20.00] (Method: RCC BT ← Preserved!)

Message shows: "📋 Split form populated with shared details. 
               Now split the amount between portions."
```

### Step 4: Enter the split amounts
```
Company: €100.00 ✓
YK: €30.00 ✓
Client: €20.00 ✓
Total: €150.00 ✓
```

### Step 5: Save
```
Creates three separate expense records:
1. Company: €100.00 - Amazon (15/04/2026)
2. YK: €30.00 - Amazon (15/04/2026)
3. Client: €20.00 - Amazon (15/04/2026)
```

All with the SAME vendor, dates, and payment method!

---

## Switching Back

If you uncheck "Is this a split expense?":
- Returns to regular expense form
- The data you entered in split mode is NOT carried back
- Form returns to previous state

---

## Reassurance Message

When you toggle to split mode, you see:
```
"📋 Split form populated with shared details. 
 Now split the amount between portions."
```

This confirms:
✅ Your data was copied  
✅ You can now focus on splitting the amount  
✅ All shared information is preserved  

---

## Benefits

✅ **No re-entry** - Don't have to type vendor/dates again  
✅ **Consistent data** - All split portions have same vendor/dates  
✅ **Faster workflow** - Toggle split, adjust amounts, save  
✅ **No data loss** - All information automatically transferred  

---

## Technical Details

### Fields Copied
```
Regular Form → Split Form

vendor → splitVendor
invoiceDate → splitInvoiceDate
paymentDate → splitPaymentDate
amount → splitTotalAmount
paymentMethod → companyPayMethod, ykPayMethod, bkPayMethod, clientPayMethod
```

### Timing
- Copy happens WHEN you check the split checkbox
- Data is immediately available in split form
- No manual action needed

### Notes
- Unchecking split doesn't copy data back to regular form
- Each portion can have different categories/subcategories
- All portions use the same payment method (from original)
- You can edit the shared details in split form if needed

---

**Version**: 1.0  
**Date**: 29 April 2026  
**Status**: ✅ READY FOR USE

All pre-filled data is preserved when switching to split expense mode!
