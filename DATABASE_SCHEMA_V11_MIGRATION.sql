-- =====================================================================
-- V11 Migration — Add "Loan Repayments" category with car loan
--                 subcategories (Principal + Interest)
-- =====================================================================
--
-- Background:
--   Espargos has a car loan with monthly repayments. The original
--   category seed (V2) didn't include a loan category at all.
--
--   Proper accounting splits each repayment into:
--     * Principal — reduces the loan liability (balance sheet item,
--                   not technically a P&L expense, but tracked here
--                   for cash-flow visibility).
--     * Interest  — actual P&L expense.
--
--   A new top-level category "Loan Repayments" is created so future
--   loans (office equipment, etc., for either company) can be added
--   under it without crowding "Bank Charges and Interest" or other
--   operating categories.
--
-- Behavior:
--   - Shared between Rabona and Espargos at the DB level (the schema
--     has no per-company category scope). Rabona simply won't pick
--     it. Frontend filter can be added later if needed.
--   - sort_order 85 places it between "Annual Government Compliance
--     Fees" (80) and "Transfers to Connected Accounts" (90).
--   - Idempotent: ON CONFLICT clauses make re-runs safe.
--
-- How to run:
--   Open Supabase → SQL Editor → paste this script → click "Run".
-- =====================================================================

BEGIN;

-- 1. Insert (or upsert) the top-level category "Loan Repayments"
INSERT INTO expense_categories (
  name,
  direction,
  sub_ref_series,
  sub_ref_manual,
  needs_linking,
  needs_shareholder_tag,
  sort_order,
  is_active
) VALUES (
  'Loan Repayments',
  'out',
  NULL,
  FALSE,
  FALSE,
  FALSE,
  85,
  TRUE
)
ON CONFLICT (name) DO UPDATE SET
  direction              = EXCLUDED.direction,
  sub_ref_series         = EXCLUDED.sub_ref_series,
  sub_ref_manual         = EXCLUDED.sub_ref_manual,
  needs_linking          = EXCLUDED.needs_linking,
  needs_shareholder_tag  = EXCLUDED.needs_shareholder_tag,
  sort_order             = EXCLUDED.sort_order,
  is_active              = TRUE;

-- 2. Insert subcategories under "Loan Repayments"
DO $$
DECLARE
  cat_id UUID;
BEGIN
  SELECT id INTO cat_id
  FROM expense_categories
  WHERE name = 'Loan Repayments';

  IF cat_id IS NULL THEN
    RAISE EXCEPTION 'Category "Loan Repayments" not found after insert';
  END IF;

  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Car Loan – Principal', 10),
    (cat_id, 'Car Loan – Interest',  20)
  ON CONFLICT (category_id, name) DO NOTHING;
END $$;

COMMIT;

-- To verify:
--   SELECT c.name AS category, s.sort_order, s.name AS subcategory
--   FROM expense_subcategories s
--   JOIN expense_categories c ON c.id = s.category_id
--   WHERE c.name = 'Loan Repayments'
--   ORDER BY s.sort_order;
--
-- Expected result (2 rows):
--   Loan Repayments | 10 | Car Loan – Principal
--   Loan Repayments | 20 | Car Loan – Interest
