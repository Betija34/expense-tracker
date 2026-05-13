-- =====================================================================
-- V9 Migration — Add invoice_number column for incoming payments
-- =====================================================================
--
-- Background:
--   For INCOMING bank transactions (Client Payment, Client Reimbursement),
--   the user needs to record which client invoice the payment relates to.
--   The client only pays expenses listed on an invoice with an expense
--   report, so the invoice number is a critical part of the paper trail.
--
--   A single incoming row may correspond to multiple invoice numbers
--   (e.g. one wire payment that settles two client invoices of the same
--   category). The field is plain TEXT so the user can enter comma-
--   separated values when needed.
--
-- Behavior:
--   - Nullable (most expense rows — outgoing, intercompany, etc. — won't use it)
--   - TEXT type (free-form, no length cap on Postgres TEXT)
--   - Idempotent: re-running the migration is safe (IF NOT EXISTS guard)
--
-- How to run:
--   Open Supabase → SQL Editor → paste this script → click "Run".
--   Or use the matching Node script:
--     node scripts/migrate-v9-invoice-number.mjs
-- =====================================================================

BEGIN;

ALTER TABLE expenses
ADD COLUMN IF NOT EXISTS invoice_number TEXT;

COMMENT ON COLUMN expenses.invoice_number IS
  'For incoming payments (Client Payment / Client Reimbursement): the client '
  'invoice number(s) being paid by this transaction. Free-form text — '
  'comma-separated when one payment settles multiple invoices.';

COMMIT;

-- To verify:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'expenses' AND column_name = 'invoice_number';
