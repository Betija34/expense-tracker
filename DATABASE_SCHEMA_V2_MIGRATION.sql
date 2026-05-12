-- ============================================================
-- Rabona Expense Tracker - Schema Migration V2
-- Adopts original categories + subcategories from the HTML system.
-- Adds Sub-references, Linking, Direction, Reimbursable flag.
-- Safe: additive only (no destructive changes to existing data).
-- Run in Supabase SQL Editor.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EXPENSES TABLE — additive columns
-- ------------------------------------------------------------

-- Direction: 'in' (incoming) or 'out' (outgoing) — auto-detected from amount/transaction
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS direction VARCHAR(3) DEFAULT 'out';

-- Main reference components (sequencing inputs; display string in reference_number)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS main_ref_year   SMALLINT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS main_ref_month  SMALLINT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS main_ref_seq    INT;

-- Sub-reference (T / R / S, mutually exclusive)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sub_ref_series  CHAR(1);   -- 'T' | 'R' | 'S' | NULL
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sub_ref_month   SMALLINT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS sub_ref_seq     INT;

-- Subcategory link
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subcategory_id  UUID;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS subcategory_name VARCHAR(255); -- denormalized, allows custom values

-- Reimbursable flag — independent of category; when TRUE → R sub-ref takes priority
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_reimbursable BOOLEAN DEFAULT FALSE;

-- Linking back to source bank transaction (Path 1 workflow)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_transaction_id UUID REFERENCES bank_transactions(id);

-- Linking the two legs of a Movement Between Accounts pair
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS linked_expense_id UUID REFERENCES expenses(id);

-- ------------------------------------------------------------
-- 2. EXPENSE_CATEGORIES — additive columns for metadata
-- ------------------------------------------------------------
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS direction VARCHAR(3) DEFAULT 'out';
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS sub_ref_series CHAR(1);          -- auto sub-ref for this category
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS sub_ref_manual BOOLEAN DEFAULT FALSE; -- for S series (manual entry)
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS needs_linking BOOLEAN DEFAULT FALSE;  -- for Movement Between Accounts
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS needs_shareholder_tag BOOLEAN DEFAULT FALSE; -- YK/BK tagging
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS sort_order INT DEFAULT 999;
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Deactivate old categories so they don't clutter the dropdown
UPDATE expense_categories SET is_active = FALSE
WHERE name IN ('Travel', 'Meals', 'Office', 'Internal Transfer', 'Shareholder Transfer', 'Other', 'Payroll & Contributions');

-- ------------------------------------------------------------
-- 3. EXPENSE_CATEGORIES — insert ORIGINAL categories
-- ------------------------------------------------------------
INSERT INTO expense_categories (name, direction, sub_ref_series, sub_ref_manual, needs_linking, needs_shareholder_tag, sort_order, is_active)
VALUES
  -- OUTGOING (sort 10–110)
  ('Cost of Labor',                       'out', 'S',  TRUE,  FALSE, FALSE,  10, TRUE),
  ('Travel Expenses',                     'out', 'T',  FALSE, FALSE, FALSE,  20, TRUE),
  ('Professional Services',               'out', NULL, FALSE, FALSE, FALSE,  30, TRUE),
  ('Furniture and Equipment',             'out', NULL, FALSE, FALSE, FALSE,  40, TRUE),
  ('Office / General Administrative',     'out', NULL, FALSE, FALSE, FALSE,  50, TRUE),
  ('Transportation Expenses',             'out', NULL, FALSE, FALSE, FALSE,  60, TRUE),
  ('Bank Charges and Interest',           'out', NULL, FALSE, FALSE, FALSE,  70, TRUE),
  ('Annual Government Compliance Fees',   'out', NULL, FALSE, FALSE, FALSE,  80, TRUE),
  ('Transfers to Connected Accounts',     'out', NULL, FALSE, FALSE, FALSE,  90, TRUE),
  ('Personal Expenses of Shareholders',   'out', NULL, FALSE, FALSE, TRUE,  100, TRUE),
  ('Movement Between Accounts',           'out', NULL, FALSE, TRUE,  FALSE, 110, TRUE),
  -- INCOMING (sort 200–250)
  ('Client Payment',                      'in',  NULL, FALSE, FALSE, FALSE, 200, TRUE),
  ('Client Reimbursement',                'in',  NULL, FALSE, FALSE, FALSE, 210, TRUE),
  ('Supplier Refunds',                    'in',  NULL, FALSE, FALSE, FALSE, 220, TRUE),
  ('Shareholder Funding',                 'in',  NULL, FALSE, FALSE, TRUE,  230, TRUE),
  ('Intercompany Funding',                'in',  NULL, FALSE, FALSE, FALSE, 240, TRUE),
  ('Movement Between Accounts (in)',      'in',  NULL, FALSE, TRUE,  FALSE, 250, TRUE)
ON CONFLICT (name) DO UPDATE SET
  direction              = EXCLUDED.direction,
  sub_ref_series         = EXCLUDED.sub_ref_series,
  sub_ref_manual         = EXCLUDED.sub_ref_manual,
  needs_linking          = EXCLUDED.needs_linking,
  needs_shareholder_tag  = EXCLUDED.needs_shareholder_tag,
  sort_order             = EXCLUDED.sort_order,
  is_active              = TRUE;

-- ------------------------------------------------------------
-- 4. EXPENSE_SUBCATEGORIES — new table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_subcategories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  is_custom   BOOLEAN DEFAULT FALSE,  -- TRUE for [Custom] entries (user enters free text)
  is_dynamic  BOOLEAN DEFAULT FALSE,  -- TRUE for Supplier Refunds (learned from data)
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(category_id, name)
);

-- Insert subcategories (one block per category, using a lookup for category id)
DO $$
DECLARE
  cat_id UUID;
BEGIN

  -- Cost of Labor
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Cost of Labor';
  INSERT INTO expense_subcategories (category_id, name, is_custom, sort_order) VALUES
    (cat_id, 'Salary BK',                              FALSE, 10),
    (cat_id, 'Salary [Custom]',                        TRUE,  20),
    (cat_id, 'Social Insurance',                       FALSE, 30),
    (cat_id, 'PAYE',                                   FALSE, 40),
    (cat_id, 'GESI on Dividends',                      FALSE, 50),
    (cat_id, 'Income Tax',                             FALSE, 60),
    (cat_id, 'Provisional Tax',                        FALSE, 70),
    (cat_id, 'Insurance',                              FALSE, 80),
    (cat_id, 'Expense Reimbursement to Employees',     FALSE, 90)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Travel Expenses
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Travel Expenses';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Transportation',                          10),
    (cat_id, 'Accommodation',                           20),
    (cat_id, 'Allowances',                              30),
    (cat_id, 'Marketing Purposes (Hosting Visits)',     40),
    (cat_id, 'Other Travel Expenses',                   50)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Professional Services
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Professional Services';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Accounting, Audit, Company Secretary Services', 10),
    (cat_id, 'Services on FF&E',                              20),
    (cat_id, 'IT Services',                                   30),
    (cat_id, 'Legal',                                         40),
    (cat_id, 'Printing',                                      50),
    (cat_id, 'Other',                                         60)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Furniture and Equipment
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Furniture and Equipment';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Furniture & Fittings Office',                10),
    (cat_id, 'Computers and Telephones',                   20),
    (cat_id, 'Furniture & Fittings (Mock Up)',             30),
    (cat_id, 'Computer Software/Webpage Subscriptions',    40)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Office / General Administrative
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Office / General Administrative';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Office Supply Stationery and Sundries',     10),
    (cat_id, 'Courier and Postal Services',               20),
    (cat_id, 'Telephone/Internet/Mobile Expenses',        30),
    (cat_id, 'Penalties',                                 40),
    (cat_id, 'Maintenance',                               50),
    (cat_id, 'Entertainment',                             60),
    (cat_id, 'Representation/Gifts',                      70),
    (cat_id, 'Marketing',                                 80),
    (cat_id, 'Miscellaneous',                             90)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Transportation Expenses
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Transportation Expenses';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Taxi',     10),
    (cat_id, 'Fuel',     20),
    (cat_id, 'Car Park', 30),
    (cat_id, 'Other',    40)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Bank Charges and Interest
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Bank Charges and Interest';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Card Transaction Admin Fee',     10),
    (cat_id, 'Total Interest',                 20),
    (cat_id, 'Cash Advance Transfer Fee',      30),
    (cat_id, 'Card Membership Fee',            40),
    (cat_id, 'Unexecuted Direct Debit Fee',    50)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Annual Government Compliance Fees (no subcategories)

  -- Transfers to Connected Accounts
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Transfers to Connected Accounts';
  INSERT INTO expense_subcategories (category_id, name, is_custom, sort_order) VALUES
    (cat_id, 'Espargos',       FALSE, 10),
    (cat_id, 'Other [Custom]', TRUE,  20)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Personal Expenses of Shareholders
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Personal Expenses of Shareholders';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Transfers to SH A/C and Cash Withdrawal (YK)',  10),
    (cat_id, 'Payments Made on Behalf of SH (YK)',            20),
    (cat_id, 'Transfers to SH A/C and Cash Withdrawal (BK)',  30),
    (cat_id, 'Payments Made on Behalf of SH (BK)',            40)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Movement Between Accounts
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Movement Between Accounts';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Current Account → Mastercard Account', 10),
    (cat_id, 'Mastercard Account → Current Account', 20)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Client Payment (incoming)
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Client Payment';
  INSERT INTO expense_subcategories (category_id, name, is_custom, sort_order) VALUES
    (cat_id, 'Urban City',          FALSE, 10),
    (cat_id, 'Blue Lagoon',         FALSE, 20),
    (cat_id, 'Green Field Hotel',   FALSE, 30),
    (cat_id, 'Kypseli',             FALSE, 40),
    (cat_id, 'BAD City Hall',       FALSE, 50),
    (cat_id, 'BAD City SPA Hotel',  FALSE, 60),
    (cat_id, 'Evia Mare',           FALSE, 70),
    (cat_id, 'Other',               TRUE,  80)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Client Reimbursement (incoming) — same client list
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Client Reimbursement';
  INSERT INTO expense_subcategories (category_id, name, is_custom, sort_order) VALUES
    (cat_id, 'Urban City',          FALSE, 10),
    (cat_id, 'Blue Lagoon',         FALSE, 20),
    (cat_id, 'Green Field Hotel',   FALSE, 30),
    (cat_id, 'Kypseli',             FALSE, 40),
    (cat_id, 'BAD City Hall',       FALSE, 50),
    (cat_id, 'BAD City SPA Hotel',  FALSE, 60),
    (cat_id, 'Evia Mare',           FALSE, 70),
    (cat_id, 'Other',               TRUE,  80)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Supplier Refunds — dynamic, list learned from imports
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Supplier Refunds';
  INSERT INTO expense_subcategories (category_id, name, is_dynamic, sort_order) VALUES
    (cat_id, '[Dynamic - learned from data]', TRUE, 10)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Shareholder Funding (incoming)
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Shareholder Funding';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'YK', 10),
    (cat_id, 'BK', 20)
  ON CONFLICT (category_id, name) DO NOTHING;

  -- Intercompany Funding (no subcategories)

  -- Movement Between Accounts (in) — mirrors outgoing
  SELECT id INTO cat_id FROM expense_categories WHERE name = 'Movement Between Accounts (in)';
  INSERT INTO expense_subcategories (category_id, name, sort_order) VALUES
    (cat_id, 'Current Account ← Mastercard Account', 10),
    (cat_id, 'Mastercard Account ← Current Account', 20)
  ON CONFLICT (category_id, name) DO NOTHING;

END $$;

-- ------------------------------------------------------------
-- 5. INDEXES
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_expenses_direction
  ON expenses(direction);

CREATE INDEX IF NOT EXISTS idx_expenses_main_ref
  ON expenses(company_id, main_ref_year, main_ref_month, main_ref_seq);

CREATE INDEX IF NOT EXISTS idx_expenses_sub_ref
  ON expenses(sub_ref_series, sub_ref_month, sub_ref_seq);

CREATE INDEX IF NOT EXISTS idx_expenses_linked
  ON expenses(linked_expense_id);

CREATE INDEX IF NOT EXISTS idx_expenses_bank_transaction
  ON expenses(bank_transaction_id);

CREATE INDEX IF NOT EXISTS idx_expenses_reimbursable
  ON expenses(is_reimbursable) WHERE is_reimbursable = TRUE;

CREATE INDEX IF NOT EXISTS idx_expense_subcategories_cat
  ON expense_subcategories(category_id);

-- ------------------------------------------------------------
-- 6. UNIQUENESS CONSTRAINTS
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uniq_expenses_main_ref') THEN
    ALTER TABLE expenses
      ADD CONSTRAINT uniq_expenses_main_ref
      UNIQUE (company_id, main_ref_year, main_ref_month, main_ref_seq);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_expenses_sub_ref
  ON expenses(company_id, sub_ref_series, sub_ref_month, sub_ref_seq)
  WHERE sub_ref_series IS NOT NULL;

-- ------------------------------------------------------------
-- 7. VALIDITY CHECKS
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_direction_check') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_direction_check
      CHECK (direction IN ('in', 'out'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_sub_ref_series_check') THEN
    ALTER TABLE expenses ADD CONSTRAINT expenses_sub_ref_series_check
      CHECK (sub_ref_series IS NULL OR sub_ref_series IN ('T', 'R', 'S'));
  END IF;
END $$;

-- ============================================================
-- NOTES ON SUB-REFERENCE LOGIC (enforced in app, not DB)
--
-- 1. Reimbursable flag (is_reimbursable = TRUE) → sub-ref series 'R'
--    Takes priority. Reimbursable Travel still gets R, not T.
-- 2. Else, sub-ref derived from category.sub_ref_series:
--      'Cost of Labor'    → 'S' (manual entry — user picks month + seq)
--      'Travel Expenses'  → 'T' (auto from payment date)
--      everything else    → no sub-ref (NULL)
-- 3. Sequences are independent per series per month.
-- 4. Main reference (year/month/seq) is always auto from payment date,
--    unique within company per month.
-- ============================================================

COMMIT;
