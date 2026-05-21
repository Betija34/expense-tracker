-- =====================================================================
-- V20 Migration — clients.monthly_fixed_expense_net
-- =====================================================================
--
-- Adds a second auto-drafted recurring amount per client. Some clients
-- (e.g. BTS Real estate / Blue Lagoon) have a fixed monthly expense
-- reimbursement built into the agreement (€1,200/month, every month,
-- regardless of actual expenses). This is DIFFERENT from variable
-- expense reimbursements (which sum the actual reimbursable expenses
-- for a chosen period and are issued only when the user decides).
--
-- When Step 2 (invoicing) ships, each active client will auto-draft up
-- to TWO recurring invoices per month:
--   1. Monthly fee invoice (uses monthly_fee_net + vat_rate)
--   2. Fixed expense reimbursement invoice (uses monthly_fixed_expense_net
--      + vat_rate) — only if monthly_fixed_expense_net > 0
--
-- Variable expense reimbursement invoices (combining actual expenses
-- across one or more months) remain MANUAL — the user picks the client,
-- the months, the expenses to bundle, and issues on demand.
--
-- Also retro-fills BTS Real estate SM SA with €1,200 to match the
-- user's handwritten checklist. Other clients stay at 0 (their
-- reimbursements are variable, no fixed monthly amount).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + UPDATE only fires when
-- monthly_fixed_expense_net is still 0 / NULL on that row.
-- =====================================================================

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS monthly_fixed_expense_net DECIMAL(12, 2) DEFAULT 0;

COMMENT ON COLUMN clients.monthly_fixed_expense_net IS
  'Fixed monthly expense reimbursement amount (BEFORE VAT) per the '
  'client agreement. If > 0, Step 2 invoicing auto-drafts a second '
  'recurring invoice each month for this amount. 0 = no fixed amount, '
  'reimbursements (if any) are variable and invoiced manually on demand.';

-- Retro-fill BTS Real estate SM SA (Blue Lagoon) per the user's PDF.
-- Only update if the value is still the default 0 (preserves any later edits).
UPDATE clients
   SET monthly_fixed_expense_net = 1200.00,
       updated_at = NOW()
 WHERE legal_name = 'BTS Real estate SM SA'
   AND trade_name = 'Blue Lagoon'
   AND COALESCE(monthly_fixed_expense_net, 0) = 0;

COMMIT;

-- To verify:
--   SELECT trade_name, monthly_fee_net, monthly_fixed_expense_net, vat_rate
--     FROM clients
--    WHERE company_id = (SELECT id FROM companies WHERE name = 'Rabona Holdings')
--    ORDER BY trade_name;
-- Expected: Blue Lagoon now shows monthly_fixed_expense_net = 1200.00;
-- all other Rabona clients show 0.
