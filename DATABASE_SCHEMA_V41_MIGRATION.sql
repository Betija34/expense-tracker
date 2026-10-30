-- =====================================================================
-- V41 Migration — project freeze (clients.frozen_from / frozen_until)
-- ---------------------------------------------------------------------
-- A project can be FROZEN for a period while its contract stays valid.
-- For every month inside the freeze nothing is billed: no monthly fee,
-- no fixed expense reimbursement, no variable expense reimbursement.
-- Months before the freeze are untouched.
--
-- Both columns hold the FIRST day of a month. frozen_until is inclusive
-- and optional (NULL = frozen until further notice).
-- Different from `active`, which archives a project for all months.
-- Additive only; safe to re-run.
-- =====================================================================

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS frozen_from  DATE,
  ADD COLUMN IF NOT EXISTS frozen_until DATE,
  ADD COLUMN IF NOT EXISTS frozen_note  TEXT;

COMMENT ON COLUMN clients.frozen_from IS
  'First month (YYYY-MM-01) of a project freeze. Nothing is billed for months in the freeze. NULL = not frozen.';
COMMENT ON COLUMN clients.frozen_until IS
  'Last frozen month (YYYY-MM-01), inclusive. NULL = frozen until further notice.';
COMMENT ON COLUMN clients.frozen_note IS
  'Optional reason / reference for the freeze (e.g. client email of dd/mm/yyyy).';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'clients' AND column_name LIKE 'frozen%';
