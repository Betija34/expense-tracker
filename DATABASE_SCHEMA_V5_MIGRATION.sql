-- =============================================================
-- DATABASE_SCHEMA_V5_MIGRATION.sql
-- =============================================================
-- Purpose: Add shareholder_allowances table for tracking
-- per-shareholder monthly daily allowances (Cyprus tax rule:
-- directors get €150/day allowance for business travel days).
--
-- One row per (company, shareholder, year, month).
-- Used by the Shareholder Report's Net Balance calculation.
--
-- Safe to re-run.
-- =============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS shareholder_allowances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  shareholder_code TEXT NOT NULL CHECK (shareholder_code IN ('YK','BK')),
  year             INTEGER NOT NULL,
  month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  travel_days      INTEGER DEFAULT 0 CHECK (travel_days >= 0),
  daily_rate       NUMERIC DEFAULT 150 CHECK (daily_rate >= 0),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, shareholder_code, year, month)
);

CREATE INDEX IF NOT EXISTS idx_shareholder_allowances_lookup
  ON shareholder_allowances(company_id, shareholder_code, year, month);

COMMENT ON TABLE shareholder_allowances IS
  'Per-shareholder monthly travel-day allowance (Cyprus: €150/day for directors). Drives the Allowances line in the Shareholder Report.';

COMMIT;
