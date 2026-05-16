-- =====================================================================
-- V14 Migration — Allow multiple expected travel months
-- =====================================================================
--
-- Background:
--   V13 introduced `expected_travel_month` as a single DATE column. In
--   practice, a single payment can cover multiple future months (e.g.
--   accommodation deposit covering both January AND February 2027).
--   Since this field is display-only (a badge — never a routing key),
--   we widen it to TEXT and store a comma-separated list of YYYY-MM
--   values, mirroring the convention used for `invoice_number`.
--
-- Examples (after migration):
--   NULL                    — no future-trip note
--   "2026-08"               — single month: August 2026
--   "2027-01,2027-02"       — two months: January 2027 + February 2027
--
-- Behavior:
--   - If the column is still DATE (from V13), convert it to TEXT and
--     map existing values from 'YYYY-MM-01' (DATE) to 'YYYY-MM' (TEXT)
--     via TO_CHAR.
--   - If the column is ALREADY TEXT (re-run of this migration, or it
--     was created TEXT elsewhere), do nothing — idempotent.
--   - NULL stays NULL.
--
-- How to run:
--   Open Supabase → SQL Editor → +New query → paste this script →
--   click "Run".
-- =====================================================================

BEGIN;

DO $$
DECLARE
  current_type TEXT;
BEGIN
  SELECT data_type
    INTO current_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'expenses'
     AND column_name  = 'expected_travel_month';

  IF current_type IS NULL THEN
    RAISE EXCEPTION
      'Column expenses.expected_travel_month does not exist. Run V13 first.';
  ELSIF current_type = 'date' THEN
    EXECUTE $sql$
      ALTER TABLE expenses
        ALTER COLUMN expected_travel_month TYPE TEXT
        USING CASE
          WHEN expected_travel_month IS NULL THEN NULL
          ELSE TO_CHAR(expected_travel_month, 'YYYY-MM')
        END
    $sql$;
    RAISE NOTICE 'Converted expected_travel_month from DATE to TEXT.';
  ELSIF current_type = 'text' THEN
    RAISE NOTICE 'expected_travel_month is already TEXT — no change needed.';
  ELSE
    RAISE EXCEPTION
      'Unexpected data type % for expenses.expected_travel_month', current_type;
  END IF;
END $$;

COMMENT ON COLUMN expenses.expected_travel_month IS
  'Optional comma-separated list of YYYY-MM strings noting which future '
  'trip month(s) this payment is for. Display-only badge — does not '
  'route the expense to a different month''s Travel Log. '
  'Example: "2027-01,2027-02" = "January 2027, February 2027".';

COMMIT;

-- To verify:
--   SELECT data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'expenses' AND column_name = 'expected_travel_month';
-- Expected: data_type = 'text', is_nullable = 'YES'.
