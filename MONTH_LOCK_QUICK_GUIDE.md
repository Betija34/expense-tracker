# 🔒 Dashboard Month Lock - Quick User Guide

**System**: Rabona Holdings & Espargos Expense Tracker V5  
**Feature**: Complete month-based filtering and locking  
**Status**: Ready to use

---

## What's New: Month Lock System

The system now locks to a selected month. Once you pick a month on the Dashboard, the ENTIRE system filters to show only that month's data.

---

## How to Use

### 1. Select a Month (Dashboard Tab)
1. Go to **Dashboard** tab
2. Click on any month button (Jan-Dec)
3. The entire system locks to that month
4. All data displayed is from that month only

**Visual Indicator**: The month selector has a **blue border** showing it's the active lock

### 2. Switch to a Different Month
1. Click a different month button
2. If you have unsaved changes in the form:
   - You'll see: "You have unsaved changes. Continue to discard them?"
   - Click **OK** to switch (loses unsaved data)
   - Click **Cancel** to stay on current month
3. All tabs update to show the new month

### 3. Add Expenses (Month-Locked)
1. Go to **Add Expense** tab
2. Notice the **Payment Date field has a red border**
3. The payment date is pre-filled (01/[Month]/[Year])
4. **You MUST verify this date** before saving
5. If you change the payment date to a different month:
   - Error: "Payment date must be in [Month Year]"
   - You cannot save until date matches selected month

**Why the red border?** It shows you that the date is pre-filled and needs your verification!

### 4. Upload Bank Statements (Month-Locked)
1. Go to **Bank Statement Parser** tab
2. Select file(s) to upload
3. If filename doesn't match the selected month:
   - Warning: "This file appears to be from [Month Year] but you're in [Month Year] mode"
   - Click **OK** to continue anyway
   - Click **Cancel** to select different files
4. Transactions are added to that month only

### 5. View Expenses (With Pending Filter)
1. Go to **View Expenses** tab
2. By default: See only expenses from selected month
3. **New Feature**: Check "📋 Show All Pending (across all months)"
   - Shows pending expenses from ANY month
   - Useful for following up on incomplete items
   - Can edit pending items to mark complete
   - Even if from a different month!

### 6. Bank Reconciliation (Month-Locked)
1. Go to **Bank Reconciliation** tab
2. Shows only transactions from selected month
3. Match/unmatch restricted to current month
4. Switch month to see different month's reconciliation

### 7. Month Preference (Remember Last)
1. The system remembers your last selected month
2. When you close and reopen the app:
   - It loads the month you were last working on
3. If you want current month, click the **⏱️ Current Month** button

---

## Important Workflows

### Workflow 1: Working on March Data
1. Dashboard: Click **Mar**
2. Add expenses: Payment dates must be in March
3. Upload March bank files
4. View expenses: Shows March only
5. Bank reconciliation: Reconciles March transactions
6. Can use "Show All Pending" to follow up on older pending items

### Workflow 2: Switching from March to April
1. You're in March (viewing March data)
2. Click **Apr** on Dashboard
3. If form has data: Confirm to discard unsaved changes
4. System switches to April
5. All tabs now show April data only
6. Payment date auto-updates to April

### Workflow 3: Following Up on Pending Items
1. You're in April (current month)
2. Go to View Expenses tab
3. Check "Show All Pending"
4. You see pending items from March, February, etc.
5. Click Edit on any pending item
6. Change status to Complete
7. Save - it updates that item's status
8. Uncheck "Show All Pending" to go back to April only

---

## Error Messages & What They Mean

### "Payment date must be in [Month Year]."
- You entered a payment date from a different month
- The month lock requires matching month/year
- **Fix**: Change payment date to match selected month

### "This file appears to be from [Month] [Year] but you're in [Month] [Year] mode. Continue anyway?"
- Your filename suggests it's from a different month
- Example: Uploading "February_2026.png" while in March mode
- **Fix**: Upload February file when in Feb mode, or click OK if correct

### "You have unsaved changes. Continue to discard them?"
- You're trying to switch months
- The form has data that hasn't been saved
- **Fix**: Click OK to switch (lose data) or Cancel to stay and save first

---

## Key Dates & Fields

### Payment Date (the month-locked field)
- **Format**: DD/MM/YYYY
- **Auto-filled**: Yes, to 01/[Month]/[Year]
- **Red border**: Indicates it needs your verification
- **Rule**: MUST match selected month

### Invoice Date (not month-locked)
- **Format**: DD/MM/YYYY
- **Can be**: Any month
- **Used for**: Document dating
- **Rule**: No restriction

---

## Tips & Tricks

### Tip 1: Check the Month
Before adding expenses, look at the Dashboard month buttons. The blue button is the current lock.

### Tip 2: Use "Show All Pending"
Don't let pending items slip through! Regularly check "Show All Pending" to follow up on incomplete expenses.

### Tip 3: Color Coding
- **Blue border + light blue background**: Active month lock indicator
- **Red border on payment date**: Requires your verification
- **Blue highlighted button**: Currently selected month

### Tip 4: Bank Reconciliation
The month lock helps Bank Reconciliation. You reconcile one month at a time, making it cleaner and more organized.

---

## FAQ

**Q: Can I work with multiple months at the same time?**
A: No, the month lock restricts you to one month at a time. Switch months to work with different data.

**Q: What if I upload a file from the wrong month?**
A: You'll get a warning. You can click OK to continue anyway, or cancel and upload the right month's file.

**Q: Can I edit old pending expenses?**
A: Yes! Use the "Show All Pending" filter in View Expenses. You can edit them to mark complete.

**Q: Does the system remember which month I was working on?**
A: Yes! Close the app and reopen it - it loads the month you were last on.

**Q: What happens to expenses if I delete them?**
A: They're permanently deleted from localStorage. Be careful with the delete button!

**Q: Can the Payment Date be in a different month?**
A: No, it must match the selected month. The system validates this.

---

## Troubleshooting

### Issue: Payment date won't save
- Check that the date matches the selected month
- Look at Dashboard - which month is the blue button on?
- Try changing the date to 01/[Selected Month]/[Year]

### Issue: Bank file won't upload
- Check the filename for month information
- The system is trying to verify the file is from the correct month
- If you confirm the warning, it should upload

### Issue: Can't switch months
- Do you have unsaved data in the form?
- Save the form or click Cancel on the warning, then try switching

### Issue: Payment date field not showing red border
- Try going to Add Expense tab again
- The border should appear when you select that tab
- Clear the form and try again

---

## Remember

🔒 **One month at a time**: Select a month on Dashboard, work in that month  
🔴 **Verify the date**: Red border on payment date means verify it  
⏳ **Remember last month**: App loads your last selected month  
📋 **Check pending items**: Use "Show All Pending" to follow up  
⏱️ **Quick reset**: Click "⏱️ Current Month" to jump to today

---

**Questions?** Check the other documentation files:
- MONTH_LOCK_IMPLEMENTATION_COMPLETE.md - Technical details
- MONTH_LOCK_REQUIREMENTS_CONFIRMED.md - Design decisions
- DASHBOARD_MONTH_LOCK_IMPLEMENTATION_PLAN.md - Implementation plan

---

**Ready to go!** The system is fully functional and ready for use.
