/**
 * scripts/migrate-v9-invoice-number.mjs
 *
 * One-off migration: adds the `invoice_number` TEXT column to the expenses
 * table. For incoming payments (Client Payment, Client Reimbursement),
 * users need to record which client invoice the payment settled.
 *
 * Usage (from project root):
 *   node scripts/migrate-v9-invoice-number.mjs
 *
 * NOTE: Supabase JS client doesn't support DDL (ALTER TABLE) directly via
 * the standard API. This script attempts to execute via the rpc('exec_sql', ...)
 * pattern if available, but falls back to instructing the user to run the
 * raw SQL in the Supabase SQL Editor — which is the most reliable path
 * for DDL anyway.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envText = readFileSync(join(__dirname, '..', '.env.local'), 'utf-8')
const env = {}
for (const line of envText.split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq === -1) continue
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
}
const supabase = createClient(
  env.VITE_SUPABASE_URL || env.SUPABASE_URL,
  env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY,
)

console.log('🔍 Checking whether invoice_number column already exists...')

// Try a SELECT that references the column. If it succeeds, column exists.
// If it errors with "column does not exist", we know we need to add it.
const { error: probeErr } = await supabase
  .from('expenses')
  .select('invoice_number')
  .limit(1)

if (!probeErr) {
  console.log('✅ Column `invoice_number` already exists on expenses table — nothing to do.')
  process.exit(0)
}

if (probeErr.code === '42703' || probeErr.message?.includes('column') || probeErr.message?.includes('invoice_number')) {
  console.log('⚠️  Column does not exist yet. Anon key cannot run ALTER TABLE.')
  console.log('')
  console.log('Please run this SQL in your Supabase SQL Editor:')
  console.log('  → Supabase Dashboard → SQL Editor → + New query')
  console.log('  → Paste the contents of DATABASE_SCHEMA_V9_MIGRATION.sql')
  console.log('  → Click Run')
  console.log('')
  console.log('Or copy this one-liner:')
  console.log('  ALTER TABLE expenses ADD COLUMN IF NOT EXISTS invoice_number TEXT;')
  console.log('')
  process.exit(1)
}

console.error('❌ Unexpected error probing column:', probeErr.message)
process.exit(1)
