-- =====================================================================
-- V31: Per-client SOA historical rows (pre-system ledger entries)
-- ---------------------------------------------------------------------
-- Urban City, BAD City Hall, and other long-running clients have
-- contract history that started before this system existed (e.g. Urban
-- City began in 2023). Their existing external SOA Excel files contain
-- years of row-by-row history we want to preserve permanently in every
-- SOA the system generates.
--
-- This table stores those historical rows EXACTLY as the user pastes
-- them from her existing SOA Excels. The SOA generator merges them
-- with system-derived rows (invoices + payments) and renders the full
-- history without the user having to paste each time.
--
-- The user enters them once per client via the "Import Historical
-- Rows" modal (paste tab-separated rows from her old SOA Excel —
-- date, type, doc no, description, amount, received).
--
-- Schema mirrors the SOA layout columns so the generator can treat
-- historical rows interchangeably with system rows:
--   row_date     → DOCUMENT Date  (col B)
--   doc_type     → DOCUMENT Type  (col C)
--   doc_number   → DOCUMENT No    (col D)
--   description  → DESCRIPTION    (col E)
--   amount       → AMOUNT         (col F, debit)
--   received     → AMOUNT RECEIVED (col G, credit)
--
-- row_index orders rows that share the same row_date (Excel doesn't
-- guarantee a stable secondary sort, so the user's paste order wins).
--
-- Balance is NOT stored — the generator recomputes it via Excel
-- formula on every export, so historical and current rows share one
-- continuous balance column.
--
-- Safe to run multiple times (IF NOT EXISTS).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS soa_historical_rows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Display ordering. We sort by (row_date, row_index) so multiple
  -- rows on the same date keep their paste order.
  row_index       INT NOT NULL,

  -- Column-mapped fields:
  row_date        DATE NOT NULL,
  doc_type        TEXT,                       -- '' | INVOICE | CREDIT NOTE | PROFORMA INVOICE | PREVIOUS TOTALS:
  doc_number      TEXT,
  description     TEXT,
  amount          DECIMAL(12, 2) DEFAULT 0,   -- debit (col F)
  received        DECIMAL(12, 2) DEFAULT 0,   -- credit (col G)

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup of all historical rows for one client, in order.
CREATE INDEX IF NOT EXISTS idx_soa_historical_rows_client_date
  ON soa_historical_rows (client_id, row_date, row_index);

COMMENT ON TABLE  soa_historical_rows IS
  'Per-client pre-system SOA ledger rows. User pastes once per client from her existing external SOA Excel; the SOA generator merges these with system invoices/payments on every export. See V31 migration header for full schema notes.';
COMMENT ON COLUMN soa_historical_rows.row_index IS
  'Display order for rows sharing the same row_date. Auto-assigned by paste order in the Import Historical Rows modal.';
COMMENT ON COLUMN soa_historical_rows.amount IS
  'Debit (col F on SOA). Use for INVOICE / PROFORMA INVOICE rows.';
COMMENT ON COLUMN soa_historical_rows.received IS
  'Credit (col G on SOA). Use for INWARDS TRANSFER and CREDIT NOTE rows.';

COMMIT;

-- Reload PostgREST schema cache so the new table is immediately
-- usable from the app without waiting for the auto-refresh window.
NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'soa_historical_rows'
--    ORDER BY ordinal_position;
