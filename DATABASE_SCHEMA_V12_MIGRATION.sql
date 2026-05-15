-- =====================================================================
-- V12 Migration — Add "Car Insurance" subcategory under
--                 "Transportation Expenses"
-- =====================================================================
--
-- Background:
--   Espargos pays monthly car insurance via direct bank debit on the
--   same vehicle that has the car loan (V11). Insurance is an
--   operating expense — not a loan repayment — so it sits under
--   "Transportation Expenses" alongside the existing vehicle-related
--   subcategories (Fuel, Car Park).
--
--   Existing "Transportation Expenses" subcategories (V2 seed):
--     10  Taxi
--     20  Fuel
--     30  Car Park
--     40  Other
--
--   "Car Insurance" is inserted at sort_order 35 so it sits between
--   Car Park and the catch-all "Other".
--
-- Behavior:
--   - Shared between Rabona and Espargos at the DB level (only
--     Espargos uses it today; Rabona will see it in the dropdown
--     but ignore it).
--   - Idempotent: ON CONFLICT (category_id, name) DO NOTHING.
--
-- How to run:
--   Open Supabase → SQL Editor → +New Query → paste this script →
--   click "Run".
-- =====================================================================

BEGIN;

DO $$
DECLARE
  cat_id UUID;
BEGIN
  SELECT id INTO cat_id
  FROM expense_categories
  WHERE name = 'Transportation Expenses';

  IF cat_id IS NULL THEN
    RAISE EXCEPTION 'Category "Transportation Expenses" not found — '
                    'has V2 seed been applied?';
  END IF;

  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Car Insurance', 35)
  ON CONFLICT (category_id, name) DO NOTHING;
END $$;

COMMIT;

-- To verify:
--   SELECT s.sort_order, s.name
--   FROM expense_subcategories s
--   JOIN expense_categories c ON c.id = s.category_id
--   WHERE c.name = 'Transportation Expenses'
--   ORDER BY s.sort_order;
--
-- Expected result (5 rows):
--   10  Taxi
--   20  Fuel
--   30  Car Park
--   35  Car Insurance
--   40  Other
