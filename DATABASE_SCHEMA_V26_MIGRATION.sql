-- =====================================================================
-- V26 Migration — expense_deferrals.invoice_type: allow 'fixed_expense'
-- =====================================================================
--
-- Day 13 follow-up: extend the deferral feature to Block 3 (Fixed Monthly
-- Expense Reimbursement). Same exact pattern as monthly_fee — sometimes
-- the user doesn't issue the fixed expense reimbursement invoice this
-- month and wants to bundle it into a later month's invoice.
--
-- Only touches the CHECK constraint that lists allowed invoice_type
-- values. Nothing else changes — the unique constraint and lookup index
-- from V25 already include invoice_type as a discriminator, so a client
-- can independently defer their monthly_fee, fixed_expense, AND
-- variable_expense from the same source period without colliding.
-- =====================================================================

BEGIN;

ALTER TABLE expense_deferrals
  DROP CONSTRAINT IF EXISTS expense_deferrals_invoice_type_check;

ALTER TABLE expense_deferrals
  ADD CONSTRAINT expense_deferrals_invoice_type_check
  CHECK (invoice_type IN ('variable_expense', 'monthly_fee', 'fixed_expense'));

COMMENT ON COLUMN expense_deferrals.invoice_type IS
  'Which kind of recurring billing this deferral routes forward: monthly_fee (fixed retainer), fixed_expense (recurring fixed reimbursement), or variable_expense (variable reimbursable expenses for the period).';

NOTIFY pgrst, 'reload schema';

COMMIT;
