-- =====================================================================
-- V25 Migration — expense_deferrals: type-aware (monthly_fee + variable_expense)
-- =====================================================================
--
-- Day 13 add-on: extend the rollover/defer concept beyond just variable
-- expense reimbursements. Monthly fee invoices sometimes get issued one
-- or two months late (a Jan fee billed in March, etc.) — the user wants
-- the same → Defer / ↩ Undo flow available on Block 1 rows too.
--
-- Adds an invoice_type column (default 'variable_expense' so existing
-- rows continue to work as-is). The unique constraint + lookup index
-- now include invoice_type, so a single (client, source_period) can
-- have TWO deferrals — one for the monthly fee, one for the variable
-- expense reimbursement — without colliding.
--
-- Allowed values are constrained to types where deferral makes sense:
-- monthly_fee + variable_expense for now. fixed_expense could be added
-- later if needed; one-offs / credit notes / pro formas wouldn't make
-- sense (those don't have a natural "next month's invoice" to roll into).
-- =====================================================================

BEGIN;

-- 1. Add the column with a sensible default so existing rows are
--    interpreted as variable_expense deferrals (which is what they
--    were when V24 created this table).
ALTER TABLE expense_deferrals
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'variable_expense';

-- 2. Constrain it to known types.
ALTER TABLE expense_deferrals
  DROP CONSTRAINT IF EXISTS expense_deferrals_invoice_type_check;
ALTER TABLE expense_deferrals
  ADD CONSTRAINT expense_deferrals_invoice_type_check
  CHECK (invoice_type IN ('variable_expense', 'monthly_fee'));

-- 3. Replace the old uniqueness so a client can have BOTH a
--    variable_expense AND a monthly_fee deferral from the same source
--    period without colliding.
ALTER TABLE expense_deferrals
  DROP CONSTRAINT IF EXISTS uniq_deferral_source;
ALTER TABLE expense_deferrals
  ADD CONSTRAINT uniq_deferral_source
  UNIQUE (company_id, client_id, source_year, source_month, invoice_type);

-- 4. Replace the target-lookup index so it includes the type. This
--    matters for the "what defers INTO this period" query the UI runs
--    on every period change.
DROP INDEX IF EXISTS idx_deferrals_target;
CREATE INDEX IF NOT EXISTS idx_deferrals_target
  ON expense_deferrals (company_id, client_id, target_year, target_month, invoice_type);

COMMENT ON COLUMN expense_deferrals.invoice_type IS
  'Which kind of recurring billing this deferral routes forward. Either monthly_fee (fixed retainer) or variable_expense (reimbursable expenses for the period).';

NOTIFY pgrst, 'reload schema';

COMMIT;
