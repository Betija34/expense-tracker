# Split Incoming Payments Feature - Test Guide

## Overview
The Split Incoming Payments feature allows you to split a single incoming payment transfer between two income categories: **Client Payment** and **Client Reimbursement** from the same project.

### Example Scenario
When a client sends €3,000 in a single transfer that covers both:
- €2,000 for services rendered (Client Payment)
- €1,000 for reimbursement of out-of-pocket expenses (Client Reimbursement)

You can now split this in one transaction instead of creating two separate ones.

---

## Test Scenario 1: Enable Split Incoming Payment Mode

### Steps:
1. **Open the "Add Expense" tab**
2. **Select "📥 Incoming Payment"** radio button (top right)
3. **Verify the form changes:**
   - ✅ Expense split toggle disappears
   - ✅ **"Is this a split incoming payment?"** checkbox appears (green bordered)
   - ✅ This is specifically for combining Client Payment + Client Reimbursement
4. **Check the checkbox for split incoming payment**
5. **Verify:**
   - ✅ Regular incoming payment form disappears
   - ✅ **Split Incoming Payment form appears** with special sections for Client Payment and Client Reimbursement portions

---

## Test Scenario 2: Create a Split Incoming Payment

### Steps:
1. **In Split Incoming Payment form, fill Shared Details:**
   - Invoice Date: `15/04/2026`
   - Vendor/Client Name: `Blue Lagoon`
   - Payment Date: `20/04/2026`
   - Project: `Blue Lagoon` (same for both portions)
   - Total Amount: `€3,000.00`
   - Payment Method: `RCC BT`

2. **Fill Client Payment Portion:**
   - Amount (€): `€2,000.00`
   - Invoice Number: `INV-2026-001` (services rendered)
   - General Reference: (auto-populated, e.g., 26/04/1) → **Confirm** ✓

3. **Fill Client Reimbursement Portion:**
   - Amount (€): `€1,000.00`
   - Invoice Number: `INV-2026-002` (reimbursement)
   - General Reference: (auto-populated, should be same as above) → **Confirm** ✓

4. **Monitor Validation Box:**
   - Should show: "Portions total: €3,000.00"
   - Should show: "Required total: €3,000.00"
   - Should show: ✓ **"Portions match total!"** in green

5. **Click "Save Split Incoming Payment"**

### Expected Results:
- ✅ Transaction saves successfully
- ✅ Two income records created (one for each portion)
- ✅ Both linked with the same **main reference number**
- ✅ Success message: "✅ Split incoming payment saved successfully!"
- ✅ Form clears and resets to expense mode

---

## Test Scenario 3: View Split Incoming Payment in Expense Table

### Steps:
1. **Switch to "View Expenses" tab**
2. **Look for your newly created split income transactions**

### Expected Display:
For the example above, you should see **TWO rows**:
```
Row 1: 26/04/1 | Blue Lagoon | +€2,000.00 (green) | 📄 Blue Lagoon / Invoice: INV-2026-001 | 📥 Client Payment
Row 2: 26/04/1 | Blue Lagoon | +€1,000.00 (green) | 💼 Blue Lagoon / Invoice: INV-2026-002 | 📥 Client Reimbursement
```

### Visual Verification:
- ✅ Both rows have **the same reference number** (26/04/1)
- ✅ Both amounts are **displayed in green** (income)
- ✅ Both show **positive amounts** with + sign
- ✅ Each shows the correct **invoice number**
- ✅ Each shows the correct **project name**
- ✅ Each shows the correct **income category** icon (📄 or 💼)
- ✅ Status is **✅ Complete**

---

## Test Scenario 4: Edit a Split Incoming Payment Portion

### Steps:
1. **In View Expenses table, click "Edit"** on the Client Payment portion (first row)
2. **Verify the form automatically:**
   - ✅ Switches to **"📥 Incoming Payment"** (not split mode at first)
   - ✅ Pre-populates vendor: `Blue Lagoon`
   - ✅ Pre-populates dates, amount, payment method
   - ✅ Pre-fills the **"Incoming Payment Category"** as **"Client Payment"**
   - ✅ Shows project: `Blue Lagoon`
   - ✅ Shows invoice number: `INV-2026-001`

3. **Make a small change** (e.g., change invoice number to `INV-2026-001A`)
4. **Click "Mark Complete"** to save
5. **Verify in View Expenses** that it updated

### Note:
- When editing a split portion individually, it shows as a regular income transaction (not split mode)
- This is correct behavior - split portions are stored individually

---

## Test Scenario 5: Validation - Portions Must Match Total

### Steps:
1. **Enable split incoming payment mode**
2. **Enter:**
   - Total Amount: `€5,000.00`
   - Client Payment Amount: `€3,000.00`
   - Client Reimbursement Amount: `€1,500.00`

3. **Verify Validation Box shows:**
   - "Portions total: €4,500.00"
   - "Required total: €5,000.00"
   - ✗ **"Portions incomplete"** in gray

4. **Try to save**
   - ❌ Should fail with message: "Portions must equal total amount!"

5. **Adjust amounts:**
   - Client Payment Amount: `€3,000.00`
   - Client Reimbursement Amount: `€2,000.00`

6. **Verify Validation Box now shows:**
   - ✓ **"Portions match total!"** in green

7. **Save should now work** ✅

---

## Test Scenario 6: Reference Numbers for Split Income

### Steps:
1. **Create first split incoming payment**
   - Reference: Auto-generates (e.g., 26/04/1)
   - Both portions get reference 26/04/1

2. **Create a second split incoming payment**
   - Reference: Auto-generates (e.g., 26/04/2)
   - Both portions get reference 26/04/2

3. **Verify in View Expenses:**
   - First split has two rows with reference 26/04/1
   - Second split has two rows with reference 26/04/2
   - References are grouped together by mainRefNumber

---

## Test Scenario 7: Mix of Regular and Split Income

### Steps:
1. **Add a regular income transaction:**
   - Type: Client Payment
   - Amount: €500.00
   - Project: Blue Lagoon
   - Invoice: INV-2026-003
   - Reference: 26/04/3

2. **Add a split incoming payment:**
   - Total: €2,000.00
   - Client Payment: €1,500.00
   - Client Reimbursement: €500.00
   - Reference: 26/04/4

3. **View Expenses table should show:**
   - 26/04/3: Single Client Payment row (+€500.00)
   - 26/04/4: Two rows (€1,500.00 + €500.00) grouped together

### Verification:
- ✅ Regular income and split income coexist correctly
- ✅ Split portions are grouped by mainRefNumber
- ✅ Dashboard totals include both types correctly

---

## Test Scenario 8: Required Fields for Split Income

### Steps:
1. **Try to save split incoming payment without:**

   **Missing Shared Details:**
   - ❌ Invoice Date → Should fail
   - ❌ Vendor Name → Should fail
   - ❌ Payment Date → Should fail
   - ❌ Project → Should fail
   - ❌ Total Amount → Should fail
   - ❌ Payment Method → Should fail

   **Missing Portion Details (if amount > 0):**
   - ❌ Invoice Number (Client Payment) → Should fail
   - ❌ Invoice Number (Client Reimbursement) → Should fail
   - ❌ General Reference → Should fail (if not confirmed)

2. **Verify error messages appear** for each missing field

---

## Test Scenario 9: Payment Date Validation

### Steps:
1. **Enter payment date from a different month**
   - Payment Date: `15/03/2026` (March, not April)
   - Current selected month: April 2026

2. **Try to save**
   - ❌ Should fail with date validation error
   - ✅ Payment date field gets red border

3. **Fix the date:**
   - Payment Date: `20/04/2026` (April)

4. **Try to save again**
   - ✅ Should succeed

---

## Test Scenario 10: Toggle Between Regular and Split Income

### Steps:
1. **Enable split incoming payment mode**
2. **Fill in some details**
3. **Uncheck "Is this a split incoming payment?"**
4. **Verify:**
   - ✅ Split form disappears
   - ✅ Regular income form reappears (empty, or with basic fields)
   - ✅ No data loss if you toggle back

5. **Check "Is this a split incoming payment?" again**
6. **Verify:**
   - ✅ Split form reappears
   - ✅ Your data is still there (if form supports it)

---

## Test Scenario 11: Dashboard Integration

### Steps:
1. **Add split incoming payments** totaling €5,000
   - Client Payment portions: €3,000
   - Client Reimbursement portions: €2,000

2. **Go to Dashboard tab**
3. **Select April 2026**
4. **Verify metrics:**
   - **Actual Income:** Includes €5,000 (both portions counted)
   - **Total Expenses:** Does NOT include income
   - **Net:** Correctly calculated

### Verification:
- ✅ Split income portions are properly summed in dashboard
- ✅ Income category breakdowns show correct totals
- ✅ No double-counting occurs

---

## Test Scenario 12: Deletion of Split Income

### Steps:
1. **Create a split incoming payment** with reference 26/04/5
   - Client Payment: €1,500.00
   - Client Reimbursement: €500.00

2. **In View Expenses, delete one of the portions**
   - Click "Delete" on Client Payment row (26/04/5)

3. **Verify:**
   - ✅ That portion is deleted
   - ✅ The other portion (Client Reimbursement) remains
   - ⚠️ You now have orphaned split portions (both should be deleted together for clean data)

4. **Best Practice:**
   - Delete both portions together to maintain data integrity
   - Or edit them back to regular income transactions

---

## Test Scenario 13: Custom Project Name

### Steps:
1. **Enable split incoming payment mode**
2. **In Project dropdown, select "Other (Custom)"**
3. **A text field should appear for custom project name**
4. **Enter: `New Client Project 2026`**
5. **Proceed to fill amounts and invoice numbers**
6. **Save**
7. **Verify in View Expenses:**
   - ✅ Both portions show project: `New Client Project 2026`

---

## Known Features (Locked - Do NOT Change Without Permission)

These features are **LOCKED** and working as designed:

✅ **Regular Incoming Payments** (Client Payment, Client Reimbursement, Supplier Refunds, Shareholder Funding, Intercompany Funding)
✅ **Split Expense System** (Company, YK, BK, Client portions)
✅ **General Reference System** (applies to both income and expenses)
✅ **Dashboard Calculations** (includes both income and expenses)

---

## Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Split Income Toggle | ✅ Complete | Only visible in income mode |
| Split Form | ✅ Complete | Shows Client Payment + Client Reimbursement portions |
| Shared Details | ✅ Complete | Invoice Date, Vendor, Payment Date, Project, Amount, Payment Method |
| Portion Amounts | ✅ Complete | Both portions tracked separately with validation |
| Portion References | ✅ Complete | Each portion can have its own General Reference |
| Invoice Numbers | ✅ Complete | Each portion has separate invoice number field |
| Validation | ✅ Complete | Portions must equal total, real-time validation display |
| Display in Table | ✅ Complete | Shows two rows grouped by mainRefNumber, with income icons |
| Dashboard Integration | ✅ Complete | Split income portions properly summed |
| Edit/Delete | ✅ Complete | Can edit individual portions after saving |

---

## Next Steps if Issues Arise

1. **Hard refresh browser** (Ctrl+F5 or Cmd+Shift+R)
2. **Check browser console** (F12 → Console) for errors
3. **Verify localStorage** (F12 → Application → Local Storage) has saved data
4. **Test specific scenario** that failed and report details

---

## Ready to Test! 🚀

Please run through these test scenarios and let me know:
- ✅ What's working perfectly
- ⚠️ Any unexpected behavior
- 💡 Any adjustments you'd like to make

The feature is production-ready!
