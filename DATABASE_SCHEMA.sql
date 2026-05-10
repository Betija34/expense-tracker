-- Rabona Expense Tracker - Database Schema
-- Run this in Supabase SQL Editor to initialize the database

-- ============================================================
-- COMPANIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  code VARCHAR(50) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert companies
INSERT INTO companies (name, code) VALUES
  ('Rabona Holdings', 'RH'),
  ('Espargos', 'ES')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- ACCOUNTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  name VARCHAR(255) NOT NULL,
  account_type VARCHAR(50) NOT NULL, -- 'bank', 'credit_card', 'shareholder'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert accounts
INSERT INTO accounts (company_id, name, account_type) VALUES
  ((SELECT id FROM companies WHERE code = 'RH'), 'Current Account', 'bank'),
  ((SELECT id FROM companies WHERE code = 'RH'), 'Mastercard', 'credit_card'),
  ((SELECT id FROM companies WHERE code = 'ES'), 'Current Account', 'bank'),
  ((SELECT id FROM companies WHERE code = 'ES'), 'Mastercard', 'credit_card')
ON CONFLICT DO NOTHING;

-- ============================================================
-- EXPENSE CATEGORIES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert categories
INSERT INTO expense_categories (name, description) VALUES
  ('Travel', 'Flight, hotel, transportation'),
  ('Meals', 'Food and beverage'),
  ('Office', 'Office supplies and equipment'),
  ('Professional Services', 'Consulting, legal, accounting'),
  ('Client Reimbursement', 'Expenses to be reimbursed to clients'),
  ('Internal Transfer', 'Internal account transfers'),
  ('Shareholder Transfer', 'Transfers to/from shareholders'),
  ('Other', 'Miscellaneous expenses')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- EXPENSES TABLE (Core)
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  category_id UUID REFERENCES expense_categories(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  description TEXT,
  vendor VARCHAR(255),
  reference_number VARCHAR(255),

  -- Expense type
  expense_type VARCHAR(50) NOT NULL DEFAULT 'regular', -- 'regular', 'split', 'transfer', 'reimbursement'

  -- Split expense info
  is_split BOOLEAN DEFAULT FALSE,
  split_parent_id UUID REFERENCES expenses(id),
  split_portion_percentage DECIMAL(5, 2),

  -- Reimbursement tracking
  client_name VARCHAR(255),
  requires_reimbursement BOOLEAN DEFAULT FALSE,
  reimbursed BOOLEAN DEFAULT FALSE,
  reimbursement_date DATE,

  -- Travel specific
  is_prepaid_travel BOOLEAN DEFAULT FALSE,
  travel_from VARCHAR(255),
  travel_to VARCHAR(255),
  travel_date_start DATE,
  travel_date_end DATE,

  -- Shareholder tracking
  shareholder_code VARCHAR(50), -- 'YK', 'BK', etc
  transfer_direction VARCHAR(20), -- 'from', 'to'

  -- Status
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'approved', 'locked'
  month_locked BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- SPLIT EXPENSES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS split_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_expense_id UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  portion_name VARCHAR(255),
  portion_percentage DECIMAL(5, 2) NOT NULL,
  portion_amount DECIMAL(12, 2) NOT NULL,
  company_id UUID REFERENCES companies(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- BANK IMPORTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  import_date DATE NOT NULL,
  file_name VARCHAR(255),
  file_type VARCHAR(50), -- 'csv', 'pdf', 'image'
  transaction_count INT DEFAULT 0,
  processed_count INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'error'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- BANK TRANSACTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_import_id UUID REFERENCES bank_imports(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  transaction_date DATE NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  description TEXT,
  transaction_type VARCHAR(50), -- 'debit', 'credit'
  matched_expense_id UUID REFERENCES expenses(id),
  status VARCHAR(50) DEFAULT 'unmatched', -- 'unmatched', 'matched', 'pending_review'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- SHAREHOLDERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS shareholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  company_id UUID REFERENCES companies(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert shareholders
INSERT INTO shareholders (code, name, company_id) VALUES
  ('YK', 'Y.K.', (SELECT id FROM companies WHERE code = 'RH')),
  ('BK', 'B.K.', (SELECT id FROM companies WHERE code = 'RH'))
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- AUDIT LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(100),
  entity_id UUID,
  changes JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- MONTHLY CLOSE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS monthly_close (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  year INT NOT NULL,
  month INT NOT NULL,
  is_locked BOOLEAN DEFAULT FALSE,
  locked_at TIMESTAMP,
  locked_by VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(company_id, year, month)
);

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_expenses_company_date ON expenses(company_id, date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_account ON expenses(account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_company ON bank_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account ON bank_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_monthly_close_company ON monthly_close(company_id, year, month);

-- ============================================================
-- ROW LEVEL SECURITY (Optional - enable for multi-tenant)
-- ============================================================
-- Uncomment these if you want to add user authentication later
-- ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

COMMIT;
