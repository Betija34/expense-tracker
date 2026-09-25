-- =====================================================================
-- V38 Migration — client fee phases + invoice header/wording fields
-- ---------------------------------------------------------------------
-- 1) NEW TABLE client_fee_phases
--    Several agreements change the monthly fee over time (Phase 1 / 2,
--    Design -> Execution -> Handover stages, etc.). One row per phase:
--      kind = 'monthly'  -> a monthly fee valid from effective_from to
--                           effective_to (blank end = open-ended).
--                           A blank effective_from means "dates not
--                           known yet" — the phase is on file but never
--                           used for billing until a start date is set.
--      kind = 'one_off'  -> a one-time amount (bonus, completion fee,
--                           balance on handover). Reference only — it is
--                           never billed automatically.
--    The Issue Invoice tab picks the monthly phase that covers the month
--    being invoiced. Clients WITHOUT any phases keep using
--    clients.monthly_fee_net exactly as before (no behaviour change).
--
-- 2) NEW COLUMNS on clients (all optional, nothing existing changes)
--    agreement_section    — e.g. '6.1' (default) or '7.1' for the Retainer
--    agreement_schedule   — e.g. '2' (default) or '3'
--    invoice_project_name — name printed on the "Project ..." line of the
--                           invoice; blank = use trade_name
--    fee_wording          — full custom monthly-fee wording that replaces
--                           the standard text. Placeholders:
--                           {MONTH} {YEAR} {PROJECT}. Blank = standard.
--
-- Additive only: no existing rows or columns are modified.
-- Safe to run more than once. Run in the Supabase SQL Editor.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS client_fee_phases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'monthly' CHECK (kind IN ('monthly', 'one_off')),
  label           TEXT NOT NULL,
  effective_from  DATE,
  effective_to    DATE,
  amount_net      DECIMAL(12, 2) NOT NULL DEFAULT 0,
  notes           TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT client_fee_phases_dates_ok
    CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_client_fee_phases_client
  ON client_fee_phases (client_id, kind, effective_from);

COMMENT ON TABLE client_fee_phases IS
  'Phased fee schedule per client/project. monthly rows drive the Issue Invoice monthly-fee amount for the covered months; one_off rows are reference only.';

-- Same access model as every other table (V35): logged-in user only.
ALTER TABLE client_fee_phases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_full_access" ON client_fee_phases;
CREATE POLICY "authenticated_full_access" ON client_fee_phases
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS agreement_section    TEXT,
  ADD COLUMN IF NOT EXISTS agreement_schedule   TEXT,
  ADD COLUMN IF NOT EXISTS invoice_project_name TEXT,
  ADD COLUMN IF NOT EXISTS fee_wording          TEXT;

COMMENT ON COLUMN clients.agreement_section IS
  'Agreement section cited on monthly-fee invoices (blank = 6.1).';
COMMENT ON COLUMN clients.agreement_schedule IS
  'Agreement schedule cited on monthly-fee invoices (blank = 2).';
COMMENT ON COLUMN clients.invoice_project_name IS
  'Name on the invoice "Project ..." line (blank = trade_name).';
COMMENT ON COLUMN clients.fee_wording IS
  'Optional full custom monthly-fee invoice wording; placeholders {MONTH} {YEAR} {PROJECT}. Blank = standard wording.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT * FROM client_fee_phases LIMIT 1;
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'clients'
--      AND column_name IN ('agreement_section','agreement_schedule','invoice_project_name','fee_wording');
