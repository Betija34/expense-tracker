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

// invoice_types that trigger the body's "In relation to expenses,
// according to {month} expense report, together with supporting
// documents." sentence.
//
// fixed_expense is intentionally NOT included: fixed reimbursements
// are contracted / pre-agreed amounts (a known recurring cost the
// client pays back), so referencing an "expense report" doesn't apply.
// The sentence only makes sense for variable_expense and
// one_off_reimbursement, which are based on actual expenses incurred
// in a specific month and need supporting documentation.
const EXPENSE_REPORT_TYPES = new Set([
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
//     "Consultancy Service Fee invoice 2026-05-010, May 2026"
//   fixed_expense:
//     "Fixed Expense Reimbursement invoice 2026-05-011"
//   variable_expense / one_off_reimbursement:
//     "Expense Reimbursement invoice 2026-05-012"
//
// The invoice number is included inline (matching the credit-note
// template's "invoice 2026-04-007" wording) so the user can spot
// which PDF to attach when she's reviewing the email in her mail
// client. When invoice_number is blank, we omit it gracefully.
function buildInvoiceClause(invoice) {
  const label    = LABEL_FOR_TYPE[invoice.invoice_type] || invoice.invoice_type
  const type     = invoice.invoice_type
  const number   = invoice.invoice_number?.trim()
  const numPart  = number ? ` ${number}` : ''
  if (type === 'monthly_fee' || type === 'one_off_service') {
    const periodLabel = formatMonthYear(invoice.period_month, invoice.period_year)
    return periodLabel
      ? `${label} invoice${numPart}, ${periodLabel}`
      : `${label} invoice${numPart}`
  }
  return `${label} invoice${numPart}`
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

  // Sort invoices by canonical label order (Consultancy Service Fee
  // first, then Fixed Expense Reimbursement, then Expense
  // Reimbursement) so the body reads consistently with the subject.
  // Without this, the natural date_issued ordering can produce
  // clauses in an awkward sequence (e.g. Expense Reimbursement
  // landing before Consultancy Service Fee).
  const orderedInvoices = [...invoices].sort((a, b) => {
    const la = LABEL_FOR_TYPE[a.invoice_type] || a.invoice_type
    const lb = LABEL_FOR_TYPE[b.invoice_type] || b.invoice_type
    return (LABEL_SORT_ORDER[la] ?? 50) - (LABEL_SORT_ORDER[lb] ?? 50)
  })

  const clauses = orderedInvoices.map(buildInvoiceClause)
  // Body opens with "Enclosed please find …" to mirror the credit-note
  // body's wording and signal that PDF(s) are attached. (Yes, mailto:
  // can't actually carry attachments — the user attaches by hand in
  // the mail client before sending. The phrasing tells the recipient
  // what to expect.)
  const firstSentence = `Enclosed please find ${joinWithAnd(clauses)} for Project ${trade}.`

  // Second sentence: only when at least one invoice in the bundle
  // actually relates to an expense report (variable_expense or
  // one_off_reimbursement — NOT fixed_expense). Fixed wording per
  // user spec (May 25 2026): "Also, enclosed relevant expense report
  // and supporting documents." — the month reference is intentionally
  // dropped (the invoice PDF and the expense report PDF the user
  // attaches both encode the period in their filenames / contents,
  // so the body sentence stays generic and reusable).
  const reimbInvoice = invoices.find(inv => EXPENSE_REPORT_TYPES.has(inv.invoice_type))
  const secondSentence = reimbInvoice
    ? 'Also, enclosed relevant expense report and supporting document scans.'
    : ''

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

// ---------------------------------------------------------------------
// Outlook on the web compose URL builder
// ---------------------------------------------------------------------
// Build an Outlook "deeplink/compose" URL that prefills To, Cc, Subject
// and Body and opens in a new browser tab. It composes from whatever
// account is signed into Outlook on the web — the company
// accounts@rabonaholdings.com account — regardless of the Mac's default
// mail app. This deliberately bypasses mailto:/Apple Mail so company
// invoices never go out from a personal account.
//
// Host is outlook.office.com (Microsoft 365 work/school accounts). If
// the account were a personal outlook.com mailbox this would instead be
// https://outlook.live.com/mail/0/deeplink/compose. Like mailto:, this
// can't carry attachments — the PDF(s) are attached by hand in the
// compose window before sending.
export function buildOutlookComposeUrl({ to, cc, subject, body }) {
  const params = new URLSearchParams()
  const toPart = (to || '').trim()
  if (toPart)          params.set('to', toPart)
  if (cc?.trim())      params.set('cc', cc.trim())
  if (subject?.trim()) params.set('subject', subject.trim())
  if (body?.trim())    params.set('body', body)

  const qs = params.toString().replace(/\+/g, '%20')   // spaces as %20, not +
  return `https://outlook.office.com/mail/deeplink/compose${qs ? `?${qs}` : ''}`
}

// =====================================================================
// Accountant monthly summary email (added Nov 3 2026)
// ---------------------------------------------------------------------
// One email per month to the external accountants (Mastserve) listing
// every invoice ISSUED in that calendar month (by date_issued, not by
// billing period) across both companies. Wording mirrors what Betija
// has been sending by hand since Oct 2025, e.g. subject
// "Rabona Invoices issued September 2026" and body
// "Enclosed please find invoices issued September 2026 from Rabona.
//  Please note that there were no invoices issued from Espargos this month."
//
// Per invoice: number | project | description | issue date | total.
// Credit notes sit right after the invoice they credit. There is no
// link column, so the original is found from the invoice number written
// in the credit note's description ("Credit note to invoice 2026-09-004",
// the Issue Invoice default); failing that, after the same project's
// last invoice in the list; failing that, at the end of the list.
// Pro formas are excluded (not tax invoices).
//
// A second section shows the expense reimbursement CALCULATED for the
// month per project (same rule as Client Invoicing: reimbursable expenses
// dated in the month, matched on the project's trade/legal name), with
// whether it is invoiced, deferred to a later month, or still to be
// invoiced.
// =====================================================================

export const ACCOUNTANT_DEFAULT_TO      = 'panayiota.panayiotou@mastserve.com'
export const ACCOUNTANT_DEFAULT_CONTACT = 'Panayiota'

// Short company label used in the wording ("Rabona", "Espargos").
export function shortCompanyName(name) {
  if (!name) return ''
  return String(name).replace(/\s+(Holdings|Ltd|Limited)\b.*$/i, '').trim()
}

export function fmtEur(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return '€' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso) {
  if (!iso) return ''
  const [y, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

// Digits-only form so "2026-09-004", "2026/09/004" and "2026:09:004" match.
const numKey = (s) => String(s || '').replace(/\D/g, '')

// Order a company's issued documents: invoices by number, each credit
// note directly after the invoice it credits. Returns
// [{ inv, creditFor: <invoice row|null>, creditForNumber: string|null }]
export function orderWithCreditNotes(invoices) {
  const byNum = (a, b) => String(a.invoice_number || '').localeCompare(String(b.invoice_number || ''), undefined, { numeric: true })
  const regular = invoices.filter(i => i.invoice_type !== 'credit_note').sort(byNum)
  const credits = invoices.filter(i => i.invoice_type === 'credit_note').sort(byNum)
  const out = regular.map(inv => ({ inv, creditFor: null, creditForNumber: null }))

  for (const cn of credits) {
    // 1) invoice number named in the description
    const desc = String(cn.description || '')
    const m = desc.match(/\binv(?:oice)?\.?\s*(?:no\.?|number)?\s*[:#]?\s*([0-9][0-9\-\/:.]*[0-9])/i)
    const named = m ? m[1] : null
    let idx = -1
    if (named) idx = out.map(r => r.inv.invoice_type !== 'credit_note' ? numKey(r.inv.invoice_number) : null).lastIndexOf(numKey(named))
    // 2) after the same project's last invoice
    if (idx === -1) {
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k].inv.client_id === cn.client_id && out[k].inv.invoice_type !== 'credit_note') { idx = k; break }
      }
    }
    const row = { inv: cn, creditFor: idx >= 0 && named && numKey(out[idx].inv.invoice_number) === numKey(named) ? out[idx].inv : null, creditForNumber: named }
    if (idx === -1) { out.push(row); continue }
    // keep several credit notes for the same invoice in number order
    let at = idx + 1
    while (at < out.length && out[at].inv.invoice_type === 'credit_note') at++
    out.splice(at, 0, row)
  }
  return out
}

// Short "what is it" label for the accountant list (not the full printed
// invoice wording):
//   monthly_fee           → "October 2026 fee"   (the month the fee is FOR)
//   one_off_service       → the invoice's own description, as printed
//   fixed_expense         → "October 2026 fixed expenses" (month it is FOR)
//   variable_expense      → "Expenses as of August 2026 expense report"
//                           (months from covered_expense_periods, V37)
//   one_off_reimbursement → "Expense reimbursement"
//   credit_note           → "Credit note to invoice 2026-10-001"
// "Expenses as of August 2026 expense report", or for a bundle
// "Expenses as of August and September 2026 expense reports".
// Months come from covered_expense_periods (V37, set by Issue Invoice);
// failing that, the "Expenses as of ... expense report" phrase already in
// the description; failing that, the invoice's period month.
export function expenseReportLabel(inv) {
  let periods = Array.isArray(inv.covered_expense_periods)
    ? inv.covered_expense_periods
        .map(p => ({ year: Number(p.year), month: Number(p.month) }))
        .filter(p => p.month >= 1 && p.month <= 12 && Number.isFinite(p.year))
    : []
  if (!periods.length) {
    const desc = String(inv.description || '')
    const m = desc.match(/Expenses as of .*?expense reports?/i)
    if (m) return m[0].replace(/\s+/g, ' ')
    // Older Client-Invoicing wording: "Jun (€630.39) + Jul (€342.05) reimbursable expenses"
    const py = inv.period_year, pm = inv.period_month
    const found = [...desc.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:\s+(\d{4}))?\s*\(/gi)]
    if (found.length && py) {
      periods = found.map(f => {
        const mo = MONTH_NAMES.findIndex(n => n.slice(0, 3).toLowerCase() === f[1].toLowerCase()) + 1
        const yr = f[2] ? Number(f[2]) : (pm && mo > pm ? py - 1 : py)
        return { year: yr, month: mo }
      })
    }
    if (!periods.length) {
      const y = inv.represents_period_year || inv.period_year
      const mo = inv.represents_period_month || inv.period_month
      if (formatMonthYear(mo, y)) periods = [{ year: y, month: mo }]
    }
  }
  if (!periods.length) return 'Expense reimbursement'
  periods.sort((a, b) => (a.year - b.year) || (a.month - b.month))
  // Group months by year: "August and September 2026", "December 2025 and January 2026"
  const byYear = []
  for (const p of periods) {
    const last = byYear[byYear.length - 1]
    const name = MONTH_NAMES[p.month - 1]
    if (last && last.year === p.year) { if (!last.months.includes(name)) last.months.push(name) }
    else byYear.push({ year: p.year, months: [name] })
  }
  const text = joinWithAnd(byYear.map(g => `${joinWithAnd(g.months)} ${g.year}`))
  return `Expenses as of ${text} expense report${periods.length > 1 ? 's' : ''}`
}

export function accountantShortLabel(inv, row = {}) {
  const y = inv.represents_period_year || inv.period_year
  const m = inv.represents_period_month || inv.period_month
  switch (inv.invoice_type) {
    case 'monthly_fee':           return formatMonthYear(m, y) ? `${formatMonthYear(m, y)} fee` : 'Monthly fee'
    case 'one_off_service':       return String(inv.description || '').replace(/\s+/g, ' ').trim() || 'One-off service fee'
    case 'fixed_expense':         return formatMonthYear(m, y) ? `${formatMonthYear(m, y)} fixed expenses` : 'Fixed expense reimbursement'
    case 'variable_expense':      return expenseReportLabel(inv)
    case 'one_off_reimbursement': return 'Expense reimbursement'
    case 'credit_note':           return row.creditForNumber ? `Credit note to invoice ${row.creditForNumber}` : 'Credit note'
    default:                      return LABEL_FOR_TYPE[inv.invoice_type] || inv.invoice_type
  }
}

// One line per document:
//   "2026-09-001 | Project Blue Lagoon | <description> | Issued 02/09/2026 | Total €5,000.00"
// Credit notes are indented under their invoice and shown as a negative.
export function buildAccountantInvoiceLine(row, client) {
  const inv = row.inv
  const isCN = inv.invoice_type === 'credit_note'
  const label = LABEL_FOR_TYPE[inv.invoice_type] || inv.invoice_type
  const desc  = accountantShortLabel(inv, row)
  const num   = inv.invoice_number || '(no number)'
  const total = isCN ? `−${fmtEur(Math.abs(Number(inv.amount_total) || 0))}` : fmtEur(inv.amount_total)
  let note = ''
  if (isCN && !row.creditFor && row.creditForNumber) note = ` (original invoice issued in an earlier month)`
  const parts = [
    isCN ? `   ↳ Credit Note ${num}` : num,
    `Project ${client?.trade_name || client?.legal_name || '?'}`,
    desc + (inv.status === 'voided' ? ' (VOIDED)' : '') + note,
    `Issued ${fmtDate(inv.date_issued)}`,
    `Total ${total}`,
  ]
  return parts.join(' | ')
}

// Expense reimbursement line, e.g.
//   "Project Kipseli: €812.40 — invoiced in 2026-10-004 (issued 30/10/2026)"
export function buildExpenseCalcLine(row, month, year) {
  const name = `Project ${row.client?.trade_name || row.client?.legal_name || '?'}`
  const amt  = fmtEur(row.calculated)
  switch (row.status) {
    case 'invoiced':
      return `${name}: ${amt} — invoiced in ${row.invoices.map(i => `${i.invoice_number || '(no number)'} (issued ${fmtDate(i.date_issued)})`).join(', ')}`
    case 'deferred':
      return `${name}: ${amt} — not invoiced yet; deferred to ${formatMonthYear(row.target.month, row.target.year)} and will be invoiced with that month's expense reimbursement`
    case 'frozen':
      return `${name}: ${amt} — project billing paused (frozen) for ${formatMonthYear(month, year)}; not invoiced`
    default:
      return `${name}: ${amt} — not invoiced yet; will be invoiced in a later month`
  }
}

// companies: [{ id, name, invoices: [...], expenseCalc: [rows] }] in display order
export function buildAccountantSubject(companies, month, year) {
  const withInv = companies.filter(c => c.invoices.length > 0).map(c => shortCompanyName(c.name))
  const who = withInv.length ? withInv.join(' & ') : companies.map(c => shortCompanyName(c.name)).join(' & ')
  return `${who} Invoices issued ${formatMonthYear(month, year)}`
}

export function buildAccountantBody(companies, clientsById, month, year, contact = ACCOUNTANT_DEFAULT_CONTACT) {
  const period = formatMonthYear(month, year)
  const withInv    = companies.filter(c => c.invoices.length > 0)
  const withoutInv = companies.filter(c => c.invoices.length === 0)
  const lines = [`Dear ${contact},`, '']

  if (withInv.length === 0) {
    lines.push(`Please note that there were no invoices issued from ${joinWithAnd(companies.map(c => shortCompanyName(c.name)))} in ${period}.`)
  } else {
    lines.push(`Enclosed please find invoices issued ${period} from ${joinWithAnd(withInv.map(c => shortCompanyName(c.name)))}.`)
    for (const c of withInv) {
      lines.push('')
      lines.push(`${shortCompanyName(c.name)} — invoices issued ${period}:`)
      for (const row of orderWithCreditNotes(c.invoices)) {
        lines.push(buildAccountantInvoiceLine(row, clientsById.get(row.inv.client_id)))
      }
    }
  }

  // Expense reimbursement calculated for the month, per company.
  for (const c of companies) {
    const rows = (c.expenseCalc || []).filter(r => r.calculated > 0)
    if (!rows.length) continue
    const total = rows.reduce((s, r) => s + r.calculated, 0)
    lines.push('')
    lines.push(`${shortCompanyName(c.name)} — expense reimbursement calculated for ${period} (total ${fmtEur(total)}):`)
    for (const r of rows) lines.push(buildExpenseCalcLine(r, month, year))
    if (rows.some(r => r.status === 'deferred' || r.status === 'pending')) {
      lines.push('Amounts not yet invoiced will be invoiced in a later month (or the month they are deferred to) and will appear in that month\'s list.')
    }
  }

  if (withInv.length && withoutInv.length) {
    lines.push('')
    lines.push(`Please note that there were no invoices issued from ${joinWithAnd(withoutInv.map(c => shortCompanyName(c.name)))} this month.`)
  }
  lines.push('', 'Warm regards,', 'Betija')
  return lines.join('\n')
}
