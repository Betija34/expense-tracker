-- =====================================================================
-- V13 Migration — Add invoice_date + expected_travel_month columns
-- =====================================================================
--
-- Background:
--   Two new optional fields on `expenses` to solve real-world travel
--   accounting cases that the bank-settlement date can't handle alone:
--
--   1. invoice_date — the ACTUAL transaction date (e.g., the date the
--      card was swiped). When set, travel-period matching uses this
--      instead of the payment/settlement date. Solves: card swiped
--      Mar 11 in Athens, bank posts Mar 13 → enter invoice_date =
--      2026-03-11 → matches the Mar 10–12 Athens trip.
--
--   2. expected_travel_month — the MONTH the trip happens, stored as
--      the 1st of that month (DATE type). When set, the expense shows
--      up in that month's Travel Log instead of the payment-month log.
--      Solves: flight paid Jan 2026 for May 2026 trip → enter
--      expected_travel_month = 2026-05-01 → appears in May's Travel Log
--      under whichever shareholder is tagged.
--
-- Behavior:
--   - Both columns are nullable. NULL = no override (current behavior).
--   - Idempotent: re-running is safe (IF NOT EXISTS guards).
--
-- How to run:
--   Open Supabase → SQL Editor → +New query → paste this script →
--   click "Run".
-- =====================================================================

BEGIN;

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS invoice_date DATE;

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS expected_travel_month DATE;

COMMENT ON COLUMN expenses.invoice_date IS
  'Optional override of expense.date for period-matching. Use when the '
  'bank settlement/posting date differs from the actual transaction date.';

COMMENT ON COLUMN expenses.expected_travel_month IS
  'Optional first-day-of-month date for travel expenses paid in advance. '
  'When set, the expense surfaces in the Travel Log of that month instead '
  'of (or in addition to) the payment month. Stored as 1st of month '
  '(e.g., 2026-05-01 means May 2026).';

COMMIT;

-- To verify:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'expenses'
--     AND column_name IN ('invoice_date', 'expected_travel_month');
--
-- Expected (2 rows): both DATE, both YES (nullable).
