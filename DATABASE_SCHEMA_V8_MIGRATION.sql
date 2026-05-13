-- =====================================================================
-- V8 Migration — Prefix Espargos main references with "E"
-- =====================================================================
--
-- Background:
--   All companies share the same expenses table and use the same reference
--   format "YY/M/seq" (e.g. "26/1/4"). To visually distinguish Espargos
--   expenses from Rabona Holdings expenses, Espargos refs are now prefixed
--   with a capital "E" → "E26/1/4".
--
-- What this script does:
--   Updates every existing expense row belonging to the "Espargos" company
--   that doesn't already have an "E" prefix on its reference_number, and
--   prepends "E". Rabona Holdings rows are left untouched.
--
-- Safety:
--   - Idempotent: the WHERE clause `reference_number NOT LIKE 'E%'` ensures
--     re-running this script does nothing on already-migrated rows.
--   - The underlying columns main_ref_year, main_ref_month, main_ref_seq
--     are unchanged. Only the denormalized display string is updated.
--   - Wrapped in a transaction; nothing commits if any row fails.
--
-- How to run:
--   Open Supabase → SQL Editor → paste this script → click "Run".
--   Then refresh the app — Espargos expenses should now show with "E" prefix.
-- =====================================================================

BEGIN;

UPDATE expenses
SET reference_number = 'E' || reference_number
WHERE company_id = (SELECT id FROM companies WHERE name = 'Espargos')
  AND reference_number IS NOT NULL
  AND reference_number NOT LIKE 'E%';

-- Verify by running this AFTER the UPDATE:
--   SELECT reference_number, main_ref_year, main_ref_month, main_ref_seq
--   FROM expenses
--   WHERE company_id = (SELECT id FROM companies WHERE name = 'Espargos')
--   ORDER BY main_ref_year, main_ref_month, main_ref_seq;
-- Every row should now start with "E".

COMMIT;
