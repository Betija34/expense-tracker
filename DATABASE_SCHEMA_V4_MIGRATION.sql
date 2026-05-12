-- =============================================================
-- DATABASE_SCHEMA_V4_MIGRATION.sql
-- =============================================================
-- Purpose: Allow expenses.account_id to be NULL so that manual
-- cash entries (from the Add Expense tab) can be stored without
-- being tied to a bank account row.
--
-- Cash convention (locked May 12, 2026):
--   account_id IS NULL  →  the expense is a cash payment
--   account_id refers to an accounts row → bank-paid (RCC, RMC, ...)
--
-- View Expenses already renders the Cash badge and light-blue row
-- tint for rows where the joined accounts row is null, so the app
-- side is already consistent with this convention.
--
-- Safe to re-run.
-- =============================================================

BEGIN;

ALTER TABLE expenses
  ALTER COLUMN account_id DROP NOT NULL;

-- Optional: a small comment for any future schema reader
COMMENT ON COLUMN expenses.account_id IS
  'Bank account this expense was paid from. NULL means the expense was paid in cash (manual Add Expense entry).';

COMMIT;
