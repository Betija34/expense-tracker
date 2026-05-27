-- =====================================================================
-- V32: Persist client legal-entity fields for SOA header
-- ---------------------------------------------------------------------
-- The Statement of Account header lists the client's legal entity:
--   Company name  → already stored (clients.legal_name)
--   Company no    → NEW (registration_number) — e.g. "HE439329"
--   VAT number    → NEW (vat_id)              — e.g. "10439329Y"
--   Address       → NEW (address)
--
-- These don't change frequently (annual renewal at most), so the user
-- wants them stored on the client rather than re-typed each time the
-- SOA is generated. The SOA modal will pre-fill from these columns
-- and persist any edits back here on Download.
--
-- Original V30 design call was "keep header editable on the SOA
-- itself" — reversed May 27 2026 once the user saw the workflow.
--
-- Safe to run multiple times (IF NOT EXISTS).
-- =====================================================================

BEGIN;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS vat_id              TEXT,
  ADD COLUMN IF NOT EXISTS address             TEXT;

COMMENT ON COLUMN clients.registration_number IS
  'Client''s company registration number (e.g. Cypriot HE439329). Shown on the SOA header.';
COMMENT ON COLUMN clients.vat_id IS
  'Client''s VAT identification number (e.g. 10439329Y). Shown on the SOA header.';
COMMENT ON COLUMN clients.address IS
  'Client''s registered address. Shown on the SOA header.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- To verify:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'clients'
--      AND column_name IN ('registration_number', 'vat_id', 'address');
