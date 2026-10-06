// =====================================================================
// Bank Parser ⇄ Invoicing Tracker bridge
// ---------------------------------------------------------------------
// When the user finalizes an incoming bank transaction as
//   • Client Payment       (category)
//   • Client Reimbursement (category)
// and types one or more invoice numbers in the Invoice # field, this
// helper finds the matching invoice rows in the `invoices` table
// (Invoicing Tracker — Clients tab) and marks them as paid using the
// bank transaction date as the payment date.
//
// Design rules (locked in with the user, May 25 2026):
//   • Only fill date_paid if blank — never overwrite a manual payment
//     date the user already typed in the Invoicing tab.
//   • If the typed number doesn't match any invoice → BLOCK the save
//     and surface a clear error listing the missing number(s). User
//     can then add the invoice in the Invoicing tab and retry.
//   • Status promotion: planned / issued / emailed → 'paid'. Don't
//     touch 'paid' / 'finalized' / 'voided' / 'skipped' (the user has
//     either confirmed those already or explicitly stepped them out
//     of the lifecycle).
//   • Pro Forma invoices are excluded (V21 design: pro_forma is not a
//     tax document and explicitly has no payment tracking).
//   • Credit Notes are excluded (credit notes are money OUT, refunding
//     the client — they shouldn't match an incoming payment).
//
// The helper is async and assumes a Supabase client is injected — the
// caller passes it so this file can be unit-tested with a mock.
// =====================================================================

// Expense category names that trigger auto-payment matching when the
// bank tx is finalized. These come from `expense_categories` rows
// seeded at app setup.
export const PAYMENT_TRIGGER_CATEGORY_NAMES = [
  'Client Payment',
  'Client Reimbursement',
]

// invoice_type values we never auto-mark as paid (see header for why).
const NON_PAYABLE_INVOICE_TYPES = new Set(['pro_forma', 'credit_note'])

// Statuses that get auto-promoted to 'paid' when we set date_paid.
// Anything outside this set we leave alone so manual lifecycle work
// isn't clobbered.
const PROMOTABLE_STATUSES = new Set(['planned', 'issued', 'emailed'])

// ---------------------------------------------------------------------
// Parse the free-text invoice_number column into a clean list of tokens.
//
// The Bank Parser's Invoice # field accepts comma-separated values for
// the case where one bank settlement covers multiple invoices, e.g.
//   "2026-03-001, 2026-03-002"
// We split on commas, trim, drop blanks and dedupe.
// ---------------------------------------------------------------------
export function parseInvoiceNumbers(raw) {
  if (!raw || typeof raw !== 'string') return []
  const seen = new Set()
  const tokens = []
  for (const t of raw.split(',')) {
    const trimmed = t.trim()
    if (!trimmed) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    tokens.push(trimmed)
  }
  return tokens
}

// ---------------------------------------------------------------------
// Normalize an invoice number for matching, so cosmetic differences
// don't block a save:
//   "INV 2026/08/004", "Inv. No 2026-08-004", "2026/8/4", "#2026.08.004"
//     → "2026/8/4"
// Drops a leading INV / INVOICE / NO / # label, upper-cases, splits on
// any separator (space - / . _) and strips leading zeros from numeric
// parts. Credit notes ("2026-004" → "2026/4") stay distinct from
// monthly invoices because they have fewer parts.
// ---------------------------------------------------------------------
export function normalizeInvoiceNumber(raw) {
  if (raw == null) return ''
  let s = String(raw).toUpperCase().trim()
  s = s.replace(/^(?:INVOICE|INV|NUMBER|NO|NR|[#:.\s])+/, '')
  const parts = s.split(/[\s\-\/._]+/).filter(Boolean)
  return parts.map(p => (/^\d+$/.test(p) ? String(parseInt(p, 10)) : p)).join('/')
}

// ---------------------------------------------------------------------
// Look up the invoice rows that match the typed invoice numbers for
// this company. Returns three buckets so the caller can render a
// precise error message:
//   • found     — invoice rows that uniquely match a typed number
//                 AND are payable (not pro_forma / credit_note)
//   • missing   — typed numbers that have no payable invoice in the DB
//                 (includes numbers that ONLY match a pro_forma or
//                 credit_note — those count as missing for payment
//                 purposes)
//   • conflicts — typed numbers that match payable invoices belonging
//                 to MORE THAN ONE client (a real numbering mistake —
//                 surface it so the user can fix it in the Invoicing
//                 tab). Several rows sharing a number for the SAME
//                 client are NOT a conflict: that is one issued
//                 document covering several months (V27 per-month
//                 splits), and every one of its rows gets marked paid.
// ---------------------------------------------------------------------
export async function findInvoicesByNumbers({ supabase, companyId, invoiceNumbers }) {
  if (!supabase || !companyId || !invoiceNumbers?.length) {
    return { found: [], missing: [], conflicts: [] }
  }

  // Match on a NORMALIZED key, not the raw text: the printed document
  // says "INV 2026/08/004" while Issue Invoice stores "2026/08/004", and
  // older rows use "2026-08-004". Fetch the company's numbered invoices
  // (paged — PostgREST caps a response at 1000 rows) and compare keys.
  const data = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, invoice_type, date_paid, status, client_id')
      .eq('company_id', companyId)
      .not('invoice_number', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    data.push(...(page || []))
    if (!page || page.length < PAGE) break
  }

  // Group ALL hits by normalized number first (including non-payable,
  // so we can give a more helpful error when a typed number ONLY
  // matches a pro_forma or credit_note).
  const allByNumber = new Map()
  for (const row of data) {
    const key = normalizeInvoiceNumber(row.invoice_number)
    if (!key) continue
    if (!allByNumber.has(key)) allByNumber.set(key, [])
    allByNumber.get(key).push(row)
  }

  const found = []
  const missing = []
  const conflicts = []
  for (const num of invoiceNumbers) {
    const hits = allByNumber.get(normalizeInvoiceNumber(num)) || []
    const payable = hits.filter(r => !NON_PAYABLE_INVOICE_TYPES.has(r.invoice_type))
    if (payable.length === 0) {
      missing.push(num)
    } else if (payable.length > 1) {
      // Several rows carry this number. Two very different situations:
      //
      //   a) ONE issued document covering several months for the SAME
      //      client — e.g. an August invoice billing the June and July
      //      fees. V27 stores those as one invoice row per source month
      //      (represents_period_*), all sharing the same invoice_number,
      //      because VAT/VIES treats each month's fee as its own
      //      service. Legitimate: the client pays the document once, so
      //      every row belonging to it must be marked paid together.
      //
      //   b) The same number reused across DIFFERENT clients — a real
      //      numbering mistake. Keep blocking so the user can fix it.
      const clientIds = new Set(payable.map(r => r.client_id))
      if (clientIds.size === 1) {
        found.push(...payable)
      } else {
        conflicts.push({ number: num, rows: payable })
      }
    } else {
      found.push(payable[0])
    }
  }
  return { found, missing, conflicts }
}

// ---------------------------------------------------------------------
// Mark each invoice as paid (only when date_paid is currently blank).
//
// Returns { updated, skipped } so the caller can log or surface a
// confirmation message ("✓ Marked 2 invoices as paid").
//
// `skipped` is the list of invoice_numbers that already had a
// date_paid value — we never overwrite those.
// ---------------------------------------------------------------------
export async function markInvoicesPaid({ supabase, invoices, paymentDate }) {
  if (!supabase || !invoices?.length || !paymentDate) {
    return { updated: [], skipped: [] }
  }

  const updated = []
  const skipped = []

  for (const inv of invoices) {
    if (inv.date_paid) {
      // Already paid — respect the existing manual value.
      skipped.push(inv.invoice_number)
      continue
    }

    const patch = {
      date_paid:  paymentDate,
      updated_at: new Date().toISOString(),
    }
    if (PROMOTABLE_STATUSES.has(inv.status)) {
      patch.status = 'paid'
    }

    const { error } = await supabase
      .from('invoices')
      .update(patch)
      .eq('id', inv.id)
    if (error) {
      // Re-throw with a clearer message so the modal can show
      // exactly which invoice failed.
      const wrapped = new Error(
        `Could not mark invoice ${inv.invoice_number} as paid: ${error.message || error}`
      )
      wrapped.cause = error
      throw wrapped
    }
    updated.push(inv.invoice_number)
  }

  return { updated, skipped }
}

// ---------------------------------------------------------------------
// Build a user-facing error message for a missing / conflicting set.
// Returns null if there's nothing to complain about.
// ---------------------------------------------------------------------
export function buildInvoiceMatchError({ missing, conflicts }) {
  const parts = []
  if (missing?.length) {
    parts.push(
      `Invoice ${missing.length === 1 ? 'number' : 'numbers'} ` +
      missing.map(n => `"${n}"`).join(', ') +
      ` not found in the Invoicing tab. Add ${missing.length === 1 ? 'it' : 'them'} there first, then save this transaction.`
    )
  }
  if (conflicts?.length) {
    parts.push(
      `Invoice ${conflicts.length === 1 ? 'number' : 'numbers'} ` +
      conflicts.map(c => `"${c.number}"`).join(', ') +
      ` ${conflicts.length === 1 ? 'is' : 'are'} used by more than one CLIENT in the Invoicing tab. Fix the duplicate numbering there before saving.` +
      ` (Several rows under one client sharing a number is fine — that's one invoice covering several months.)`
    )
  }
  return parts.length ? parts.join(' ') : null
}
