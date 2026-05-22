-- =====================================================================
-- V22 Migration — clients.trade_name unique per company (case-insensitive)
-- =====================================================================
--
-- Prevents the duplicate-client scenario that hit the user on May 23:
-- BAD City Hall + BAD City SPA Hotel both got accidentally added a
-- second time because the inactive originals were tucked away at the
-- bottom of the page and got missed.
--
-- Rules:
--   - trade_name must be unique WITHIN a company (case-insensitive).
--     "Blue Lagoon", "blue lagoon", "BLUE LAGOON" all collide.
--   - NULL trade_names are allowed and don't conflict (a client can
--     have only a legal_name without a project alias).
--   - legal_name CAN repeat across multiple clients — e.g. the legal
--     entity "613 INVESTMENT GROUP GmbH" has both "BAD City Hall" and
--     "BAD City SPA Hotel" as separate trade_names. That's the whole
--     point of having a project alias.
--   - Espargos can have a client with the same trade_name as Rabona,
--     since the index is scoped per company_id.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS, safe to re-run.
--
-- If this migration FAILS on first run, you have existing duplicates.
-- Run the duplicate-detection query first (see SESSION_SUMMARY_MAY_23
-- or ask Claude for it) and resolve before applying.
-- =====================================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_clients_company_trade_name
  ON clients (company_id, LOWER(trade_name))
  WHERE trade_name IS NOT NULL;

COMMENT ON INDEX uniq_clients_company_trade_name IS
  'Per-company, case-insensitive uniqueness on trade_name (project alias). '
  'NULL trade_names allowed. legal_name can repeat freely. Scoped per '
  'company_id so Rabona and Espargos can each have a "Blue Lagoon" project.';

COMMIT;

-- To verify:
--   SELECT indexname, indexdef
--     FROM pg_indexes
--    WHERE tablename = 'clients' AND indexname = 'uniq_clients_company_trade_name';
