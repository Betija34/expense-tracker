-- =====================================================================
-- V40 Migration — client_fee_phases.invoice_wording
-- ---------------------------------------------------------------------
-- Optional invoice line wording per fee phase, taken from the agreement
-- (e.g. a phase billed under "section 6.2 and Schedule 3"). When set, the
-- Issue Invoice tab uses it for every monthly-fee invoice of a month that
-- falls in that phase, instead of the client-level wording.
-- Placeholders: {MONTH} {YEAR} {PROJECT} {PHASE} {AMOUNT} {FROM} {TO}.
-- Requires V38. Additive only; safe to re-run.
-- =====================================================================

BEGIN;

ALTER TABLE client_fee_phases
  ADD COLUMN IF NOT EXISTS invoice_wording TEXT;

COMMENT ON COLUMN client_fee_phases.invoice_wording IS
  'Optional monthly-fee invoice wording for months in this phase. Placeholders {MONTH} {YEAR} {PROJECT} {PHASE} {AMOUNT} {FROM} {TO}. Blank = client-level wording.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'client_fee_phases' AND column_name = 'invoice_wording';
