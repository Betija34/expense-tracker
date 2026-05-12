-- ============================================================
-- Rabona Expense Tracker - Schema Migration V3
-- Adds support for split expenses (portions linked together).
-- Safe: additive only.
-- Run in Supabase SQL Editor.
-- ============================================================

-- split_group_id — all portions of a single split expense share this id.
-- Allows finding sibling portions easily without parent/child traversal.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_group_id UUID;

-- Optional position field for ordering portions within a split (1, 2, 3, ...)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_portion_index SMALLINT;

-- Index for efficient sibling lookups
CREATE INDEX IF NOT EXISTS idx_expenses_split_group ON expenses(split_group_id);

COMMIT;
