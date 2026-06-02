-- ============================================================
-- Rabona Expense Tracker - Schema Migration V34
-- Month Locking — closed_periods table
--
-- Background:
--   When a month is fully closed (all expenses categorized, invoices
--   sent, reports printed, etc.), we want to LOCK it so accidental
--   edits can't corrupt finalized data. A row in this table records
--   that a given (company, year, month) is closed. The app's
--   LockContext checks this table and disables all edit/save/delete
--   affordances on every page when the top-bar selection lands on a
--   closed period.
--
--   Phase 3 of the feature (in a later migration) will add Postgres
--   triggers on expenses, invoices, bank_transactions, etc. that
--   REJECT writes for rows in closed periods — defense-in-depth so
--   even a bug in the app code can't accidentally write to locked
--   months.
--
-- Scope:
--   Per (company, year, month). Rabona March can be closed while
--   Espargos March stays open, and locking one month doesn't affect
--   any other month.
--
-- What stays editable in a closed month:
--   - Monthly Checklist completions (documentation, not accounting)
--   - Folder Cover Page ticks (browser localStorage, not DB)
--   Everything else (expenses, invoices, bank transactions, travel
--   periods/expenses, shareholder allowances) becomes read-only.
--
-- How to run:
--   Open Supabase → SQL Editor → +New query → paste this script →
--   click "Run". Safe to re-run (CREATE TABLE IF NOT EXISTS).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS closed_periods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year        SMALLINT NOT NULL,
  month       SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  closed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by   VARCHAR(255),          -- free-text label for now (auth comes later in #27)
  notes       TEXT,                   -- optional context: "March close per Yoram"
  created_at  TIMESTAMPTZ DEFAULT NOW(),

  -- Each (company, year, month) can only be closed once at a time.
  -- Unlocking deletes the row; re-closing creates a new one.
  UNIQUE (company_id, year, month)
);

-- Fast lookup by (company, year, month) — already covered by the UNIQUE
-- constraint but adding an explicit index makes the intent clear.
CREATE INDEX IF NOT EXISTS idx_closed_periods_company_period
  ON closed_periods (company_id, year, month);

COMMIT;

-- Verify the table is empty (which it should be initially):
--   SELECT COUNT(*) FROM closed_periods;
--
-- To check what's closed for a specific company:
--   SELECT cp.year, cp.month, cp.closed_at, cp.notes
--   FROM closed_periods cp
--   JOIN companies c ON c.id = cp.company_id
--   WHERE c.name = 'Rabona Holdings'
--   ORDER BY cp.year DESC, cp.month DESC;
