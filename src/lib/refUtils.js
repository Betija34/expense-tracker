import { supabase } from '../supabaseClient'

// Generates a UUID v4 — used to identify a group of split portions.
export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Reference number utilities for the expenses table.
 *
 * Main reference: YY/M/seq  (no leading zeros)
 *   - year & month derived from payment date
 *   - seq is auto-assigned: next available sequence for that company + year + month
 *
 * Sub-reference: [series][month]/[seq]  (e.g. T1/4, R1/2, S12/3)
 *   - series: 'T' (Travel), 'R' (Reimbursable), 'S' (Salaries/Payroll)
 *   - T and R: auto-derived from payment date month + next seq
 *   - S: MANUAL — user enters the month + seq (may reflect work period, not payment month)
 *   - sub-refs are mutually exclusive: Reimbursable flag wins (R) over category-derived (T or S)
 */

/** Parses an ISO date "YYYY-MM-DD" into {year, month, day}. */
export function parseISODate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return { year: y, month: m, day: d }
}

/**
 * Returns the company-specific reference prefix.
 *   - Espargos          → "E"   (e.g. E26/1/4)
 *   - Rabona Holdings   → ""    (e.g. 26/1/4)
 *
 * Centralised here so we only need to add new prefixes in one place if more
 * companies are introduced. Used by every reference_number construction site
 * (AddExpense, FinalizeTransaction, Bulk Approve in TransactionTable).
 */
export function companyRefPrefix(companyName) {
  if (companyName === 'Espargos') return 'E'
  return ''
}

/**
 * Builds a reference_number string from year/month/seq + optional company.
 *   buildMainRef(2026, 1, 4)              →  "26/1/4"             (Rabona / default)
 *   buildMainRef(2026, 1, 4, 'Espargos')  →  "E26/1/4"
 * Used at INSERT time to populate expenses.reference_number.
 */
export function buildMainRef(year, month, seq, companyName) {
  const yy = String(year).slice(-2)
  const prefix = companyRefPrefix(companyName)
  return `${prefix}${yy}/${month}/${seq}`
}

/** Formats main reference for display: 26/1/4 or E26/1/4 (no leading zeros). */
export function formatMainRef({ main_ref_year, main_ref_month, main_ref_seq }, companyName) {
  if (!main_ref_year || !main_ref_month || !main_ref_seq) return ''
  return buildMainRef(main_ref_year, main_ref_month, main_ref_seq, companyName)
}

/** Formats sub reference for display: T1/4 (no leading zeros). */
export function formatSubRef({ sub_ref_series, sub_ref_month, sub_ref_seq }) {
  if (!sub_ref_series || !sub_ref_month || !sub_ref_seq) return ''
  return `${sub_ref_series}${sub_ref_month}/${sub_ref_seq}`
}

/**
 * Returns the next available main-ref sequence for a company in a given year + month.
 *
 * Gap-filling behavior (Day 14 update): if previously-used reference numbers
 * have been freed by deleting their expenses, the smallest such number is
 * returned BEFORE allocating a brand-new one. This keeps the sequence
 * contiguous when the user deletes mistaken entries.
 *
 * Example:
 *   Existing seqs in May 2026 = {1, 2, 4, 5}  (seq 3 was deleted)
 *   nextMainRefSeq → 3   (fills the gap)
 *   Existing seqs = {1, 2, 3, 4, 5}  (no gaps)
 *   nextMainRefSeq → 6   (allocates at end)
 */
export async function nextMainRefSeq(companyId, year, month) {
  const { data, error } = await supabase
    .from('expenses')
    .select('main_ref_seq')
    .eq('company_id', companyId)
    .eq('main_ref_year', year)
    .eq('main_ref_month', month)
  if (error) throw error
  const taken = new Set((data || []).map(r => Number(r.main_ref_seq)).filter(n => n > 0))
  let n = 1
  while (taken.has(n)) n++
  return n
}

/**
 * Allocates N main-ref sequence numbers for split portions (consecutive
 * where possible). Tries to fit a consecutive gap of size N first so
 * that splits remain visually grouped; falls back to allocating at the
 * end if no gap fits.
 *   Existing seqs = {1, 2, 4, 5}, count = 2  →  {3} can only fit 1, so allocates [6, 7]
 *   Existing seqs = {1, 5, 6}, count = 3      →  [2, 3, 4]  (gap fits)
 */
export async function nextMainRefSeqBatch(companyId, year, month, count) {
  const { data, error } = await supabase
    .from('expenses')
    .select('main_ref_seq')
    .eq('company_id', companyId)
    .eq('main_ref_year', year)
    .eq('main_ref_month', month)
  if (error) throw error
  const taken = new Set((data || []).map(r => Number(r.main_ref_seq)).filter(n => n > 0))
  const sorted = Array.from(taken).sort((a, b) => a - b)
  const max = sorted.length ? sorted[sorted.length - 1] : 0
  // Scan for a consecutive free run of size `count` starting from 1.
  let candidate = 1
  while (candidate <= max + 1) {
    let allFree = true
    for (let i = 0; i < count; i++) {
      if (taken.has(candidate + i)) { allFree = false; break }
    }
    if (allFree) {
      return Array.from({ length: count }, (_, i) => candidate + i)
    }
    candidate++
  }
  // Shouldn't reach here, but as a safety net allocate strictly past the max.
  const start = max + 1
  return Array.from({ length: count }, (_, i) => start + i)
}

/**
 * Returns the next available sub-ref sequence for a company + series + month.
 * Same gap-filling behavior as nextMainRefSeq — deleted sub-refs are
 * reused on the next insert before allocating a fresh one.
 * Used for auto-assigning T (Travel) and R (Reimbursable) sub-references.
 */
export async function nextSubRefSeq(companyId, series, month) {
  const { data, error } = await supabase
    .from('expenses')
    .select('sub_ref_seq')
    .eq('company_id', companyId)
    .eq('sub_ref_series', series)
    .eq('sub_ref_month', month)
  if (error) throw error
  const taken = new Set((data || []).map(r => Number(r.sub_ref_seq)).filter(n => n > 0))
  let n = 1
  while (taken.has(n)) n++
  return n
}

/**
 * Decides which sub-ref series to assign based on category and reimbursable flag.
 * Returns:
 *   - 'R' if isReimbursable is true (R always wins)
 *   - category.sub_ref_series if set (T or S)
 *   - null otherwise
 */
export function decideSubRefSeries(category, isReimbursable) {
  if (isReimbursable) return 'R'
  return category?.sub_ref_series || null
}

/**
 * Returns true if S-series category requires manual sub-ref entry by user.
 * Currently: Cost of Labor (sub_ref_manual = true on the category row).
 */
export function isSubRefManual(category, isReimbursable) {
  if (isReimbursable) return false // R is always auto from payment date
  return !!category?.sub_ref_manual
}
