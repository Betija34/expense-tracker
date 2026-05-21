-- =====================================================================
-- V18 Migration — Monthly Checklist
-- =====================================================================
--
-- Adds the Monthly Checklist page (a new tab between Dashboard and Bank
-- Statement Parser). Each company has its own recurring task list; you
-- tick items off per month and the page captures the date/time of
-- completion. Some tasks are conditional (VAT, depreciation) and can
-- be marked "Skipped / Not applicable this month" instead of "Done."
--
-- Tables:
--   checklist_items        — master list of recurring tasks per company
--   checklist_completions  — per-month completions (one per task per
--                            month per sub-key, where sub-key is for
--                            dynamic tasks like "Client expense reports
--                            per client")
--
-- Seeds Rabona Holdings with the 27 tasks the user has signed off on,
-- across 5 categories:
--   data_entry           (9 tasks)  — Category A
--   reports_analysis     (9 tasks)  — Category B, Block 1
--   reports_invoicing    (5 tasks)  — Category B, Block 2
--   reports_statutory    (2 tasks)  — Category B, Block 3 (Statutory & Periodic)
--   reports_closing      (2 tasks)  — Category B, Block 4 (Month-End Closing)
--
-- Espargos is intentionally NOT seeded — the user said it'll be added
-- later as a subset, via the in-app "Manage tasks" panel.
--
-- Idempotent: tables use IF NOT EXISTS; seed runs only when the
-- company has zero items (so re-running won't fight user edits).
-- =====================================================================

BEGIN;

-- -----------------------------------------------------------------
-- Master list of recurring monthly tasks. One row per task per company.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
    -- 'data_entry' | 'reports_analysis' | 'reports_invoicing' |
    -- 'reports_statutory' | 'reports_closing'
  name          TEXT NOT NULL,
  description   TEXT,
  task_type     TEXT NOT NULL DEFAULT 'static',
    -- 'static'                            — a single checkbox
    -- 'dynamic_clients_with_expenses'     — expands to one sub-row per
    --                                       client that had reimbursable
    --                                       expenses in the selected
    --                                       month; each sub-row is its
    --                                       own checkbox + amount + label
  allows_skip   BOOLEAN NOT NULL DEFAULT FALSE,
    -- TRUE for tasks that aren't always applicable (VAT, depreciation).
    -- UI offers a 3-state toggle: Done / Skipped (N/A) / Pending.
  sort_order    INT NOT NULL DEFAULT 100,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklist_items_company_cat_sort
  ON checklist_items (company_id, category, sort_order);

-- -----------------------------------------------------------------
-- Per-month completions. status = 'done' | 'skipped'.
-- sub_key is for dynamic tasks (e.g. the client name on a
-- "Client expense reports" sub-row); NULL for plain static tasks.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_completions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  year           INT NOT NULL,
  month          INT NOT NULL,
  sub_key        TEXT,
  status         TEXT NOT NULL DEFAULT 'done',
    -- 'done'    — the user ticked the task as completed
    -- 'skipped' — the user marked it Not Applicable this month
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note           TEXT,
  -- Uniqueness: one completion record per (item, year, month, sub_key).
  -- NULL sub_keys collide because PostgreSQL treats NULLs as distinct
  -- by default — coalesce them to a sentinel for the unique index.
  CONSTRAINT uniq_checklist_completion UNIQUE (item_id, year, month, sub_key)
);

CREATE INDEX IF NOT EXISTS idx_checklist_completions_item_ym
  ON checklist_completions (item_id, year, month);

-- -----------------------------------------------------------------
-- Seed Rabona Holdings — 27 tasks across 5 categories
-- -----------------------------------------------------------------
DO $$
DECLARE
  rabona_id UUID;
BEGIN
  SELECT id INTO rabona_id FROM companies WHERE name = 'Rabona Holdings';
  IF rabona_id IS NULL THEN
    RAISE EXCEPTION 'Company "Rabona Holdings" not found — run base schema first.';
  END IF;

  -- Skip if Rabona already has items (preserves user edits on re-run).
  IF EXISTS (SELECT 1 FROM checklist_items WHERE company_id = rabona_id) THEN
    RAISE NOTICE 'Rabona checklist already seeded — skipping seed.';
    RETURN;
  END IF;

  -- Category A: Data Entry (9 tasks)
  INSERT INTO checklist_items (company_id, category, name, sort_order) VALUES
    (rabona_id, 'data_entry', 'Download BoC Current Account statement',              10),
    (rabona_id, 'data_entry', 'Download BoC Mastercard statement',                   20),
    (rabona_id, 'data_entry', 'Prepare receipt / invoice folder',                    30),
    (rabona_id, 'data_entry', 'Import + reconcile bank statements (Bank Parser)',    40),
    (rabona_id, 'data_entry', 'Finalize all pending bank transactions',              50),
    (rabona_id, 'data_entry', 'Cash payment entry',                                  60),
    (rabona_id, 'data_entry', 'Finalize all pending cash payment entries',           70),
    (rabona_id, 'data_entry', 'Review View Expenses for misclassified rows',         80),
    (rabona_id, 'data_entry', 'Intercompany entries',                                90);

  -- Block 1: Reporting & Analysis (9 tasks)
  INSERT INTO checklist_items (company_id, category, name, task_type, sort_order) VALUES
    (rabona_id, 'reports_analysis', 'Payroll + contributions report',     'static',                          10),
    (rabona_id, 'reports_analysis', 'Shareholder Report — YK',             'static',                          20),
    (rabona_id, 'reports_analysis', 'Shareholder Report — BK',             'static',                          30),
    (rabona_id, 'reports_analysis', 'Travel Log report — YK',              'static',                          40),
    (rabona_id, 'reports_analysis', 'Travel Log report — BK',              'static',                          50),
    (rabona_id, 'reports_analysis', 'Prepaid travel expenses report',      'static',                          60),
    (rabona_id, 'reports_analysis', 'Client expense reports',              'dynamic_clients_with_expenses',   70),
    (rabona_id, 'reports_analysis', 'Full View Expenses report (PDF)',     'static',                          80),
    (rabona_id, 'reports_analysis', 'Dashboard report (PDF)',              'static',                          90);

  -- Block 2: Client Invoicing & Receivables (5 tasks)
  INSERT INTO checklist_items (company_id, category, name, sort_order) VALUES
    (rabona_id, 'reports_invoicing', 'Monthly invoices issued',                          10),
    (rabona_id, 'reports_invoicing', 'Statements of account updated',                    20),
    (rabona_id, 'reports_invoicing', '"Invoices issued" file updated',                   30),
    (rabona_id, 'reports_invoicing', 'Send "Invoices issued" email to MastServe',        40),
    (rabona_id, 'reports_invoicing', 'VIES report',                                      50);

  -- Block 3: Statutory & Periodic (2 tasks, both skippable)
  INSERT INTO checklist_items (company_id, category, name, allows_skip, sort_order) VALUES
    (rabona_id, 'reports_statutory', 'VAT return',                                       TRUE, 10),
    (rabona_id, 'reports_statutory', 'Run monthly depreciation entries',                 TRUE, 20);

  -- Block 4: Month-End Closing (2 tasks)
  INSERT INTO checklist_items (company_id, category, name, sort_order) VALUES
    (rabona_id, 'reports_closing', 'Inter-company reconciliation with Espargos',          10),
    (rabona_id, 'reports_closing', 'Lock the month',                                      20);

  RAISE NOTICE 'V18 applied: seeded Rabona Holdings with 27 monthly checklist items across 5 categories.';
END $$;

COMMIT;

-- To verify:
--   SELECT category, COUNT(*) AS items
--     FROM checklist_items
--    WHERE company_id = (SELECT id FROM companies WHERE name = 'Rabona Holdings')
--    GROUP BY category
--    ORDER BY MIN(sort_order);
-- Expected:
--   data_entry         | 9
--   reports_analysis   | 9
--   reports_invoicing  | 5
--   reports_statutory  | 2
--   reports_closing    | 2
