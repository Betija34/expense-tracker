/**
 * scripts/migrate-espargos-prefix.mjs
 *
 * One-off migration: prepend "E" to every Espargos expense's reference_number
 * that doesn't already have it. Equivalent to DATABASE_SCHEMA_V8_MIGRATION.sql
 * but runnable from terminal without opening the Supabase SQL Editor.
 *
 * Usage (from project root):
 *   node scripts/migrate-espargos-prefix.mjs
 *
 * Behavior:
 *   - Reads .env.local for Supabase credentials.
 *   - Finds all Espargos expenses whose reference_number doesn't start with "E".
 *   - Updates them one by one (anon-key compatible — no service role needed).
 *   - Idempotent: re-running does nothing on already-migrated rows.
 *   - Prints a summary at the end (how many found, updated, skipped, errored).
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ---- Load .env.local (small bespoke parser — no dotenv dependency needed) ----
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env.local')
const envText = readFileSync(envPath, 'utf-8')
const env = {}
for (const line of envText.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
}

const SUPABASE_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing Supabase URL or key in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ---- Find Espargos company id ----
console.log('🔍 Looking up Espargos company...')
const { data: company, error: companyErr } = await supabase
  .from('companies')
  .select('id, name')
  .eq('name', 'Espargos')
  .single()

if (companyErr || !company) {
  console.error('❌ Could not find Espargos company:', companyErr?.message || 'not found')
  process.exit(1)
}
console.log(`   ✓ Espargos company_id = ${company.id}`)

// ---- Find Espargos expenses whose ref doesn't already start with "E" ----
console.log('🔍 Finding Espargos expenses without "E" prefix...')
const { data: rowsToFix, error: queryErr } = await supabase
  .from('expenses')
  .select('id, reference_number')
  .eq('company_id', company.id)
  .not('reference_number', 'is', null)
  .not('reference_number', 'ilike', 'E%')

if (queryErr) {
  console.error('❌ Query failed:', queryErr.message)
  process.exit(1)
}

console.log(`   ✓ Found ${rowsToFix.length} row(s) to migrate`)
if (rowsToFix.length === 0) {
  console.log('✅ Nothing to do — all Espargos refs already start with "E". Exiting.')
  process.exit(0)
}

// ---- Update each row, prepending "E" to its reference_number ----
console.log('✏️  Applying migration...')
let updated = 0
let errored = 0
for (const row of rowsToFix) {
  const newRef = `E${row.reference_number}`
  const { error: updateErr } = await supabase
    .from('expenses')
    .update({ reference_number: newRef })
    .eq('id', row.id)

  if (updateErr) {
    console.error(`   ❌ Row ${row.id} (${row.reference_number}): ${updateErr.message}`)
    errored++
  } else {
    console.log(`   ✓ ${row.reference_number}  →  ${newRef}`)
    updated++
  }
}

// ---- Summary ----
console.log('')
console.log('=================================================================')
console.log(`✅ Migration complete: ${updated} updated, ${errored} errored, ${rowsToFix.length} total`)
console.log('=================================================================')
console.log('')
console.log('Next step: hard-refresh the app (Cmd+Shift+R) to see the new refs.')

process.exit(errored > 0 ? 1 : 0)
