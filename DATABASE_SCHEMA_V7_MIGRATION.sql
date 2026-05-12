-- =============================================================
-- DATABASE_SCHEMA_V7_MIGRATION.sql
-- =============================================================
-- Purpose: Add "Uncategorized" categories used by the Bank Parser's
-- new Bulk Approve workflow.
--
-- When the user verifies that a batch of imported bank transactions
-- has correct date/amount/vendor/account (without yet wanting to
-- assign categories), Bulk Approve creates expenses tagged with the
-- "Uncategorized" category. The user then categorizes each one later
-- using the ↻ Re-categorize button.
--
-- We need both directions because bank txs can be incoming or outgoing,
-- and our category lookup is filtered by direction.
--
-- Safe to re-run.
-- =============================================================

BEGIN;

INSERT INTO expense_categories (
  name, direction, sub_ref_series, sub_ref_manual,
  needs_linking, needs_shareholder_tag, sort_order, is_active
) VALUES
  ('Uncategorized',      'out', NULL, FALSE, FALSE, FALSE, 999, TRUE),
  ('Uncategorized (in)', 'in',  NULL, FALSE, FALSE, FALSE, 998, TRUE)
ON CONFLICT (name) DO UPDATE SET
  is_active  = TRUE,
  direction  = EXCLUDED.direction,
  sort_order = EXCLUDED.sort_order;

COMMENT ON TABLE expense_categories IS
  'Expense categories. The "Uncategorized" entries are placeholders used by Bank Parser bulk-approve — expenses tagged with these should be re-categorized via the ↻ Re-categorize button.';

COMMIT;
