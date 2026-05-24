-- =====================================================================
-- V29: Manual travel-period assignment for expenses
-- ---------------------------------------------------------------------
-- Adds an optional `assigned_period_id` FK on the expenses table so the
-- user can explicitly attach a travel expense to a specific trip,
-- overriding the default date-based auto-grouping in the Travel Log.
--
-- Why we need this:
--   Bank settlement dates don't always fall inside the trip window
--   (e.g. an Athens-trip dinner from 04/03 might post to the bank on
--   06/03 even though the trip is 01/03–05/03; or a flight is paid
--   25/02 for a trip in March). The Travel Log currently groups
--   expenses by date range, so those land in the "Pre-paid /
--   Unassigned" section. With this new column the user can pick the
--   right trip from a dropdown and the expense moves into the trip
--   card permanently.
--
-- Behavior:
--   • Default: NULL → fall back to date-based auto-grouping as today.
--   • Set:     match this travel_period explicitly.
--   • ON DELETE SET NULL → deleting a trip un-assigns its manually-
--     attached expenses (they revert to auto-grouping / Pre-paid).
--
-- Safe to run multiple times (IF NOT EXISTS).
-- =====================================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS assigned_period_id UUID
    REFERENCES travel_periods(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_assigned_period
  ON expenses(assigned_period_id)
  WHERE assigned_period_id IS NOT NULL;

COMMENT ON COLUMN expenses.assigned_period_id IS
  'Optional manual link to a travel_periods row. When set, overrides the date-based auto-grouping in the Travel Log. Used when a travel expense settles outside the actual trip window.';

-- Reload PostgREST schema cache so the new column is immediately
-- visible to the API without restarting Supabase.
NOTIFY pgrst, 'reload schema';
