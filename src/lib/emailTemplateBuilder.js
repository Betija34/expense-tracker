// =====================================================================
// Email template builder for the Invoicing tracker (Step 4 of Phase 2)
// ---------------------------------------------------------------------
// Pure functions that turn a set of invoice rows + a client row into a
// ready-to-send email (subject, body, to, cc). No I/O, no Supabase
// calls — easy to unit-test and reason about.
//
// Spec locked with the user on May 25 2026 — see TaskUpdate #46 for
// the full specification this file implements.
// =====================================================================

// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------

// Subject-line / body label for each invoice_type. Multiple types can
// share a label (e.g. monthly_fee and one_off_service both render as
// "Consultancy Service Fee") — the bundle-build code dedupes.
export const LABEL_FOR_TYPE = {
  monthly_fee:           'Consultancy Service Fee',
  one_off_service:       'Consultancy Service Fee',
  fixed_expense:         'Fixed Expense Reimbursement',
  variable_expense:      'Expense Reimbursement',
  one_off_reimbursement: 'Expense Reimbursement',
  credit_note:           'Credit Note',
  pro_forma:             'Pro Forma',
}

// Sort order for labels in the subject. Lower number = appears first.
// Ensures "Consultancy Service Fee" always comes before reimbursements,
// regardless of insert order in the bundle.
const LABEL_SORT_ORDER = {
  'Consultancy Service Fee':       1,
  'Fixed Expense Reimbursement':   2,
  'Expense Reimbursement':         3,
  'Credit Note':                   90,   // standalone, never bundled
  'Pro Forma':                     91,   // standalone, never bundled
}

// invoice_types that CAN bundle together in one email. Outside this
// set, each invoice always gets its own email.
export const BUNDLE_ELIGIBLE_TYPES = new Set([
  'monthly_fee',
  'fixed_expense',
  'variable_expense',
])

// invoice_types treated as reimbursements (drives whether the body's
// "expense report" sentence appears).
const REIMBURSEMENT_TYPES = new Set([
  'fixed_expense',
  'variable_expense',
  'one_off_reimbursement',
])

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

// "May 2026" from (5, 2026). Defensive — returns empty string when
// inputs are missing or out of range.
export function formatMonthYear(month, year) {
  const m = parseInt(month, 10)
  const y = parseInt(year, 10)
  if (!(m >= 1 && m <= 12) || !Number.isFinite(y)) return ''
  return `${MONTH_NAMES[m - 1]} ${y}`
}

// Join a list of strings in natural English:
//   1 item:  "A"
//   2 items: "A and B"
//   3+:      "A, B and C"   (Oxford-comma style favored by the user)
export function joinWithAnd(items) {
  const arr = (items || []).filter(Boolean)
  if (arr.length === 0) return ''
  if (arr.length === 1) return arr[0]
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`
  return `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`
}

// Extract issue month/year from an invoice row's date_issued (ISO date
// "YYYY-MM-DD") and return { month, year }. Returns nulls when the
// invoice hasn't been issued yet.
function extractIssueMonthYear(invoice) {
  if (!invoice?.date_issued) return { month: null, year: null }
  const [y, m] = String(invoice.date_issued).split('-').map(Number)
  if (!(m >= 1 && m <= 12) || !Number.isFinite(y)) return { month: null, year: null }
  return { month: m, year: y }
}

// ---------------------------------------------------------------------
// Subject line builders
// ---------------------------------------------------------------------

// Build the subject line for a bundle (one or more invoices in the
// bundle-eligible group OR a single standalone one_off invoice).
//
// Examples:
//   1 monthly_fee:
//     "Consultancy Service Fee invoice issued in May 2026 — Project Blue Lagoon"
//   monthly_fee + fixed_expense:
//     "Consultancy Service Fee and Fixed Expense Reimbursement invoices issued in May 2026 — Project Blue Lagoon"
//   monthly_fee + fixed_expense + variable_expense:
//     "Consultancy Service Fee, Fixed Expense Reimbursement and Expense Reimbursement invoices issued in May 2026 — Project Blue Lagoon"
export function buildBundleSubject(invoices, client) {
  if (!invoices?.length || !client) return ''

  // Dedupe + sort labels. We render each label at most once, in the
  // canonical order (consultancy first, then fixed, then variable).
  const labelSet = new Set(invoices.map(inv => LABEL_FOR_TYPE[inv.invoice_type] || inv.invoice_type))
  const sortedLabels = [...labelSet].sort(
    (a, b) => (LABEL_SORT_ORDER[a] ?? 50) - (LABEL_SORT_ORDER[b] ?? 50)
  )
  const labelPart = joinWithAnd(sortedLabels)

  // Plural / singular noun based on invoice count (not label count).
  const noun = invoices.length === 1 ? 'invoice' : 'invoices'

  // Issue month/year — take from the first invoice that has a
  // date_issued (all bundle members are required to share the issue
  // month, see groupInvoicesIntoEmails enforcement).
  const issued = invoices.map(extractIssueMonthYear).find(d => d.month && d.year)
  const issuedLabel = issued ? formatMonthYear(issued.month, issued.year) : ''

  const trade = client.trade_name || ''
  return `${labelPart} ${noun} issued in ${issuedLabel} — Project ${trade}`.trim()
}

// Subject for a Credit Note (always own email).
export function buildCreditNoteSubject(invoice, client) {
  const { month, year } = extractIssueMonthYear(invoice)
  return `Credit Note issued in ${formatMonthYear(month, year)} — Project ${client.trade_name || ''}`.trim()
}

// Subject for a Pro Forma (always own email).
export function buildProFormaSubject(invoice, client) {
  const { month, year } = extractIssueMonthYear(invoice)
  return `Pro Forma issued in ${formatMonthYear(month, year)} — Project ${client.trade_name || ''}`.trim()
}

// ---------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------

// Build the per-invoice clause for the body's first sentence.
//   monthly_fee / one_off_service: includes period inline.
//     "Consultancy Service Fee invoice, May 2026"
//   fixed_expense:
//     "Fixed Expense Reimbursement invoice"
//   variable_expense / one_off_reimbursement:
//     "Expense Reimbursement invoice"
function buildInvoiceClause(invoice) {
  const label = LABEL_FOR_TYPE[invoice.invoice_type] || invoice.invoice_type
  const type  = invoice.invoice_type
  if (type === 'monthly_fee' || type === 'one_off_service') {
    const periodLabel = formatMonthYear(invoice.period_month, invoice.period_year)
    return periodLabel
      ? `${label} invoice, ${periodLabel}`
      : `${label} invoice`
  }
  return `${label} invoice`
}

// Build the body for a bundle (one or more bundle-eligible invoices,
// or a single standalone one_off invoice).
//
// Structure (locked with user May 25 2026):
//   Dear {contact_name},
//
//   {Clauses joined with " and " (Oxford-comma for 3+)} for Project {trade_name}.
//   {If any reimbursement invoice in bundle:}
//   In relation to expenses, according to {reimbursement period} expense report, together with supporting documents.
//
//   Warm regards,
//   Beti
export function buildBundleBody(invoices, client) {
  if (!invoices?.length || !client) return ''

  const contact = client.contact_name || ''
  const trade   = client.trade_name   || ''

  const clauses = invoices.map(buildInvoiceClause)
  const firstSentence = `${joinWithAnd(clauses)} for Project ${trade}.`

  // Second sentence: only when at least one invoice in the bundle is
  // a reimbursement type. Period reference comes from THAT invoice's
  // period_month/period_year (the month being reimbursed).
  const reimbInvoice = invoices.find(inv => REIMBURSEMENT_TYPES.has(inv.invoice_type))
  let secondSentence = ''
  if (reimbInvoice) {
    const reimbPeriod = formatMonthYear(reimbInvoice.period_month, reimbInvoice.period_year)
    if (reimbPeriod) {
      secondSentence = `In relation to expenses, according to ${reimbPeriod} expense report, together with supporting documents.`
    }
  }

  // Two-line vs three-line body depending on whether sentence 2 fires.
  return [
    `Dear ${contact},`,
    '',
    secondSentence ? `${firstSentence}\n${secondSentence}` : firstSentence,
    '',
    'Warm regards,',
    'Beti',
  ].join('\n')
}

// Body for a Credit Note (own email).
// Note: original_invoice_number lives outside the invoices table for
// now — we either expose a field, or accept it as an extra prop the UI
// fills in. For v1 we accept it via `extras.originalInvoiceNumber` so
// the modal can prompt for it before send.
export function buildCreditNoteBody(invoice, client, extras = {}) {
  const contact   = client.contact_name || ''
  const original  = extras.originalInvoiceNumber || '__'
  const creditNum = invoice.invoice_number || '__'
  return [
    `Dear ${contact},`,
    '',
    `Enclosed please find credit note to invoice ${original} with credit note number ${creditNum}.`,
    '',
    'Warm regards,',
    'Beti',
  ].join('\n')
}

// Body for a Pro Forma (own email).
export function buildProFormaBody(invoice, client) {
  const contact = client.contact_name || ''
  const trade   = client.trade_name   || ''
  const { month, year } = extractIssueMonthYear(invoice)
  return [
    `Dear ${contact},`,
    '',
    `Pro Forma issued in ${formatMonthYear(month, year)} for Project ${trade}.`,
    '',
    'Warm regards,',
    'Beti',
  ].join('\n')
}

// ---------------------------------------------------------------------
// Bundle grouping
// ---------------------------------------------------------------------

// Group a flat list of invoices for a single client into one or more
// emails per spec:
//   • Invoices of type {monthly_fee, fixed_expense, variable_expense}
//     that share the SAME issue month bundle together.
//   • one_off_service, one_off_reimbursement, credit_note, pro_forma
//     each go in their own email.
//   • Invoices without date_issued are skipped (can't be sent yet).
//
// Returns an array of { kind, invoices, subject, body }. The caller
// renders one card per email and lets the user open/edit/send each.
//
//   kind: 'bundle' | 'one_off' | 'credit_note' | 'pro_forma'
export function groupInvoicesIntoEmails(invoices, client) {
  const out = []
  if (!invoices?.length || !client) return out

  // Buckets
  const bundleByIssueMonth = new Map()   // "YYYY-MM" → [invoices]
  const standalone = []                  // one_off_service, one_off_reimbursement, credit_note, pro_forma

  for (const inv of invoices) {
    if (!inv.date_issued) continue
    if (BUNDLE_ELIGIBLE_TYPES.has(inv.invoice_type)) {
      const { month, year } = extractIssueMonthYear(inv)
      if (!month || !year) continue
      const key = `${year}-${String(month).padStart(2, '0')}`
      if (!bundleByIssueMonth.has(key)) bundleByIssueMonth.set(key, [])
      bundleByIssueMonth.get(key).push(inv)
    } else {
      standalone.push(inv)
    }
  }

  // Sort bundles by issue month ascending so the user sees April before May.
  const bundleKeys = [...bundleByIssueMonth.keys()].sort()
  for (const key of bundleKeys) {
    const items = bundleByIssueMonth.get(key)
    out.push({
      kind:     'bundle',
      invoices: items,
      subject:  buildBundleSubject(items, client),
      body:     buildBundleBody(items, client),
    })
  }

  // Standalone — each gets its own email card.
  for (const inv of standalone) {
    const t = inv.invoice_type
    if (t === 'credit_note') {
      out.push({
        kind:     'credit_note',
        invoices: [inv],
        subject:  buildCreditNoteSubject(inv, client),
        body:     buildCreditNoteBody(inv, client),
      })
    } else if (t === 'pro_forma') {
      out.push({
        kind:     'pro_forma',
        invoices: [inv],
        subject:  buildProFormaSubject(inv, client),
        body:     buildProFormaBody(inv, client),
      })
    } else {
      // one_off_service or one_off_reimbursement — same subject/body
      // shape as bundle but only ever 1 invoice.
      out.push({
        kind:     'one_off',
        invoices: [inv],
        subject:  buildBundleSubject([inv], client),
        body:     buildBundleBody([inv], client),
      })
    }
  }

  return out
}

// ---------------------------------------------------------------------
// mailto: URL builder
// ---------------------------------------------------------------------
// Build a mailto: link that prefills To, Cc, Subject, Body. The link
// will open the user's default mail client (Apple Mail, Outlook, Gmail
// via OS handler, etc.). She still has to attach the PDF(s) manually
// from her file system before sending — mailto: can't carry attachments
// per RFC 6068, and there's no web-based "compose with attachment"
// standard.
export function buildMailtoUrl({ to, cc, subject, body }) {
  const params = new URLSearchParams()
  if (cc?.trim())      params.set('cc', cc.trim())
  if (subject?.trim()) params.set('subject', subject.trim())
  if (body?.trim())    params.set('body', body)

  const toPart = (to || '').trim()
  const qs     = params.toString().replace(/\+/g, '%20')   // spaces as %20, not +
  return `mailto:${encodeURIComponent(toPart)}${qs ? `?${qs}` : ''}`
}
