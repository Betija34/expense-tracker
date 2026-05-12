-- =============================================================
-- DATABASE_SCHEMA_V6_MIGRATION.sql
-- =============================================================
-- Purpose: Add Travel Log support.
--   1. New table `travel_periods` — date ranges per shareholder
--      (one row = one trip; from_date / to_date / destination / reason / comments)
--   2. Three new metadata columns on `expenses` for travel-specific details:
--        travel_where — Location (for Accommodation) or Route (for Transportation)
--        travel_who   — Participants or Travelers
--        travel_why   — Purpose (Accommodation or Transportation)
--      These are stored generically; the UI labels them based on subcategory.
--
-- Expenses get auto-grouped under a travel period at render time if:
--    expense.company_id        = period.company_id        AND
--    expense.shareholder_code  = period.shareholder_code  AND
--    expense.date BETWEEN period.from_date AND period.to_date AND
--    expense's category = "Travel Expenses" (or sub_ref_series = 'T')
--
-- Safe to re-run.
-- =============================================================

BEGIN;

-- 1) travel_periods table
CREATE TABLE IF NOT EXISTS travel_periods (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  shareholder_code TEXT NOT NULL CHECK (shareholder_code IN ('YK','BK')),
  from_date        DATE NOT NULL,
  to_date          DATE NOT NULL,
  destination      TEXT,
  reason           TEXT,
  comments         TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CHECK (to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS idx_travel_periods_lookup
  ON travel_periods(company_id, shareholder_code, from_date, to_date);

COMMENT ON TABLE travel_periods IS
  'A single trip (date range) for a shareholder. Drives the Travel Log and feeds the Allowances calculation in the Shareholder Report.';

-- 2) Travel-detail columns on expenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS travel_where TEXT,
  ADD COLUMN IF NOT EXISTS travel_who   TEXT,
  ADD COLUMN IF NOT EXISTS travel_why   TEXT;

COMMENT ON COLUMN expenses.travel_where IS
  'Travel-specific: Location (Accommodation subcategory) or Route (Transportation subcategory).';
COMMENT ON COLUMN expenses.travel_who IS
  'Travel-specific: Participants (Accommodation) or Travelers (Transportation).';
COMMENT ON COLUMN expenses.travel_why IS
  'Travel-specific: Purpose of stay or trip.';

COMMIT;
