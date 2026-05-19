-- =====================================================================
-- V16 Migration — Symmetric Espargos→Rabona "Payment on Behalf"
-- =====================================================================
--
-- Background:
--   V15 added the Rabona→Espargos direction:
--     Rabona side: "Transfers to Connected Accounts" / "Payment Made on Behalf of Espargos"
--     Espargos side: "Intercompany Funding"           / "From Rabona — Payment on Behalf"
--
--   The opposite direction occurs as well — Espargos's bank may pay a
--   vendor for an expense that actually belongs to Rabona. This
--   migration adds the symmetric subcategory pair so the auto-create
--   flow in FinalizeTransaction.jsx can fire in either direction.
--
--   New subcategories:
--     Under "Transfers to Connected Accounts" (out):
--       - "Transfers to Rabona"              (NEW — bank-to-bank case)
--       - "Payment Made on Behalf of Rabona" (NEW — auto-creates Rabona-side Intercompany Funding)
--
--     Under "Intercompany Funding" (in):
--       - "From Espargos — Direct Transfer"  (NEW — paired with "Transfers to Rabona")
--       - "From Espargos — Payment on Behalf" (NEW — paired with "Payment Made on Behalf of Rabona")
--
--   Both companies share the same expense_categories / expense_subcategories
--   tables, so the new subcategories will appear in the dropdown for both —
--   but the accountant picks the one that matches the row's company.
--
-- Idempotency:
--   All INSERTs use ON CONFLICT (category_id, name) DO NOTHING.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  transfers_cat_id UUID;
  funding_cat_id   UUID;
BEGIN
  -- ------------------------------------------------------------------
  -- Transfers to Connected Accounts (outgoing pair)
  -- ------------------------------------------------------------------
  SELECT id INTO transfers_cat_id
    FROM expense_categories
   WHERE name = 'Transfers to Connected Accounts';

  IF transfers_cat_id IS NULL THEN
    RAISE EXCEPTION 'Category "Transfers to Connected Accounts" not found — run V2 first.';
  END IF;

  INSERT INTO expense_subcategories (category_id, name, is_custom, sort_order) VALUES
    (transfers_cat_id, 'Transfers to Rabona',              FALSE, 30),
    (transfers_cat_id, 'Payment Made on Behalf of Rabona', FALSE, 35)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- ------------------------------------------------------------------
  -- Intercompany Funding (incoming pair)
  -- ------------------------------------------------------------------
  SELECT id INTO funding_cat_id
    FROM expense_categories
   WHERE name = 'Intercompany Funding';

  IF funding_cat_id IS NULL THEN
    RAISE EXCEPTION 'Category "Intercompany Funding" not found — run V2 first.';
  END IF;

  INSERT INTO expense_subcategories (category_id, name, is_custom, sort_order) VALUES
    (funding_cat_id, 'From Espargos — Direct Transfer',  FALSE, 30),
    (funding_cat_id, 'From Espargos — Payment on Behalf', FALSE, 40)
  ON CONFLICT (category_id, name) DO NOTHING;

  RAISE NOTICE 'V16 applied: symmetric Espargos→Rabona "Payment on Behalf" subcategories are now available.';
END $$;

COMMIT;

-- To verify:
--   SELECT ec.name AS category, es.name AS subcategory, es.sort_order
--     FROM expense_subcategories es
--     JOIN expense_categories ec ON ec.id = es.category_id
--    WHERE ec.name IN ('Transfers to Connected Accounts', 'Intercompany Funding')
--    ORDER BY ec.name, es.sort_order;
--
-- Expected (after V15 + V16):
--   Intercompany Funding            | From Rabona — Direct Transfer       | 10
--   Intercompany Funding            | From Rabona — Payment on Behalf     | 20
--   Intercompany Funding            | From Espargos — Direct Transfer     | 30
--   Intercompany Funding            | From Espargos — Payment on Behalf   | 40
--   Transfers to Connected Accounts | Transfers to Espargos               | 10
--   Transfers to Connected Accounts | Payment Made on Behalf of Espargos  | 15
--   Transfers to Connected Accounts | Other [Custom]                      | 20
--   Transfers to Connected Accounts | Transfers to Rabona                 | 30
--   Transfers to Connected Accounts | Payment Made on Behalf of Rabona    | 35
