# Session Summary — May 21, 2026 (Day 11)

The biggest single-day build so far. Two completely new pages shipped (Monthly Checklist + Clients), the full Phase 2 invoicing module designed end-to-end across 6 steps, and three new tasks logged for the work that follows.

---

## What shipped today

### 1. Monthly Checklist (V18) — already pushed earlier as `b536598`
The fully featured recurring-task tracker. Per-company items in 5 sections (Data Entry · Reporting & Analysis · Client Invoicing & Receivables · Statutory & Periodic · Month-End Closing). Per-month completions, dynamic per-client sub-rows for Client Expense Reports, N/A skip toggle for conditional tasks (VAT, depreciation), per-section Hide/Unhide so Espargos can clone the Rabona list and tuck away what doesn't apply. Inline "+ Add task" form per section so the user can extend without a migration. Aggregate progress bar mirrors the user's accountant mental model.

### 2. V19 migration — `clients` table + Rabona seed
A proper per-company client master record. Fields: `legal_name`, `trade_name`, `contact_name`, `monthly_fee_net`, `vat_rate`, `email_to`, `email_cc`, `active`, `notes`. Seeded Rabona with all 7 clients from the user's handwritten PDF (Blue Lagoon, Urban City, Green Field Hotel, Kypseli, BAD City Hall, BAD City SPA Hotel, Evia Mare) with their fees, VAT settings, contacts, and email chains pre-filled.

### 3. V20 migration — `monthly_fixed_expense_net` column
Added a second auto-drafted recurring amount per client. BTS / Blue Lagoon has a fixed €1,200/month expense reimbursement built into the agreement (separate from variable expense reimbursements which are based on actual costs). Retro-filled BTS to €1,200. Other clients stay at 0 (variable reimbursements only).

### 4. Clients admin page — full CRUD + per-month invoicing-prep view
New top-bar tab between View Expenses and Shareholder Report. Structure that emerged after several rounds of user feedback:

**Top of page** — invoice prep tables, organized into **5 blocks** by invoice type:
1. **📄 Monthly Fee Invoices** (blue accent) — recurring monthly fees, VAT applies, all CRUD actions (Edit / Delete / Active toggle) live here only
2. **⭐ One-off Invoices** (pink) — placeholder; populates with Step 2
3. **🔁 Fixed Monthly Expense Reimbursement Invoices** (purple) — only clients with `monthly_fixed_expense_net > 0`; no VAT (pass-through cost)
4. **💸 Variable Expense Reimbursement Invoices** (amber) — sourced live from actual reimbursable expenses for the selected month; no VAT
5. **↩️ Credit Notes** (cyan) — placeholder; populates with Step 2

Each block follows the same column structure: Project name · Legal name · Description (period label inside the row) · Amount · [VAT/Total only Block 1] · then the lifecycle placeholder columns (Inv # · Issue Date · SOA ✓ · Payment Date · SOA ✓ · Status). Lifecycle cells render as gray-italic placeholders today; Step 2 wires them to a real `invoices` table.

The "Description" cell carries the period label (e.g. *"March 2026 fee"*, *"March 2026 fixed expenses"*) — matches the user's PDF mental model where each row IS one invoice with its own period, so when March + April are both invoiced in March they appear as two separate rows.

**Bottom of page** — **📧 Email Delivery directory** (slate). One card per active client showing Project · Legal · Contact · TO emails · CC emails. The per-card invoice list with Sent/Not-sent checkboxes will populate from Step 2.

Then **💤 Inactive clients** sits at the very bottom — collapsible, restorable, doesn't clutter the active flow.

### 5. Phase 2 roadmap fully designed across 6 steps
Spent the session iterating with the user through requirements for the entire Clients & Billing module. Final shape:

| Step | Task | Status |
|---|---|---|
| Step 1 | Clients table + admin page | ✅ done (today) |
| Step 2 | Invoices table + per-month worksheet (lifecycle tracking + arrears + progress bar) | #45 pending |
| ~~Step 3~~ | ~~PDF generation~~ | dropped — user keeps her own PDFs in a folder |
| Step 4 | One-click `mailto:` email composition with templated subject + body | #46 pending |
| Step 5 | Statement-of-accounts ledger | not yet logged as a task |
| Step 6 | Payment-to-invoice allocation | not yet logged as a task |

---

## Key design decisions captured in task descriptions

**Step 2 (#45) — Per-month invoicing worksheet on Clients tab**
- Each row = one invoice with its own lifecycle (Inv # → Issue Date → SOA ✓ → Email Sent → Payment Date → SOA ✓ → Finalized).
- **All fields manually editable.** No auto-pickup from any other table at this stage. User can override anything. Reason: Jan/Feb 2026 must accommodate late-2025 invoices that the system has no DB record of — bank parser can't auto-match what isn't there. Manual override always wins.
- **Carry-forward / arrears tracking**: if March's fee was Skipped, April's view shows TWO rows for that client — "March 2026 fee (in arrears)" + "April 2026 fee (current)".
- **Progress bar at top of page**, mirroring Monthly Checklist exactly — *"X of Y invoices finalized · N%"* with a green-fill bar that updates live as the user ticks lifecycle fields.
- **Invoice number format YYYY-MM-NNN** — column min-width 110px monospace already applied so layout is ready.

**Step 4 (#46) — `mailto:` email composition with templated body**
- PDF attachments dropped from scope (user keeps invoices in her own folder by invoice-number filename).
- The email body just lists the invoice number to attach as a reminder.
- Templated subject + body with `{client_name}`, `{period}`, `{amount}` placeholders.
- Works without OAuth (no Gmail/Graph API needed — `mailto:` opens default mail app with everything pre-filled).
- After user sends, they come back and tick "Email Sent" on the invoice row.

---

## Other tasks logged today

- **#42 Depreciable asset tracking** — fixed asset register (when the user enters something with a useful life, system tracks the running book value and drops it from active assets when fully depreciated)
- **#43 Real month-locking enforcement** — turn "Lock the month" from a passive checklist marker into an enforcement layer (hide Edit/Delete buttons on locked-month rows, code/PIN-gated unlock)
- **#44 ✅ Done today** — #28 Step 1 (Clients table + admin page)
- **#45 Pending** — #28 Step 2 (Invoicing worksheet — see above)
- **#46 Pending** — #28 Step 4 (mailto: composer — see above)

---

## Files changed today

**New:**
- `DATABASE_SCHEMA_V18_MIGRATION.sql` (Monthly Checklist tables + Rabona seed) — already pushed
- `DATABASE_SCHEMA_V19_MIGRATION.sql` (clients table + Rabona seed of 7 clients)
- `DATABASE_SCHEMA_V20_MIGRATION.sql` (monthly_fixed_expense_net column + BTS retro-fill)
- `src/components/MonthlyChecklist/MonthlyChecklist.jsx` + `.css` (full page) — already pushed
- `src/components/Clients/Clients.jsx` + `.css` (full page with 5 invoice blocks + Email Delivery + Inactive)
- `SESSION_SUMMARY_MAY_21_2026.md` — this file

**Modified:**
- `src/App.jsx` — new Monthly Checklist tab (already pushed) + new Clients tab (pending push)

---

## What's still on the queue

1. **#25** Espargos client list — partially solved (the Clients tab handles both companies; user just needs to populate Espargos's own client list via the UI)
2. **#27** Authentication + Vercel deployment (production launch)
3. **#28** Phase 2 Clients & Billing — Step 1 done; Steps 2 → 4 → 5 → 6 pending
4. **#42** Depreciable asset tracking
5. **#43** Real month-locking enforcement
6. **#45** Step 2 — Per-month invoicing worksheet (the big one)
7. **#46** Step 4 — mailto: email composer
8. **Step 5** — Statement-of-accounts ledger (needs its own task)
9. **Step 6** — Payment-to-invoice allocation (needs its own task)

---

## Commits + pushes

| Commit | What |
|---|---|
| `b536598` | Monthly Checklist (V18) — per-company recurring task tracker (pushed earlier today) |
| (pending) | Clients table + admin page + 5 invoice blocks + Email Delivery directory (this commit) |

Day 11 was massive. Page count: 2 new top-level pages. Phase 2 module: fully designed end-to-end. Migrations: V18, V19, V20.
