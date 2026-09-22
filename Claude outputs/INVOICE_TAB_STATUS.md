# Issue Invoice tab — status & next steps (as of 2026-09-18)

## What the feature is
A new **Issue Invoice** tab in the Rabona expense tracker (React + Vite + Supabase,
deployed on Vercel from GitHub Betija34/expense-tracker). It generates the actual
printable invoice document and, on Save, writes an `issued` row to the `invoices`
table so it appears in the existing **Client Invoicing** tracker.

Files: `src/components/InvoiceBuilder/InvoiceBuilder.jsx` + `.css`; wired into
`src/App.jsx` as tab `issue-invoice`. DB migration `DATABASE_SCHEMA_V37_MIGRATION.sql`
(adds `invoices.covered_expense_periods JSONB`).

## Done and working (tested live by user)
- Invoice document on Rabona letterhead; header now matches her real invoice
  template exactly (RABONA HOLDINGS LTD, HE402420, 75 Spyrou Kyprianou Av.,
  1st floor Office 102, 4042 Limassol, Cyprus, VAT Reg.No.: 10402420X, T.I.C: 10402420X).
- Bigger logo (~2x).
- BILL TO: legal name, "Company number:", "VAT number:", "Address:" (no project line here).
- Description wording per type:
  - Monthly fee: "Services per Consultancy Service Agreement section 6.1 and Schedule 2, <Month> fee <Year>" + newline "Project <TRADE NAME>".
  - Fixed expenses reimbursement: "...section 6.2 (Reimbursement of Fixed Procure and Running Expenses) <Month> <Year>" + "Project <TRADE NAME>".
  - Variable expense: heading "...section 6.2 (Reimbursement of Procure and Running Expenses)" + one stacked line per expense report "Expenses as of <Month-end date> expense report", each with amount, summing to total.
  - Section (6.1/6.2) + Schedule (2/3/4) are DEFAULTS (6.1 / 2) for now — become per-client fields in the client-info phase.
- VAT: shown only when it applies (service types), as Subtotal -> VAT (x%) -> Total; never on reimbursements.
- Invoice number YYYY/MM/NNN: YYYY/MM locked to the TOP-BAR month; only the sequence NNN is editable. Prevents issuing a number outside the selected month.
- Date issued defaults to today, overridable.
- Monthly fee & fixed expenses: multi-month picker (auto-tick un-invoiced past months = catch-up; tick future months = advance). Each ticked month = its own invoice, all numbered under the top-bar month.
- Variable expense: report picker pulls the CLIENT REPORT totals (is_reimbursable expenses grouped by main_ref_year/main_ref_month), offers only un-invoiced, non-zero reports; respects deferrals (deferred hidden until target month arrives); already-invoiced detection uses covered_expense_periods (new) or the invoice's own period (older Client-Invoicing-tab invoices).
- One-off service (VAT per client), one-off reimbursement (no VAT), credit note (manual negative).
- Line items: Description full-width left, Amount hard right; "Amount" header right-aligned.
- Bank details block at the bottom (replaced the duplicated footer): Bank of Cyprus, Corporate Banking Centre Limassol 1, Corner G. Neofytou &, Georgiou Griva Digeni 121, Beneficiary RABONA HOLDINGS LTD, Account No 357032438089, IBAN CY76002001950000357032438089, SWIFT BCYPCY2N.
- Delete a mistaken invoice: via the Client Invoicing tab (set same company + month, click the trash icon). Advance invoices are filed under the month they cover.

## Deploy mechanics (IMPORTANT)
- Code deploys via Terminal only (git push -> Vercel auto-build). NOT Squarespace.
  Command: cd "$HOME/Documents/Claude/Projects/Rabona expense tracking sistem" && git add -A && git commit -m "..." && git push
- Supabase is only for DB migrations (run V37 SQL once in the SQL Editor).
- All code edits are done on the Mac via the device bridge; the cloud VM cannot run vite (esbuild arch mismatch), so verification = esbuild syntax check in the cloud, then user deploys and views on Vercel.

## OPEN — next
1. **Revisit the print/PDF view** — review the printout layout again (footer/bank block
   is pinned to the bottom via min-height calc(100vh-6mm)); confirm it prints correctly.
2. **Credit notes** — discuss and finalise how they should look/work (currently a manual
   negative one-off with generic wording).
3. ~~Confirm the last deploy went through~~ — DONE 2026-09-22: local `main` == `origin/main`,
   commit `71ee367` is pushed and live. Stale-looking UI = stale bundle, hard-refresh ⌘⇧R.
4. **Client information update (next big piece)** — load each project's real legal name,
   Reg No, VAT No and address into the clients table so BILL TO and the "Project <NAME>"
   line are correct for every project. Project stays DERIVED from the client picker (user's
   decision 2026-09-22) — it is not a separate field. See PARKED below, same work.

## DONE 2026-09-22 — unconfirmed fields shown in red
Screen-only working aid on the invoice document: **Invoice No**, **Date issued**, the
**BILL TO** block and the **Project/description** line render in red until each is
confirmed. Number and date arrive pre-filled (next free sequence / today) so each has a
"confirmed" tick beside its field; editing the field also counts as confirming it. The
project turns black by picking a client. An emptied sequence box does not count as
confirmed. Red **never prints** — the print block forces #1d1d1b. **Print and Save are
disabled while anything is still red**, and a line under the buttons names what is
outstanding. Files: `InvoiceBuilder.jsx` (numberApproved/dateTouched/dateApproved state,
`numberOk`/`dateOk`/`clientOk`/`allConfirmed`), `InvoiceBuilder.css` (`.ib-unconfirmed`,
`.ib-confirm`, `.ib-pending`). No financial logic, amounts, dates or stored data changed.

## PARKED — bigger phase after invoicing polish
**Client info + fee phases**: load each client's real Reg No / VAT / address and per-client
section + schedule wording into the app (clients table), and add a phased fee schedule so the
monthly-fee amount auto-matches the period. Right now those use defaults (section 6.1 / Schedule 2,
single current fee). Also: add missing projects (Thermalpark Residenza, §7.1 Retainer), Espargos issuer/bank details if it invoices.

## User preferences
- Prefers prose answers over the AskUserQuestion multiple-choice tool.
- Reimbursements NEVER carry VAT; VAT only on service (monthly fee + one-off service), per client's VAT rate (location-based).
