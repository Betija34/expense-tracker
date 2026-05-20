-- =====================================================================
-- V17 Migration — additional_sub_refs for multi-payee payroll transfers
-- =====================================================================
--
-- Background:
--   For series S (Cost of Labor / payroll), a single outgoing bank
--   transfer may bundle payments for several payees. Until now each
--   payee had to be entered as a separate expense, or split into
--   portions. The user wants to keep the bank-transaction ↔ expense
--   relationship 1:1 while still capturing every payee's distinct
--   sub-reference (e.g. one transfer covers S3/4 AND S3/5; one
--   year-end transfer covers S12/1 AND S1/1).
--
--   This migration adds a TEXT column that stores extra sub-refs as a
--   comma-separated list of structured tokens. The PRIMARY sub-ref
--   stays in the existing columns (sub_ref_series, sub_ref_month,
--   sub_ref_seq); the secondary/tertiary/etc. live here.
--
-- Token format:
--   "<series><month>/<seq>"   one canonical token per sub-ref
--   Examples:
--     "S3/5"            single additional sub-ref
--     "S3/5,S3/6"       two additional sub-refs in same month
--     "S12/1,S1/1"      additional sub-refs across two months
--
-- Why TEXT and not a side table?
--   Mirrors the existing pattern used for invoice_number (multi-invoice
--   client payments) and expected_travel_month (multi-month prepaid
--   travel). Keeps reads simple — one row per expense, all sub-refs
--   visible without a join. Uniqueness across primary + additional
--   sub-refs is enforced in app code at save time (see
--   validateSubRefUniqueness in FinalizeTransaction.jsx).
--
-- Idempotency:
--   ADD COLUMN IF NOT EXISTS — safe to re-run.
-- =====================================================================

BEGIN;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS additional_sub_refs TEXT;

COMMENT ON COLUMN expenses.additional_sub_refs IS
  'Optional comma-separated list of extra sub-reference tokens of the '
  'form "<series><month>/<seq>" (e.g. "S3/5,S3/6") for the rare case '
  'where one bank transfer covers multiple payees of the same series. '
  'The PRIMARY sub-ref still lives in sub_ref_series/sub_ref_month/'
  'sub_ref_seq. Uniqueness across primary + additional is enforced in '
  'application code at save time. Currently used for series S (Cost '
  'of Labor / payroll); other series can adopt the pattern later.';

COMMIT;

-- To verify:
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'expenses'
--      AND column_name = 'additional_sub_refs';
-- Expected: text, YES.
