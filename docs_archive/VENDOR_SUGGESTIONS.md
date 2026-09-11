# Vendor Autocomplete - Smart Suggestions Feature
**Date**: 29 April 2026  
**Feature**: Dynamic Vendor List with Persistent Memory

---

## How It Works

### ✨ Auto-Learning Vendor List

Every vendor you enter is **automatically remembered** and added to your suggestion list. Next time you need to enter a recurring vendor, it appears as a suggestion.

**How the list grows:**
1. You enter "Office Depot" as a vendor → Saved
2. You save the expense
3. "Office Depot" is added to the vendor suggestion list
4. Next time you type in the vendor field, "Office Depot" appears as a suggestion
5. You can click it or continue typing

---

## Using Vendor Suggestions

### Getting Suggestions

1. **Click the Vendor Name field** in Add Expense form
2. **Start typing** the vendor name (e.g., "Off")
3. **Suggestions appear** below the field (browser dropdown)
4. **Click to select** or continue typing

### Example Workflow

```
Month 1:
├─ Expense: "Office Depot" (€150.00)
└─ Click Save → "Office Depot" added to list

Month 2:
├─ Click Vendor field
├─ Type "Off"
├─ Suggestion appears: "Office Depot"
├─ Click to select ← Much faster!
└─ Continue filling rest of expense

Month 3:
├─ Type "Off" again
├─ "Office Depot" appears instantly
└─ Click → Done! (in 1 click instead of typing whole name)
```

### Adding Custom Vendors

**If your vendor isn't in the list yet:**
1. Type the full vendor name (e.g., "New Vendor Inc")
2. Continue filling the expense form
3. Click **Save Expense**
4. The vendor is automatically added to your list
5. Next time, when you type "New", "New Vendor Inc" will appear!

---

## Smart Features

### Case-Insensitive Matching
- Type "office" or "OFFICE" → Finds "Office Depot"
- Suggestions work regardless of capitalization

### No Duplicates
- Same vendor entered twice? Won't create duplicates
- "Office Depot" and "office depot" = Same vendor

### Company-Specific Lists
- Each company (Rabona, Espargos) has its own vendor list
- Switch companies → You see that company's vendors only
- Vendors don't mix between companies

### Persistent Memory
- Vendors saved to localStorage
- Survives page refresh
- Vendors stay even after closing browser
- Can access them anytime

---

## Visual Indicator

In the form, you'll see:
```
Vendor Name * (suggestions appear as you type)
[Input field with dropdown arrow]
```

The small note reminds you that suggestions are available.

---

## Benefits

✅ **Faster data entry** - No need to retype recurring vendors  
✅ **Consistency** - Same vendor always spelled the same way  
✅ **Fewer typos** - Click to select instead of typing  
✅ **Smart memory** - System learns your recurring vendors  
✅ **Company-aware** - Each company has its own list  
✅ **Always growing** - More vendors you use = better suggestions  

---

## Recurring Vendors

If you have vendors that repeat **every month**:

**Example**: "AirBnB Commission"
- Month 1: Type and save → Added to list
- Month 2: Type "Air" → See "AirBnB Commission" → Click
- Month 3: Same → Instant access
- Month 4+: Same → No retyping needed!

Same for:
- Monthly subscriptions (e.g., "Adobe Cloud", "Spotify Premium")
- Regular suppliers (e.g., "Amazon Business", "Office Depot")
- Service providers (e.g., "Cleaning Service ABC", "Maintenance Co")

---

## Data Storage

- **Stored in**: Browser localStorage (same as expenses)
- **Key format**: `vendors_{Company}` (e.g., `vendors_Rabona`)
- **Format**: Array of vendor names
- **Survives**: Page refresh, browser restart
- **Size**: Unlimited (practically)

---

## Clearing Vendors (Advanced)

**If you need to remove a vendor:**
- No built-in delete button yet
- But you can open Browser DevTools:
  1. Press F12 → Developer Tools
  2. Go to "Application" → "Local Storage"
  3. Find `vendors_Rabona` or `vendors_Espargos`
  4. Edit the array to remove unwanted vendors
  5. Refresh the page

---

## Comparison: Before vs After

### Before This Feature
```
Month 1: Type "Office Depot" (16 characters)
Month 2: Type "Office Depot" (16 characters)
Month 3: Type "Office Depot" (16 characters)
Total typing: 48 characters/keystrokes
```

### After This Feature
```
Month 1: Type "Office Depot" (16 characters) → Added to list
Month 2: Type "Off" (3 characters) → Click "Office Depot"
Month 3: Type "Off" (3 characters) → Click "Office Depot"
Total typing: 22 characters/keystrokes
Savings: ~54% less typing!
```

---

## Combined With Projects

**You now have two smart lists:**

1. **Vendor Suggestions** - What you're paying
2. **Project Selector** - Who you're paying it for (if reimbursable)

Both systems:
- Learn over time
- Allow custom entries
- Remember selections
- Persist across sessions
- Are company-specific

---

## Tips for Maximum Efficiency

1. **Use consistent vendor names** - Always write "Office Depot" (not "Office Depot Inc" one month and "Office Depot" another)
2. **Full names help** - "Office Depot" is better than just "Office" for clarity
3. **Review monthly** - Your top 5-10 vendors will show up instantly
4. **Category vendors** - If you have "Restaurant A", "Restaurant B" → They appear as you type "Rest"

---

## Works With Split Expenses Too

When saving split expenses, the vendor from the **Split Vendor field** is also added to suggestions. So your vendor list grows even faster!

---

## Troubleshooting

**Q: I typed a vendor but it's not in suggestions yet**  
A: It will appear after you save the expense. Suggestions update automatically on save.

**Q: Same vendor showing up multiple times**  
A: The system prevents duplicates (case-insensitive). If you see the same vendor twice, try clearing and re-entering.

**Q: Switched companies and vendors are gone**  
A: Each company has its own list. You're probably looking at Espargos vendors while needing Rabona. Switch back to see Rabona's list.

---

✅ **VENDOR SUGGESTIONS LIVE & ACTIVE**

Your recurring vendors are now just 1-2 keystrokes away!

