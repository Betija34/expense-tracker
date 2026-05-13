/**
 * scripts/diagnose-rabona-jan.mjs
 *
 * Quick diagnostic: counts and lists every Rabona Holdings expense for
 * January 2026 directly from the database. If the count here is higher
 * than what View Expenses shows in the UI, we know the data is there
 * and the bug is client-side. If the count matches the UI, the row
 * never got created and we need to look at Bank Parser instead.
 *
 * Usage (from project root):
 *   node scripts/diagnose-rabona-jan.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Load .env.local
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

// 1. Find Rabona company id
const { data: company, error: companyErr } = await supabase
  .from('companies').select('id, name').eq('name', 'Rabona Holdings').single()
if (companyErr || !company) {
  console.error('❌ Could not find Rabona Holdings company:', companyErr?.message)
  process.exit(1)
}

// 2. Pull ALL Rabona expenses for Jan 2026 (no filter, no order, just count)
const { data: rows, error: queryErr, count } = await supabase
  .from('expenses')
  .select('reference_number, main_ref_seq, date, vendor, amount, direction, status, linked_expense_id, expense_categories(name)', { count: 'exact' })
  .eq('company_id', company.id)
  .gte('date', '2026-01-01')
  .lte('date', '2026-01-31')
  .order('main_ref_seq', { ascending: true })

if (queryErr) {
  console.error('❌ Query failed:', queryErr.message)
  process.exit(1)
}

console.log(`📊 Rabona Holdings — January 2026 expenses`)
console.log(`   Total rows returned: ${rows.length}`)
console.log(`   Exact count from DB: ${count}`)
console.log('')
console.log('Seq  Ref         Date         Direction  Amount      Status       Linked  Category')
console.log('---  ----------  -----------  ---------  ----------  -----------  ------  ----------------------------------')
for (const r of rows) {
  const seq = String(r.main_ref_seq).padStart(3, ' ')
  const ref = String(r.reference_number || '—').padEnd(10, ' ')
  const date = String(r.date || '—').padEnd(11, ' ')
  const dir = (r.direction === 'in' ? '↓ Income ' : '↑ Outgoing').padEnd(9, ' ')
  const amt = `€${Number(r.amount).toFixed(2)}`.padStart(10, ' ')
  const status = String(r.status || 'pending').padEnd(11, ' ')
  const linked = r.linked_expense_id ? ' yes  ' : ' —    '
  const cat = String(r.expense_categories?.name || '—').slice(0, 34)
  console.log(`${seq}  ${ref}  ${date}  ${dir}  ${amt}  ${status}  ${linked}  ${cat}`)
}

console.log('')
const seqs = rows.map(r => r.main_ref_seq)
const maxSeq = seqs.length > 0 ? Math.max(...seqs) : 0
const minSeq = seqs.length > 0 ? Math.min(...seqs) : 0
console.log(`🔢 Seq range: ${minSeq} → ${maxSeq}`)

// Check for gaps
const gaps = []
for (let i = minSeq; i <= maxSeq; i++) {
  if (!seqs.includes(i)) gaps.push(i)
}
if (gaps.length > 0) {
  console.log(`⚠️  Missing sequences in range: ${gaps.join(', ')}`)
  console.log(`   These could be expenses with dates OUTSIDE January (look for them with a wider date range)`)
} else {
  console.log(`✅ No gaps — sequences 1..${maxSeq} all present`)
}
