-- =====================================================================
-- V23 Migration — Add 'pro_forma' to invoices.invoice_type CHECK
-- =====================================================================
--
-- Day 13 add-on: pro forma invoices are tracked in a separate block on
-- the Client Invoicing page. They use the same numbering format as
-- regular invoices (YYYY-MM-NNN) but a lighter lifecycle — no SOA, no
-- payment tracking. The reason: a pro forma isn't a tax document, so
-- it never enters the VIES/VAT report cycle. The matching REAL invoice
-- (issued once the pro forma is accepted) handles all that downstream.
--
-- We just need to widen the CHECK constraint to accept the new type;
-- the columns themselves (invoice_number, date_issued, email_sent_at,
-- amount_net, amount_total, vat_rate, etc.) already exist and work
-- for this use case.
--
-- Drop + recreate is the only way to alter a CHECK constraint in
-- Postgres. Safe because the new constraint is strictly a superset.
-- =====================================================================

BEGIN;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;

ALTER TABLE invoices ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN (
    'monthly_fee',
    'fixed_expense',
    'variable_expense',
    'one_off_service',
    'one_off_reimbursement',
    'credit_note',
    'pro_forma'
  ));

COMMENT ON COLUMN invoices.invoice_type IS
  'Drives which block the row renders in. monthly_fee + one_off_service + credit_note + pro_forma carry VAT; pass-through reimbursements do not. pro_forma uses a lighter lifecycle (no payment tracking).';

-- Force PostgREST to reload its schema cache so the new enum value
-- propagates without a manual cache reload from the Supabase dashboard.
NOTIFY pgrst, 'reload schema';

COMMIT;
