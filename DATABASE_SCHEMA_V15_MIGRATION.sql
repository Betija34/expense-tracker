-- =====================================================================
-- V15 Migration — "Payment Made on Behalf" subcategories
-- =====================================================================
--
-- Background:
--   When Rabona pays a vendor directly for an expense that actually
--   belongs to Espargos (e.g. Rabona Current Account pays an EAC bill
--   that's Espargos's electricity), there is no bank credit on
--   Espargos's side to import later. We model this as an inter-company
--   funding event: Rabona records a "Transfers to Connected Accounts"
--   outgoing, and a matching "Intercompany Funding" incoming is created
--   on Espargos (notional — no real cash arrives at Espargos's bank).
--
--   To distinguish this case from a real bank-to-bank transfer (where
--   Espargos's bank statement WILL show the credit and the user links
--   manually via the 🔗 button), we introduce a new SUBCATEGORY pair:
--
--     Rabona side  (out)  "Transfers to Connected Accounts" subcategories:
--       - "Transfers to Espargos"             (existing — renamed from "Espargos")
--       - "Payment Made on Behalf of Espargos"  (NEW)
--
--     Espargos side (in)  "Intercompany Funding" subcategories (was: none):
--       - "From Rabona — Direct Transfer"     (NEW — paired with "Transfers to Espargos")
--       - "From Rabona — Payment on Behalf"   (NEW — paired with "Payment Made on Behalf of Espargos")
--
--   The pairing is enforced by the auto-create logic in
--   FinalizeTransaction.jsx: when the user saves a Rabona expense with
--   subcategory "Payment Made on Behalf of Espargos", the matching
--   Espargos row is created automatically with the right subcategory
--   and bidirectionally linked via expenses.linked_expense_id.
--
-- Idempotency:
--   This migration is safe to re-run. The UPDATE matches by old name;
--   if it has already been run, no rows match and it is a no-op. The
--   INSERTs all use ON CONFLICT (category_id, name) DO NOTHING.
--
-- How to run:
--   Open Supabase → SQL Editor → +New query → paste this script →
--   click "Run".
-- =====================================================================

BEGIN;

DO $$
DECLARE
  transfers_cat_id UUID;
  funding_cat_id   UUID;
BEGIN
  -- ------------------------------------------------------------------
  -- Rabona side: Transfers to Connected Accounts
  -- ------------------------------------------------------------------
  SELECT id INTO transfers_cat_id
    FROM expense_categories
   WHERE name = 'Transfers to Connected Accounts';

  IF transfers_cat_id IS NULL THEN
    RAISE EXCEPTION 'Category "Transfers to Connected Accounts" not found — run V2 first.';
  END IF;

  -- 1. Rename the existing 'Espargos' subcategory to 'Transfers to Espargos'.
  --    The subcategory_id stays the same, so no historical rows are touched.
  --    If the row has already been renamed (re-run), this UPDATE matches 0 rows.
  UPDATE expense_subcategories
     SET name = 'Transfers to Espargos'
   WHERE category_id = transfers_cat_id
     AND name = 'Espargos';

  -- 2. Add the new "Payment Made on Behalf of Espargos" subcategory.
  --    sort_order 15 places it between Transfers to Espargos (10) and Other [Custom] (20).
  INSERT INTO expense_subcategories (category_id, name, is_custom, sort_order)
       VALUES (transfers_cat_id, 'Payment Made on Behalf of Espargos', FALSE, 15)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- ------------------------------------------------------------------
  -- Espargos side: Intercompany Funding (was: no subcategories)
  -- ------------------------------------------------------------------
  SELECT id INTO funding_cat_id
    FROM expense_categories
   WHERE name = 'Intercompany Funding';

  IF funding_cat_id IS NULL THEN
    RAISE EXCEPTION 'Category "Intercompany Funding" not found — run V2 first.';
  END IF;

  INSERT INTO expense_subcategories (category_id, name, is_custom, sort_order) VALUES
    (funding_cat_id, 'From Rabona — Direct Transfer',   FALSE, 10),
    (funding_cat_id, 'From Rabona — Payment on Behalf', FALSE, 20)
  ON CONFLICT (category_id, name) DO NOTHING;

  RAISE NOTICE 'V15 applied: Transfers to Connected Accounts now has "Payment Made on Behalf of Espargos"; Intercompany Funding now has direct/on-behalf subcategories.';
END $$;

COMMIT;

-- To verify:
--   SELECT ec.name AS category, es.name AS subcategory, es.sort_order
--     FROM expense_subcategories es
--     JOIN expense_categories ec ON ec.id = es.category_id
--    WHERE ec.name IN ('Transfers to Connected Accounts', 'Intercompany Funding')
--    ORDER BY ec.name, es.sort_order;
--
-- Expected:
--   Intercompany Funding            | From Rabona — Direct Transfer      | 10
--   Intercompany Funding            | From Rabona — Payment on Behalf    | 20
--   Transfers to Connected Accounts | Transfers to Espargos              | 10
--   Transfers to Connected Accounts | Payment Made on Behalf of Espargos | 15
--   Transfers to Connected Accounts | Other [Custom]                     | 20
