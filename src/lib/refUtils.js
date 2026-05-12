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

/** Formats main reference for display: 26/1/4 (no leading zeros). */
export function formatMainRef({ main_ref_year, main_ref_month, main_ref_seq }) {
  if (!main_ref_year || !main_ref_month || !main_ref_seq) return ''
  const yy = String(main_ref_year).slice(-2)
  return `${yy}/${main_ref_month}/${main_ref_seq}`
}

/** Formats sub reference for display: T1/4 (no leading zeros). */
export function formatSubRef({ sub_ref_series, sub_ref_month, sub_ref_seq }) {
  if (!sub_ref_series || !sub_ref_month || !sub_ref_seq) return ''
  return `${sub_ref_series}${sub_ref_month}/${sub_ref_seq}`
}

/**
 * Returns the next available main-ref sequence for a company in a given year + month.
 * Reads max(main_ref_seq) from expenses WHERE company_id, main_ref_year, main_ref_month.
 */
export async function nextMainRefSeq(companyId, year, month) {
  const { data, error } = await supabase
    .from('expenses')
    .select('main_ref_seq')
    .eq('company_id', companyId)
    .eq('main_ref_year', year)
    .eq('main_ref_month', month)
    .order('main_ref_seq', { ascending: false })
    .limit(1)
  if (error) throw error
  const max = data && data.length > 0 ? Number(data[0].main_ref_seq || 0) : 0
  return max + 1
}

/**
 * Allocates N consecutive main-ref sequence numbers for split portions.
 * Returns an array of N seqs starting at the next available number.
 *   nextMainRefSeqBatch(companyId, 2026, 1, 3)  →  [4, 5, 6]
 */
export async function nextMainRefSeqBatch(companyId, year, month, count) {
  const start = await nextMainRefSeq(companyId, year, month)
  return Array.from({ length: count }, (_, i) => start + i)
}

/**
 * Returns the next available sub-ref sequence for a company + series + month.
 * Used for auto-assigning T (Travel) and R (Reimbursable) sub-references.
 */
export async function nextSubRefSeq(companyId, series, month) {
  const { data, error } = await supabase
    .from('expenses')
    .select('sub_ref_seq')
    .eq('company_id', companyId)
    .eq('sub_ref_series', series)
    .eq('sub_ref_month', month)
    .order('sub_ref_seq', { ascending: false })
    .limit(1)
  if (error) throw error
  const max = data && data.length > 0 ? Number(data[0].sub_ref_seq || 0) : 0
  return max + 1
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
