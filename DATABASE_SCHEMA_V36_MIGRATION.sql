-- ============================================================================
-- DATABASE SCHEMA V36 MIGRATION — Travel Log: hide/show the Trip line
-- ----------------------------------------------------------------------------
-- Adds a per-expense flag that hides the "Trip (manual)" line on a Travel Log
-- expense card. Default false = the line shows automatically when the month is
-- opened. When true, the line is hidden on screen and omitted from print until
-- the user shows it again. RLS from V35 already covers this column.
-- ============================================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS hide_trip_line boolean NOT NULL DEFAULT false;
