-- =====================================================================
-- V42 Migration — expense_deferrals: remember the FIRST target month
-- ---------------------------------------------------------------------
-- A deferred amount (e.g. September → October) can now be MOVED ON from
-- the month it landed in (October → November) when it can't be invoiced
-- there either. The September month stays closed and untouched; only the
-- deferral's target_year/target_month change.
--
-- These two columns keep the month it was first deferred to, for the
-- audit trail ("first deferred to October"). They are set once, on the
-- first move, and never overwritten. NULL = never moved.
-- Additive only; safe to re-run. The app works without them (the move
-- still happens, just without the audit note).
-- =====================================================================

BEGIN;

ALTER TABLE expense_deferrals
  ADD COLUMN IF NOT EXISTS original_target_year  INT,
  ADD COLUMN IF NOT EXISTS original_target_month INT
    CHECK (original_target_month IS NULL OR original_target_month BETWEEN 1 AND 12);

COMMENT ON COLUMN expense_deferrals.original_target_year IS
  'Year of the month this amount was FIRST deferred to, before being moved on. NULL = never moved.';
COMMENT ON COLUMN expense_deferrals.original_target_month IS
  'Month (1-12) this amount was FIRST deferred to, before being moved on. NULL = never moved.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'expense_deferrals' AND column_name LIKE 'original_target%';
