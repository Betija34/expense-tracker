# 🎯 Dashboard Month Lock - CONFIRMED REQUIREMENTS

**Date**: 29 April 2026  
**Status**: ✅ ALL ANSWERS CONFIRMED - READY FOR IMPLEMENTATION  
**User**: betija.kedem@icloud.com

---

## Core Concept ✅ CONFIRMED
Dashboard month/year selector = **SYSTEM-WIDE LOCK**
- Select a month on Dashboard → entire system locked to that month
- Can ONLY upload, edit, view expenses from that month
- Cannot access other months while locked
- Switch month on Dashboard to work with different month

---

## Implementation Answers Summary

### Q3: Add Expense - Payment Date Field ✅
**Answer**: **Option A + Red Border**
- Payment date field auto-fills with selected month
- User CAN change it, but if entering wrong month → Error message
- **VISUAL REQUIREMENT**: Red border around pre-filled payment date field for verification
- Validation occurs on field change AND on form submit

### Q4: Month Switching ✅
**Answer**: **Option C - Block if Unsaved Changes**
- User can switch months anytime if no unsaved changes
- If unsaved changes exist → Warning: "You have unsaved changes. Continue to discard?"
- If user confirms → switch month, discard changes
- If user cancels → stay on current month

### Q5: Error Messages & Blocking ✅
**Answer**: **Option A - Block with Error Messages**
- Attempting wrong-month operations shows error:
  - Upload January file in March mode → Error: "This file is from January. Current month lock is March."
  - Edit January expense in March mode → Error: "Cannot edit expenses from other months while locked to March."
  - Payment date from wrong month → Error: "Payment date must be in March 2026."
- User cannot proceed with operation

### Q6: Visual Indicator ✅
**Answer**: **Option B - Highlighted Month Selector**
- Month/Year selector on Dashboard is visually highlighted
- Shows current locked month prominently
- Color highlight or border to make it obvious which month is locked
- Location: Top of Dashboard (existing location)

### Q7: Default Month on Startup ✅
**Answer**: **Option B - Remember Last Selected Month**
- System remembers the last month user was working in
- Next time they open the app → automatically locks to that month
- Stored in localStorage (company-specific data)
- Provides continuity across sessions

### Q8: Past Pending Expenses ✅
**Answer**: **Options 3 + 4 - Filter + Allow Editing**

**Option 3: Add Pending Filter**
- New filter in View Expenses: "Show All Pending"
- Shows pending expenses from ANY month regardless of current lock
- Allows following up on incomplete items

**Option 4: Allow Editing Pending from Other Months**
- Can edit pending expenses from any month (even while locked to different month)
- Only to change status (mark complete)
- Other editing (vendor, amount, category) not allowed for out-of-month pending

---

## Month-Locked Features

### 1. Dashboard Tab ✅
- Month/Year selector locked with visual highlight
- Displays metrics ONLY for selected month
- Real-time filtering by month

### 2. Bank Statement Parser ✅
- File upload restricted to selected month
- Filename parsing: detect month from filename (e.g., "March_2026_Statement.png")
- Transaction verification: check extracted dates match month
- Mismatch warning: "File appears to be from January but you're in March mode. Continue anyway?"

### 3. View Expenses ✅
- Displays ONLY expenses with payment dates in selected month
- "Show All Pending" filter for cross-month pending expenses
- Editing pending from other months allowed (status only)
- Cannot edit/delete completed expenses from other months

### 4. Add Expense ✅
- Payment date auto-fills with selected month
- Red border around pre-filled date for verification
- Validation: payment date must be in selected month
- Error if payment date from wrong month
- Invoice date can be any month

### 5. Bank Reconciliation ✅
- Shows ONLY transactions from selected month
- Matching restricted to current month
- Cannot reconcile against other months

### 6. Shareholder Report ✅
- Filtered to selected month only
- All calculations/totals for that month

### 7. Client Report ✅
- Filtered to selected month only
- All calculations/totals for that month

### 8. Export & Reports ✅
- Exports only data from selected month
- Clear indication in exported file: "Export from [Month Year]"

---

## Data Storage Requirements

### LocalStorage Structure
```javascript
{
  company: "Rabona Holdings",
  currentMonth: 3,              // 1-12 (current lock)
  currentYear: 2026,            // Year
  lastSelectedMonth: 3,         // Remember for next session
  lastSelectedYear: 2026,       // Remember for next session
  monthLockEnabled: true        // Feature toggle
  // ... rest of company data
}
```

---

## Implementation Steps (IN ORDER)

1. **Core Month Lock System**
   - Add month/year to app object
   - Create validation function: `validateMonthMatch(expense, currentMonth, currentYear)`
   - Create filter function: `filterByMonth(array, currentMonth, currentYear, allowPending=false)`
   - Add month lock indicator to Dashboard

2. **Dashboard Tab Updates**
   - Add highlighted month/year selector (visual indicator)
   - Store lastSelectedMonth/Year in localStorage
   - Load last selected month on startup
   - Filter metrics by selected month

3. **Bank Statement Parser**
   - Parse filename for month/year
   - Extract transaction dates from OCR
   - Verify month match, show warning if mismatch
   - Only show uploaded files from current month

4. **View Expenses Tab**
   - Filter by payment date month
   - Add "Show All Pending" filter
   - Allow editing pending from other months (status only)
   - Hide completed expenses from other months

5. **Add Expense Tab**
   - Auto-fill payment date to selected month
   - Add RED BORDER to pre-filled date field
   - Validate payment date on change and submit
   - Show error if wrong month

6. **Bank Reconciliation**
   - Filter transactions by month
   - Restrict matching to current month

7. **Reports (Shareholder & Client)**
   - Filter all data by month
   - Update calculations/totals

8. **Error Handling & User Feedback**
   - Error messages for wrong-month operations
   - Warning on month switch with unsaved changes
   - Clear user messaging

---

## Code Locations (In expense_tracker_V5_COMPLETE_FINAL.html)

### Month Lock System Functions (NEW)
- `initializeMonthLock()` - Initialize on page load
- `validateMonthMatch(expense, currentMonth, currentYear)` - Validate dates
- `filterByMonth(array, currentMonth, currentYear, options)` - Filter arrays
- `updateMonthDisplay()` - Update visual indicator
- `isUnsavedChanges()` - Check for unsaved changes

### Dashboard Updates
- `renderDashboard()` - Add month selector highlighting
- Month selector click handlers - Add validation

### Bank Statement Parser Updates
- `handleFileUpload()` - Add month detection
- `displayUploadedFiles()` - Filter by month

### View Expenses Updates
- `renderExpenseTable()` - Filter by payment date month
- Add "Show All Pending" filter
- Edit handler - Check if pending from other month

### Add Expense Updates
- `showAddExpenseForm()` - Auto-fill date with red border
- Date validation - Check against selected month
- Form submit - Validate date before saving

---

## Testing Checklist (After Implementation)

- [ ] Select March on Dashboard → system locked to March
- [ ] Try to upload January file → warning appears
- [ ] Try to add expense with January payment date → error appears
- [ ] Switch to January → "Unsaved changes?" if form open
- [ ] View Expenses shows only March data
- [ ] "Show All Pending" filter shows pending from all months
- [ ] Can edit pending from January to mark complete
- [ ] Close app and reopen → still on March (last selected month)
- [ ] All metrics on Dashboard show March data only
- [ ] Bank Reconciliation shows only March transactions
- [ ] Reports show March data only
- [ ] Month selector is visually highlighted

---

## Status: READY TO BUILD ✅

All requirements confirmed.
All user answers documented.
Ready to begin implementation.

**Next Step**: Update expense_tracker_V5_COMPLETE_FINAL.html with month lock system
