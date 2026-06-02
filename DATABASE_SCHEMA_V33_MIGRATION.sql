-- ============================================================
-- Rabona Expense Tracker - Schema Migration V33
-- Rename "Annual Government Compliance Fees" → "Tax"
-- Add 4 subcategories: VAT, VIES, Annual government compliance fees, Other
--
-- Why: the original category was too narrow. Cyprus accounting work
-- needs a broader Tax bucket that covers VAT returns, VIES filings,
-- the annual compliance fee, and miscellaneous tax-adjacent items.
--
-- Renaming preserves the category UUID, so every expense currently
-- linked to "Annual Government Compliance Fees" stays linked. After
-- the rename those expenses show as "Tax / (no subcategory)" until
-- the user tags them with a specific subcategory.
--
-- Safe: idempotent. The UPDATE is a no-op if already renamed; the
-- INSERTs use ON CONFLICT DO NOTHING.
-- Applies globally (expense_categories has no company_id).
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1. Rename the category (UUID preserved → existing expenses stay linked)
UPDATE expense_categories
   SET name        = 'Tax',
       description = 'VAT, VIES, annual government compliance fees, and other tax-related expenses'
 WHERE name = 'Annual Government Compliance Fees';

-- 2. Add the four subcategories under it
DO $$
DECLARE
  cat_id UUID;
BEGIN
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Tax';
  IF cat_id IS NULL THEN
    RAISE EXCEPTION 'V33: expected a "Tax" category after rename — found none';
  END IF;

  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'VAT',                                10),
    (cat_id, 'VIES',                               20),
    (cat_id, 'Annual government compliance fees',  30),
    (cat_id, 'Other',                              40)
  ON CONFLICT (category_id, name) DO NOTHING;
END $$;
