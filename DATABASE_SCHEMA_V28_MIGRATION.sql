-- =====================================================================
-- V28: Add `flights` column to travel_periods
-- ---------------------------------------------------------------------
-- Adds a freestyle text field at the trip-period level so the user can
-- record the actual flights taken (e.g. "TLV→LCA→ATH 01/03 · ATH→LCA→TLV
-- 12/03"). Rendered in the Travel Log as a full-width input directly
-- under the From Date / To Date / Destination / Reason for Travel row.
--
-- The existing `comments` column on travel_periods is unchanged — it
-- stays where it is (below the per-period expense list) and continues
-- to hold general trip notes.
--
-- Safe to run multiple times (IF NOT EXISTS).
-- =====================================================================

ALTER TABLE travel_periods
  ADD COLUMN IF NOT EXISTS flights TEXT;

-- Reload PostgREST schema cache so the new column is immediately
-- visible to the API without restarting Supabase.
NOTIFY pgrst, 'reload schema';
