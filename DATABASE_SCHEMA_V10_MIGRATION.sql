-- =====================================================================
-- V10 Migration — Add "Bank Transfer Fees" and "Other" subcategories
--                 under "Bank Charges and Interest"
-- =====================================================================
--
-- Background:
--   While entering real bank data, Betija identified two missing
--   subcategories under "Bank Charges and Interest":
--     * Bank Transfer Fees — fees charged by the bank for outgoing
--                            wire transfers / SEPA / local transfers.
--     * Other              — catch-all for any bank charge that doesn't
--                            fit one of the named buckets.
--
--   Existing subcategories (V2 seed) are:
--     10  Card Transaction Admin Fee
--     20  Total Interest
--     30  Cash Advance Transfer Fee
--     40  Card Membership Fee
--     50  Unexecuted Direct Debit Fee
--
--   New rows are appended after them at sort_order 60 and 70.
--
-- Behavior:
--   - ON CONFLICT (category_id, name) DO NOTHING — idempotent, safe
--     to re-run.
--   - Applies to BOTH companies (Rabona + Espargos) because
--     expense_subcategories is keyed by category_id only, not company.
--
-- How to run:
--   Open Supabase → SQL Editor → paste this script → click "Run".
-- =====================================================================

BEGIN;

DO $$
DECLARE
  cat_id UUID;
BEGIN
  SELECT id INTO cat_id
  FROM expense_categories
  WHERE name = 'Bank Charges and Interest';

  IF cat_id IS NULL THEN
    RAISE EXCEPTION 'Category "Bank Charges and Interest" not found — '
                    'has V2 seed been applied?';
  END IF;

  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Bank Transfer Fees', 60),
    (cat_id, 'Other',              70)
  ON CONFLICT (category_id, name) DO NOTHING;
END $$;

COMMIT;

-- To verify:
--   SELECT s.sort_order, s.name
--   FROM expense_subcategories s
--   JOIN expense_categories c ON c.id = s.category_id
--   WHERE c.name = 'Bank Charges and Interest'
--   ORDER BY s.sort_order;
--
-- Expected result (7 rows):
--   10  Card Transaction Admin Fee
--   20  Total Interest
--   30  Cash Advance Transfer Fee
--   40  Card Membership Fee
--   50  Unexecuted Direct Debit Fee
--   60  Bank Transfer Fees
--   70  Other
