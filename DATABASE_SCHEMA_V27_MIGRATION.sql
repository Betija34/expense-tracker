-- =====================================================================
-- V27 Migration — invoices: represents_period_year/month (per-month splits)
-- =====================================================================
--
-- Day 14: monthly fee invoices that bundle multiple deferred months
-- need to be SPLIT into one DB invoice per source month, not combined.
-- VAT/VIES regulations treat each month's fee as a distinct billable
-- service, so the issued documents must reflect that.
--
-- This adds a (represents_period_year, represents_period_month) pair
-- to invoices. When non-null, it says "this invoice's amount belongs
-- to that month, even though it's filed/issued in (period_year,
-- period_month)". For example, a January 2026 monthly fee that's
-- being billed in March 2026 would have:
--   period_year=2026, period_month=3  (filing month — top-bar)
--   represents_period_year=2026, represents_period_month=1  (what it's for)
--
-- For invoices that don't split this way (the default — pre-existing
-- rows + non-monthly-fee types like variable_expense which combine
-- multiple months into one bill), both columns stay NULL.
-- =====================================================================

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS represents_period_year INT,
  ADD COLUMN IF NOT EXISTS represents_period_month INT;

-- Pair constraint: either both NULL or both set (with valid month).
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS chk_represents_period_pair;
ALTER TABLE invoices
  ADD CONSTRAINT chk_represents_period_pair
  CHECK (
    (represents_period_year IS NULL AND represents_period_month IS NULL)
    OR
    (represents_period_year IS NOT NULL
     AND represents_period_month IS NOT NULL
     AND represents_period_month BETWEEN 1 AND 12)
  );

-- Lookup index for "find the invoice that represents this specific
-- source month for this client/type". Used by Block 1 when matching
-- per-instance placeholders to their saved DB rows.
CREATE INDEX IF NOT EXISTS idx_invoices_represents_period
  ON invoices (client_id, invoice_type, represents_period_year, represents_period_month)
  WHERE represents_period_year IS NOT NULL;

COMMENT ON COLUMN invoices.represents_period_year IS
  'When set, this invoice represents a specific source month''s billing (e.g., a January fee billed in March). NULL = combined/standard invoice.';

NOTIFY pgrst, 'reload schema';

COMMIT;
