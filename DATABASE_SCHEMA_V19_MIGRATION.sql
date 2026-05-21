-- =====================================================================
-- V19 Migration — Clients table (Step 1 of the Phase 2 Clients & Billing module)
-- =====================================================================
--
-- Adds a proper per-company client master list. Each client carries
-- the contact info, default monthly fee, VAT treatment, and the email
-- chain (TO + CC) that future invoices will use.
--
-- This is Step 1 of #28. Step 1 alone:
--   - creates the `clients` table
--   - seeds Rabona's 7 clients from the user's handwritten PDF checklist
--   - is the data source for the new "Clients" admin tab
--
-- Step 1 does NOT yet:
--   - replace expenses.client_name (existing free-text field stays — we
--     don't break old data; that migration happens in a later step)
--   - issue invoices
--   - track client payments
--   - generate statement-of-accounts PDFs
--
-- Espargos is intentionally seeded empty — the user adds Espargos
-- clients via the admin UI when ready. Also resolves task #25 (Espargos
-- client list) as a side effect since the same UI handles both companies.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / DO-block seed only runs when
-- Rabona has zero clients (preserves any edits made after first seed).
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS clients (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Identity
  legal_name        TEXT NOT NULL,        -- e.g. "BTS Real estate SM SA"
  trade_name        TEXT,                 -- e.g. "Blue Lagoon" (project alias)
  contact_name      TEXT,                 -- e.g. "Kostas"

  -- Billing defaults
  monthly_fee_net   DECIMAL(12, 2) DEFAULT 0,
    -- Base recurring fee BEFORE VAT. The amount we'll pre-fill on new
    -- invoices but the user can override per invoice.
  vat_rate          DECIMAL(5, 4) DEFAULT 0,
    -- VAT rate as a decimal: 0 = no VAT, 0.1900 = 19% (Cyprus standard).
    -- Total invoice amount = monthly_fee_net * (1 + vat_rate).

  -- Email defaults (for invoice delivery — Step 2+)
  email_to          TEXT,                 -- comma-separated primary recipients
  email_cc          TEXT,                 -- comma-separated CC recipients

  -- Soft-delete / archival
  active            BOOLEAN DEFAULT TRUE,
  notes             TEXT,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_company_active
  ON clients (company_id, active);

COMMENT ON COLUMN clients.monthly_fee_net IS
  'Base recurring fee BEFORE VAT. Display total = net * (1 + vat_rate).';
COMMENT ON COLUMN clients.vat_rate IS
  'VAT rate as decimal. 0 = no VAT, 0.1900 = 19% Cyprus standard.';
COMMENT ON COLUMN clients.email_to IS
  'Comma-separated primary recipients for invoice emails.';
COMMENT ON COLUMN clients.email_cc IS
  'Comma-separated CC recipients for invoice emails.';

-- -----------------------------------------------------------------
-- Seed Rabona Holdings — 7 clients from the user's PDF checklist
-- -----------------------------------------------------------------
DO $$
DECLARE rabona_id UUID;
BEGIN
  SELECT id INTO rabona_id FROM companies WHERE name = 'Rabona Holdings';
  IF rabona_id IS NULL THEN
    RAISE EXCEPTION 'Company "Rabona Holdings" not found.';
  END IF;

  IF EXISTS (SELECT 1 FROM clients WHERE company_id = rabona_id) THEN
    RAISE NOTICE 'Rabona clients already seeded — skipping seed.';
    RETURN;
  END IF;

  INSERT INTO clients
    (company_id, legal_name, trade_name, contact_name, monthly_fee_net, vat_rate, email_to, email_cc)
  VALUES
    (rabona_id, 'BTS Real estate SM SA',
                'Blue Lagoon',
                'Kostas',
                5000.00,  0.0000,
                'controller@astrea-properties.com',
                'finance@astrea-properties.com, yoram.kedem@rabonaholdings.com'),
    (rabona_id, 'EVIMER Ltd',
                'Urban City',
                'Kostas',
                10000.00, 0.1900,
                'controller@astrea-properties.com',
                'finance@astrea-properties.com, yoram.kedem@rabonaholdings.com'),
    (rabona_id, 'OZ SHLOMO SINGLE MEMBER S.A.',
                'Green Field Hotel',
                'Shlomi',
                3500.00,  0.0000,
                'shlomi@oz-ceramica.co.il',
                'yoram.kedem@rabonaholdings.com'),
    (rabona_id, 'SUNDAY LIFESTYLE S.L.',
                'Kypseli',
                'Amir',
                6000.00,  0.0000,
                'Amir@bcapital.com, guyg@bcapital.com',
                'yoram.kedem@rabonaholdings.com'),
    (rabona_id, '613 INVESTMENT GROUP GmbH',
                'BAD City Hall',
                'Shani and Joseph',
                2500.00,  0.0000,
                'joseph@613hotels.com, shani@613hotels.com',
                'yoram.kedem@rabonaholdings.com'),
    (rabona_id, '613 INVESTMENT GROUP GmbH',
                'BAD City SPA Hotel',
                'Shani and Joseph',
                2500.00,  0.0000,
                'joseph@613hotels.com, shani@613hotels.com',
                'yoram.kedem@rabonaholdings.com'),
    (rabona_id, 'DIAMOND STAR REAL ESTATE SINGLE MEMBER SOCIETE ANONYME',
                'Evia Mare',
                'Kostas',
                3750.00,  0.0000,
                'controller@astrea-properties.com',
                'finance@astrea-properties.com, yoram.kedem@rabonaholdings.com');

  RAISE NOTICE 'V19 applied: seeded Rabona Holdings with 7 clients.';
END $$;

COMMIT;

-- To verify:
--   SELECT trade_name, legal_name, contact_name, monthly_fee_net, vat_rate
--     FROM clients
--    WHERE company_id = (SELECT id FROM companies WHERE name = 'Rabona Holdings')
--    ORDER BY trade_name;
