-- =====================================================================
-- V39 Migration — client_fee_phases.source_ref
-- ---------------------------------------------------------------------
-- Records which agreement or amendment each fee phase comes from,
-- e.g. "Consultancy Service Agreement dated 12/07/2026, Schedule 3" or
-- "Amendment No. 1 dated 15/10/2026, clause 2". Free text, optional.
-- Requires V38 (client_fee_phases). Additive only; safe to re-run.
-- =====================================================================

BEGIN;

ALTER TABLE client_fee_phases
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

COMMENT ON COLUMN client_fee_phases.source_ref IS
  'Agreement / amendment this phase comes from (free text, e.g. "Amendment No. 1 dated 15/10/2026").';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'client_fee_phases' AND column_name = 'source_ref';
