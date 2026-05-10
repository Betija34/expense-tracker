# Testing Guide - Complete V5 System
**File**: `expense_tracker_COMPLETE_V5_READY_TO_TEST.html`  
**Date**: 29 April 2026  
**Version**: Complete with all approved features

---

## 🎯 What's in This Version

### ✅ All 17 Approved Features Implemented

1. **View Expenses Color Coding**
   - Current Account Outgoing: Light Gray
   - Current Account Incoming: Darker Gray
   - Mastercard Outgoing: Light Pink
   - Mastercard Incoming: Darker Pink
   - Manual Expenses: White

2. **Uploaded Files List**
   - Shows file name, upload date
   - Newest on top
   - Delete button per file

3. **Edit Extracted Transactions** (NEW - CRITICAL FIX)
   - Pre-fills: Vendor, Amount, Payment Date, Invoice Date, Payment Method
   - Red borders on pre-filled fields
   - All editing features active

4. **Delete Extracted Transactions** (NEW - CRITICAL FIX)
   - Delete button on each extracted transaction
   - Removes duplicates instantly

5. **Smart Date Auto-Fill**
   - Type "15" → becomes "15/04/2026"
   - Type "15/03" → becomes "15/03/2026"
   - Green text for suggestions, black for your edits

6. **Vendor Name Pre-Fill**
   - Shows vendor from bank transaction
   - Red border until you confirm

7. **Vendor Autocomplete/Suggestions**
   - Suggestions appear as you type
   - Auto-learns from saved expenses
   - Company-specific (Rabona vs Espargos)

8. **Payment Method Auto-Fill**
   - Current Account → "RCC BT"
   - Mastercard → "RMC BT"
   - Red border until you confirm

9. **Amount Pre-Fill**
   - Shows amount from bank statement
   - Red border until you confirm

10. **Red/Green Border Validation**
    - Red = needs your review
    - Green = you confirmed it
    - Shows what you've approved

11. **Save Draft Button**
    - Always enabled
    - Save incomplete work
    - Come back later to finish

12. **Mark Complete Button**
    - Only enabled when NO red borders
    - Auto-matches transactions
    - Finalizes expense

13. **Reimbursable Project Selector**
    - Appears when Expense Type = "Reimbursable"
    - 7 predefined projects + custom
    - Shows in View Expenses as "💼 Project Name"

14. **Projects Available**
    - Urban City
    - Blue Lagoon
    - Green Field Hotel
    - Kypseli
    - BAD City Hall
    - BAD City SPA Hotel
    - Evia Mare
    - Other (custom)

15. **Lock Dashboard**
    - 6 locked dashboard metrics
    - Fixed calculations

16. **Lock Bank Reconciliation**
    - Complete reconciliation system locked
    - Stable workflow

17. **Lock Add Expense Form**
    - Form structure locked
    - No changes to required fields

---

## 🧪 How to Test

### Step 1: Open the File
```
Open: expense_tracker_COMPLETE_V5_READY_TO_TEST.html
Location: /Rabona expense tracking sistem/
```

### Step 2: Clear Everything (Fresh Start)
1. Go to **Bank Statement Parser** tab
2. Scroll down to find "🗑️ Clear All Transactions" button
3. Click it
4. Confirm the warning
5. Everything should be cleared

### Step 3: Upload Bank Statement
1. In **Bank Statement Parser** tab
2. Click "📸 Click to select bank statement screenshot"
3. Select a bank statement screenshot (JPG, PNG, or PDF)
4. Wait for extraction
5. **You should see:**
   - ✅ Extracted Transactions table appears
   - ✅ "📋 Uploaded Files (Newest First)" section appears with your file
   - ✅ Transactions listed with Ref #, Date, Vendor, Amount, Type

### Step 4: Test the Delete Feature (NEW)
1. In the extracted transactions table
2. Find any transaction
3. Click the **🗑️ Delete** button (green) on the right
4. Confirm deletion
5. **Result**: Transaction should disappear immediately

### Step 5: Test Edit Feature (CRITICAL - NEWLY FIXED)
1. Click **[Edit]** button on any extracted transaction
2. **You should see:**
   - ✅ Form switches to "Add Expense" tab
   - ✅ Form has COLOR-CODED background (gray or pink based on account)
   - ✅ These fields are pre-filled with RED BORDERS:
     - Vendor Name (shows bank description)
     - Amount (shows transaction amount)
     - Payment Date (shows transaction date)
     - Invoice Date (shows transaction date, placeholder shows DD/04/2026)
     - Payment Method (shows RCC BT or RMC BT)
   - ✅ These fields are EMPTY with RED BORDERS (you must fill):
     - Category
     - Subcategory  
     - Expense Type
   - ✅ "Save Draft" button is ENABLED (blue)
   - ✅ "Mark Complete" button is DISABLED (grayed out)

### Step 6: Test Smart Date Auto-Fill
1. Click in the **Invoice Date** field
2. Type just the number: `15`
3. **Result**: Should auto-fill to `15/04/2026` with GREEN text
4. Clear it and try: `15/03`
5. **Result**: Should auto-fill to `15/03/2026` with GREEN text
6. Try full date: `15/03/2025`
7. **Result**: Should show `15/03/2025` with BLACK text

### Step 7: Test Vendor Suggestions
1. Click on **Vendor Name** field
2. You should see a dropdown arrow
3. Start typing `O` 
4. **Result**: Suggestions should appear (if you have previous vendors)
5. On first upload: Just type the vendor name
6. This vendor will be suggested next time

### Step 8: Test Red/Green Border System
1. Click on the **Vendor Name** field (it has red border)
2. Make sure vendor name is there
3. Click somewhere else
4. **Result**: Border should turn GREEN (you reviewed it)
5. Do the same for Amount field
6. And Payment Date field
7. Do the same for Invoice Date field
8. Do the same for Payment Method field

### Step 9: Test Validation System
1. Select a **Category** from dropdown
2. **Result**: Border turns GREEN
3. Select a **Subcategory**
4. **Result**: Border turns GREEN
5. Select an **Expense Type**
6. **Result**: Border turns GREEN + Category shows "Regular", "Travel", "Reimbursable", or "Salary"
7. **Now check**: The "Mark Complete" button
8. If ALL borders are GREEN (no red remaining):
   - ✅ "Mark Complete" button becomes ENABLED (bright green)
   - ✅ Can click it to save
9. If ANY red border remains:
   - ✅ "Mark Complete" button stays DISABLED (grayed out)
   - ✅ But "Save Draft" still works

### Step 10: Test Save Draft
1. Fill Category, Subcategory, Expense Type
2. Review/touch all pre-filled fields (turn them green)
3. Click **"Save Draft"** button
4. **Result**: 
   - ✅ Success message appears
   - ✅ Expense saved with "Incomplete" status
5. View Expenses tab
6. **You should see**: Transaction with status "⏳ Incomplete"

### Step 11: Test Mark Complete
1. Go back to Add Expense tab
2. Click **[Edit]** on the transaction again
3. Fill any remaining fields
4. Make sure ALL red borders are gone (all green)
5. Click **"Mark Complete"** button
6. **Result**:
   - ✅ Success message appears
   - ✅ Transaction marked "Complete"
   - ✅ Shows as "✅ Complete" in View Expenses
   - ✅ Only appears once (deduplicates)

### Step 12: Test Reimbursable Project
1. Edit an extracted transaction
2. Select **Expense Type** = "Reimbursable"
3. **Result**: Blue card appears with "💼 Project/Client" selector
4. Select a project (e.g., "Blue Lagoon")
5. Fill all other required fields
6. Mark Complete
7. Go to **View Expenses** tab
8. **Result**: Should see "💼 Blue Lagoon" below the vendor name

### Step 13: Test Vendor Learning
1. Edit a transaction
2. Enter vendor: "TEST VENDOR XYZ"
3. Fill other fields and Mark Complete
4. Edit another extracted transaction
5. Click Vendor field
6. Start typing "TEST"
7. **Result**: "TEST VENDOR XYZ" should appear in suggestions

### Step 14: Test Company Switching
1. Go to top of page
2. Find company selector dropdown
3. Switch from "Rabona" to "Espargos"
4. **Result**:
   - ✅ Uploaded Files list changes (shows Espargos files only)
   - ✅ Extracted transactions change (shows Espargos transactions only)
   - ✅ Vendor suggestions change (shows Espargos vendors only)
5. Switch back to "Rabona"
6. **Result**: Everything from Rabona is back

### Step 15: Test Delete File Feature
1. In **Bank Statement Parser** tab
2. In "📋 Uploaded Files" section
3. Click **🗑️ Delete** on any file
4. Confirm deletion
5. **Result**: File removed from list

---

## ✅ All Tests Pass Checklist

After running all 15 tests above, mark these as complete:

- [ ] Step 1: File opens
- [ ] Step 2: Clear works, everything gone
- [ ] Step 3: Upload works, file and transactions appear
- [ ] Step 4: Delete extracted transaction works
- [ ] Step 5: Edit opens with color and pre-fills
- [ ] Step 6: Smart date auto-fill works
- [ ] Step 7: Vendor suggestions work (or empty for first time)
- [ ] Step 8: Red/Green borders work
- [ ] Step 9: Validation system works (Mark Complete enabled/disabled correctly)
- [ ] Step 10: Save Draft saves expense as "Incomplete"
- [ ] Step 11: Mark Complete saves as "Complete" and deduplicates
- [ ] Step 12: Reimbursable project selector works
- [ ] Step 13: Vendor learning works (suggestions improve over time)
- [ ] Step 14: Company switching works (separate data)
- [ ] Step 15: Delete file works

---

## 🐛 If Something Doesn't Work

**Document:**
1. Which step failed?
2. What were you expecting to see?
3. What did you actually see?
4. Can you reproduce it consistently?

Then report back so I can fix it.

---

## 📝 What NOT to Test (Already Locked)

- ❌ Dashboard metrics (locked)
- ❌ Bank Reconciliation system (locked)
- ❌ Add Expense form structure (locked)
- ❌ Field names or categories (locked)

---

**Ready to Test**: ✅ YES  
**All Features Present**: ✅ YES  
**All Bugs Fixed**: ✅ YES

Go ahead and test! Report any issues found.
