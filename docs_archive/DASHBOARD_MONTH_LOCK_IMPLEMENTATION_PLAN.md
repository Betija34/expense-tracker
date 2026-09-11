# Dashboard Month Lock - Implementation Plan

**Status**: 🚀 READY FOR IMPLEMENTATION - ALL QUESTIONS ANSWERED  
**Date Started**: 29 April 2026  
**User**: betija.kedem@icloud.com

---

## ✅ CONFIRMED REQUIREMENTS

### Core Concept
**Dashboard month/year selector = SYSTEM-WIDE LOCK**
- When you select March on Dashboard, the ENTIRE system is locked to March
- Can ONLY upload, edit, view March expenses
- Cannot access January/February/other months while in March mode
- To edit other months, must switch month on Dashboard first

### What Gets Filtered by Month
1. **Bank Statement Parser** - Show only files uploaded in selected month
2. **View Expenses** - Show only expenses with payment dates in selected month
3. **Add Expense** - Payment date MUST be from selected month (Invoice date can be any month)
4. **Bank Reconciliation** - Show only transactions from selected month
5. **Shareholder Report** - Show only data from selected month
6. **Client Report** - Show only data from selected month

### File Upload Month Detection
✅ **CONFIRMED: Option A**
- **File naming convention** - Filename includes year/month (e.g., `March_2026_Statement.png`)
- **Transaction verification** - Extracted payment dates verify it's the correct month
- **Mismatch handling** - If filename says March but transactions are January → Show warning, allow user to proceed anyway

---

## ⏳ QUESTIONS AWAITING ANSWERS

### Question 3: Add Expense - Payment Date Field
**Context**: When Dashboard is locked to March 2026, how should the Payment Date field work?

**Options being evaluated:**

**A) Auto-fill with validation**
- Auto-fills payment date to selected month
- User can change it, but if they enter January date → Error: "Payment date must be in selected month"
- Allows flexibility but validates

**B) Restricted input**
- Payment date field ONLY accepts dates from March
- Can't type or select dates from other months
- Most restrictive, prevents mistakes

**C) No restriction on input**
- User can enter any date
- But if submitting with wrong month → Error before saving
- Most flexible, validates on submit

**D) Month picker instead of date input**
- Special picker that locks to March dates only
- Prevents date input errors entirely

**AWAITING YOUR ANSWER: Which approach?**

---

### Question 4: Month Switching (TO BE ASKED)
When user changes month on Dashboard (e.g., March → January):
- Should everything refresh instantly?
- Should warning appear if there are unsaved changes?

### Question 5: Error Messages & Blocking (TO BE ASKED)
What should happen when trying to:
- Upload a January file while in March mode?
- Edit a January expense while in March mode?
- Add expense with January payment date while in March mode?
- Block with error? Or warn and allow?

### Question 6: Visual Indicator (TO BE ASKED)
Should there be a clear visual indicator showing:
- Current locked month/year?
- Warning if trying to work with wrong month?
- Location on screen?

### Question 7: Default Month on Startup (TO BE ASKED)
When opening the system:
- Should it default to current month?
- Should it remember last selected month?
- Should it start with no month selected (show all)?

### Question 8: Past Pending Expenses ✅ ANSWERED
**Answer**: Options 3 + 4
- Add special "All Pending" filter in View Expenses that shows pending expenses from ANY month
- Allow editing of pending expenses from other months to change their status (mark complete)
- Month lock is strict for completed/new expenses, but flexible for pending items

---

## 🔄 IMPLEMENTATION SEQUENCE (PENDING)

Once all answers are received:

1. **Month Lock System**
   - Add month context to app object
   - Create validation function for month matching
   - Create filter function for all data

2. **Bank Statement Parser**
   - Add filename parsing for month/year
   - Filter uploaded files by month
   - Add mismatch warning

3. **View Expenses**
   - Filter by payment date month
   - Hide other months' expenses

4. **Add Expense**
   - Payment date validation/restriction (per Answer 3)
   - Block submission if wrong month

5. **Bank Reconciliation**
   - Filter transactions by month

6. **Reports**
   - Filter shareholder/client reports by month

7. **UI & Warnings**
   - Add month lock indicator
   - Add error messages
   - Add switch month warnings (if needed)

---

## 📋 READY FOR NEXT SESSION

**When you return:**
1. Start with **Question 3: Add Expense Payment Date approach** (A, B, C, or D?)
2. Then proceed through Questions 4-8
3. Once all answers confirmed, begin implementation
4. Lock the entire system to month selection

**All context preserved. No information lost.**

---

**System File**: expense_tracker_V5_COMPLETE_FINAL.html  
**Locked Features Count**: 40+  
**New Feature**: Dashboard Month Lock System  
**Status**: 🔒 Awaiting final requirements
