-- =====================================================================
-- V37 Migration — invoices.covered_expense_periods
-- ---------------------------------------------------------------------
-- The Issue Invoice tab's variable-expense flow bundles one or more
-- monthly expense reports into a single invoice (each "Expenses as of
-- <month-end> expense report" line). To know which reports have already
-- been invoiced — so they are not offered again next time — we record
-- the covered source periods on the invoice row.
--
-- Shape: a JSON array, e.g.
--   [{"year":2026,"month":6,"amount":812.40},
--    {"year":2026,"month":7,"amount":540.00}]
--
-- Only variable-expense invoices populate it; everything else leaves it
-- NULL. Safe to run multiple times (IF NOT EXISTS).
-- =====================================================================

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS covered_expense_periods JSONB;

COMMENT ON COLUMN invoices.covered_expense_periods IS
  'Variable-expense invoices only: JSON array of the monthly expense reports this invoice covers, e.g. [{"year":2026,"month":6,"amount":812.40}]. Used to detect which reports are already invoiced. NULL for all other invoice types.';

COMMIT;

-- Reload PostgREST schema cache so the new column is usable immediately.
NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'invoices' AND column_name = 'covered_expense_periods';
