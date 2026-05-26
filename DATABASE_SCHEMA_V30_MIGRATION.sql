-- =====================================================================
-- V30: Per-client SOA description templates
-- ---------------------------------------------------------------------
-- The Statement of Account generator (Clients tab → 📋 SOA button per
-- client) renders one ledger row per invoice / payment / credit note.
-- Each row's DESCRIPTION column needs text that matches the client's
-- contract wording, e.g. for Urban City (EVIMER LTD):
--   "Services per Consultancy Service Agreement section 6.1 and
--    Schedule 2  MAY FEE  2026"
-- For another client the contract section might be 5.2, or "Schedule
-- 1B", so the description text is per-client, not global.
--
-- We add two template columns to the clients table — one for the
-- consultancy-fee description (monthly_fee + one_off_service), one
-- for the reimbursement description (fixed_expense + variable_expense
-- + one_off_reimbursement). The SOA generator substitutes the
-- placeholders {MONTH} / {YEAR} / {EXPENSE_PERIOD} at generation
-- time.
--
-- Inwards Transfer rows and Credit Note rows use built-in default
-- templates in the generator (they don't vary per client).
--
-- Safe to run multiple times (IF NOT EXISTS).
-- =====================================================================

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS soa_consultancy_template TEXT
    DEFAULT 'Services per Consultancy Service Agreement section 6.1 and Schedule 2  {MONTH} FEE  {YEAR}',
  ADD COLUMN IF NOT EXISTS soa_reimbursement_template TEXT
    DEFAULT 'Services per Consultancy Service Agreement section 6.2 (REIMBURSEMENT OF PROCURE AND RUNNING EXPENSES) Expenses as of {EXPENSE_PERIOD} expense report';

COMMENT ON COLUMN clients.soa_consultancy_template IS
  'SOA description template for monthly_fee + one_off_service invoices. Placeholders: {MONTH}, {YEAR}. Defaults match Urban City (section 6.1 / Schedule 2); override per client when the contract references different sections.';

COMMENT ON COLUMN clients.soa_reimbursement_template IS
  'SOA description template for fixed_expense + variable_expense + one_off_reimbursement invoices. Placeholders: {EXPENSE_PERIOD} (free-text describing which expense report(s) the reimbursement covers). Note: spelling corrected from historical "REIMBURSTMENT" to "REIMBURSEMENT" going forward, per user decision May 26 2026.';

COMMIT;

-- Reload PostgREST schema cache so the new columns are immediately
-- visible to the API without restarting Supabase.
NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'clients'
--      AND column_name LIKE 'soa_%'
--    ORDER BY column_name;
