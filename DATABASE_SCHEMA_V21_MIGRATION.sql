-- =====================================================================
-- V21 Migration — invoices table (Phase 2 Step 2, MVP scope)
-- =====================================================================
--
-- Tracks the per-month invoices the user issues. The system does NOT
-- generate invoice PDFs (those are created in a separate tool and saved
-- in a folder on the user's computer named by invoice_number). This
-- table is purely the metadata / lifecycle tracker.
--
-- Each row represents ONE invoice with its own lifecycle:
--   issue date → SOA updated (post-issue) → emailed → payment received
--   → SOA updated (post-payment) → finalized
--
-- Auto-draft logic lives in the app (Clients.jsx): when the user opens
-- the Client Invoicing tab for a given month, the app surfaces ONE row
-- per active client per applicable type (monthly_fee + fixed_expense +
-- variable_expense). Those rows are NOT inserted to the DB until the
-- user actually types into one of the fields — keeps the DB clean.
--
-- All lifecycle fields are MANUALLY editable. No auto-pickup from
-- bank_transactions in this step (the first few months carry late-2025
-- invoices that the system has no record of; manual entry is the only
-- correct path). Auto-suggestions are a Step 3+ enhancement.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS invoices (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id                UUID NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,

  -- The billing period this invoice covers. Distinct from date_issued —
  -- e.g. an April invoice (period_year=2026, period_month=4) may be
  -- issued in March (date_issued=2026-03-25) as an advance invoice.
  period_year              INT NOT NULL,
  period_month             INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),

  -- What KIND of invoice this is. Drives which block it renders in and
  -- whether VAT applies (only 'monthly_fee' and 'one_off_service' carry VAT).
  invoice_type             TEXT NOT NULL CHECK (invoice_type IN (
    'monthly_fee',
    'fixed_expense',
    'variable_expense',
    'one_off_service',
    'one_off_reimbursement',
    'credit_note'
  )),

  -- Free-text description for the invoice (e.g. "March 2026 fee"). The
  -- app fills this in automatically based on type + period when the row
  -- is created, but the user can edit it.
  description              TEXT,

  -- Amounts. amount_net is the base; amount_total = amount_net * (1 + vat_rate).
  -- amount_total is stored (not computed) so manual overrides are sticky.
  amount_net               DECIMAL(12, 2) DEFAULT 0,
  vat_rate                 DECIMAL(5, 4)  DEFAULT 0,
  amount_total             DECIMAL(12, 2) DEFAULT 0,

  -- Lifecycle status. Derived in the UI from which fields are filled,
  -- but stored explicitly here too so future reports can filter
  -- without recomputing.
  status                   TEXT NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned',      -- placeholder, no fields filled yet
    'skipped',      -- intentionally not invoiced this month (carries as arrears)
    'issued',       -- inv_number + date_issued set
    'emailed',      -- email_sent_at also set
    'paid',         -- date_paid also set
    'finalized',    -- post-payment SOA also ticked — fully closed
    'voided'        -- rare, for cancellation
  )),

  -- The 6 lifecycle fields the user fills in manually:
  invoice_number           TEXT,                 -- e.g. "2026-03-001"
  date_issued              DATE,
  soa_updated_at_issue     TIMESTAMPTZ,          -- ticked = SOA updated after invoice issued
  email_sent_at            TIMESTAMPTZ,          -- ticked = email sent to client
  date_paid                DATE,
  soa_updated_at_payment   TIMESTAMPTZ,          -- ticked = SOA updated after payment received

  notes                    TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_company_period
  ON invoices (company_id, period_year, period_month);
CREATE INDEX IF NOT EXISTS idx_invoices_client
  ON invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status
  ON invoices (company_id, status);

COMMENT ON TABLE  invoices                IS 'Per-month invoice lifecycle tracker (Phase 2 Step 2). System does not generate invoice PDFs — this table is metadata only.';
COMMENT ON COLUMN invoices.period_year    IS 'Year of the billing period the invoice covers (not the issue date).';
COMMENT ON COLUMN invoices.period_month   IS 'Month of the billing period (1-12). For advance billing, period may differ from date_issued.';
COMMENT ON COLUMN invoices.invoice_type   IS 'Drives which block the row renders in. Only monthly_fee + one_off_service carry VAT.';
COMMENT ON COLUMN invoices.status         IS 'Lifecycle state. Derived in UI but stored explicitly so future reports can filter cheaply.';
COMMENT ON COLUMN invoices.invoice_number IS 'User-typed invoice number, typically YYYY-MM-NNN (e.g. 2026-03-001). NOT auto-generated.';

COMMIT;

-- Reload PostgREST schema cache so the new table + columns are immediately
-- usable from the app without waiting for the auto-refresh window.
NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'invoices'
--    ORDER BY ordinal_position;
