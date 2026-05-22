-- =====================================================================
-- V24 Migration — expense_deferrals (rollover reimbursables to a later month)
-- =====================================================================
--
-- Day 13 add-on: variable expense reimbursements don't always get
-- invoiced in the month they're incurred. The user might let several
-- months pile up (e.g. don't bill Jan, don't bill Feb, then in March
-- issue ONE invoice covering Jan+Feb+Mar), or selectively defer one
-- month forward (defer Jan to June, but bill Feb+Mar in March).
--
-- A deferral is a per-(client, source_period) → target_period mapping.
-- Block 4 of the target month then sums up the natural target-month
-- reimbursables PLUS any sources that defer into it.
--
-- Rules:
--   - Unique on (company_id, client_id, source_year, source_month):
--     a given client-month can only be deferred to one target.
--   - target must be strictly LATER than source (no defer-to-past or
--     defer-to-same — that would be a no-op).
--   - ON DELETE CASCADE from clients/companies: if a client is deleted,
--     their deferrals go too (consistent with how invoices behave).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS expense_deferrals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,

  -- The month the expenses were originally incurred / would naturally
  -- have been billed in.
  source_year     INT  NOT NULL,
  source_month    INT  NOT NULL CHECK (source_month BETWEEN 1 AND 12),

  -- The month they will be bundled into instead. Must be strictly LATER
  -- than (source_year, source_month) — same-month "deferral" is a no-op
  -- and would just confuse downstream logic.
  target_year     INT  NOT NULL,
  target_month    INT  NOT NULL CHECK (target_month BETWEEN 1 AND 12),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uniq_deferral_source
    UNIQUE (company_id, client_id, source_year, source_month),

  CONSTRAINT chk_target_after_source
    CHECK (
      target_year > source_year OR
      (target_year = source_year AND target_month > source_month)
    )
);

COMMENT ON TABLE expense_deferrals IS
  'Per-(client, source month) rollover of variable expense reimbursements into a later target month. Lets the user defer billing of one month''s reimbursables into a future invoice that bundles them.';

-- Fast lookup for "what defers INTO this period" — used when rendering
-- Block 4 of the current top-bar month.
CREATE INDEX IF NOT EXISTS idx_deferrals_target
  ON expense_deferrals (company_id, client_id, target_year, target_month);

-- Auto-bump updated_at on every UPDATE so the audit trail stays honest.
CREATE OR REPLACE FUNCTION expense_deferrals_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expense_deferrals_updated_at ON expense_deferrals;
CREATE TRIGGER trg_expense_deferrals_updated_at
  BEFORE UPDATE ON expense_deferrals
  FOR EACH ROW
  EXECUTE FUNCTION expense_deferrals_set_updated_at();

-- Tell PostgREST to pick up the new table immediately.
NOTIFY pgrst, 'reload schema';

COMMIT;
