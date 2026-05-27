// =====================================================================
// Statement of Account (SOA) generator
// ---------------------------------------------------------------------
// Builds a per-client Statement of Account .xlsx that matches the
// user's existing external format (see SOA URBAN CITY 2026.xlsx).
//
// Layout (Excel columns):
//   B = DOCUMENT Date
//   C = DOCUMENT Type         (PREVIOUS TOTALS / INVOICE / CREDIT NOTE / PROFORMA INVOICE / blank for INWARDS TRANSFER)
//   D = DOCUMENT No
//   E = DESCRIPTION
//   F = AMOUNT                (debit — increases balance)
//   G = AMOUNT RECEIVED       (credit — decreases balance)
//   H = PROG. BALANCE         (running, computed via Excel formula)
//
// Year sections:
//   • Each year starts with a "PREVIOUS TOTALS:" anchor row (Jan 1)
//     carrying the prior year's closing balance forward.
//   • Yearly TOTAL rows at the bottom sum F and G for each year.
//
// Row sources from the live data model:
//   • INVOICE / PROFORMA INVOICE / CREDIT NOTE rows come from the
//     `invoices` table for this client. Each invoice produces one row
//     at its date_issued.
//   • INWARDS TRANSFER rows come from the same `invoices` table —
//     when an invoice has date_paid set we emit one inwards transfer
//     row at the payment date for that invoice's amount.
//   • For payments NOT linked to an invoice (orphan client payments
//     in `expenses` with category Client Payment / Client
//     Reimbursement and no matching invoice_number), we still emit
//     an inwards transfer row with whatever invoice_number the user
//     typed (or blank).
//
// Balance formula per row: =H{prev}+F{n}-G{n}, EXCEPT:
//   • PROFORMA INVOICE rows don't affect balance (=H{prev}) — they're
//     informational only, the real invoice issued later replaces them
//     in the balance.
//
// Spelling: "REIMBURSEMENT" (corrected from historical "REIMBURSTMENT").
//
// Output: a SheetJS workbook object ready for XLSX.writeFile / write.
// =====================================================================

// Uses xlsx-js-style (drop-in replacement for xlsx) so we can write
// cell-level styling (bold, fills, borders, wrap, alignment). The
// community 'xlsx' package builds .xlsx files but doesn't write styles
// — for the polished SOA layout we need them.
import * as XLSX from 'xlsx-js-style'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_NAMES_UPPER = MONTH_NAMES.map(m => m.toUpperCase())

// =====================================================================
// Issuing-company letterheads
// =====================================================================
// The SOA top-left block shows the ISSUER's full letterhead (legal
// name, registration number, address, VAT, T.I.C). xlsx-js-style
// doesn't write images, so the "logo" is the bold legal name in
// large dark-blue text — the rest of the letterhead is plain.
//
// Hardcoded here for now (Rabona Holdings details came from the user
// May 27 2026). If she wants Espargos details too, fill them in
// below. Long-term these could live in a companies-table extension.
const LETTERHEADS = {
  'Rabona Holdings': {
    legalName:   'RABONA HOLDINGS LTD',
    regNumber:   'HE402420',
    addressLines: [
      '75 Spyrou Kyprianou Str.,',
      '1st floor, Office 102',
      '4042, Limassol, Cyprus',
    ],
    vatNumber:   'VAT Reg.No.: 10402420X',
    ticNumber:   'T.I.C: 10402420X',
  },
  'Espargos': {
    legalName:   'ESPARGOS',
    regNumber:   '',
    addressLines: ['', '', ''],
    vatNumber:   'VAT Reg.No.: ',
    ticNumber:   'T.I.C: ',
  },
}

// Invoice numbers in the DB are stored inconsistently (some with
// dashes "2026-04-004", some with slashes "2026/04/004"). The user
// wants slashes everywhere on the SOA. This normalizer flips dashes
// → slashes for any YYYY-MM-NNN or YYYY-NNN pattern while leaving
// the stored values untouched.
function formatInvoiceNumber(num) {
  if (!num) return ''
  return String(num).replace(/-/g, '/')
}

// Default templates (mirror the V30 column defaults — kept here so
// missing client templates still produce usable text).
const DEFAULT_CONSULTANCY_TEMPLATE =
  'Services per Consultancy Service Agreement section 6.1 and Schedule 2  {MONTH} FEE  {YEAR}'
const DEFAULT_REIMBURSEMENT_TEMPLATE =
  'Services per Consultancy Service Agreement section 6.2 (REIMBURSEMENT OF PROCURE AND RUNNING EXPENSES) Expenses as of {EXPENSE_PERIOD} expense report'

// ---------------------------------------------------------------------
// Per-invoice description builders
// ---------------------------------------------------------------------

// Map invoice_type → which template field on `client` to use, plus
// the placeholder substitution function. For credit_note and
// pro_forma we use built-in patterns; user can edit in Excel after
// generation if she wants different wording.
function descriptionFor(invoice, client) {
  // If the invoice has its own description text saved, prefer that.
  // Lets the user override for catch-up rows or multi-period
  // reimbursements where the template falls short.
  if (invoice.description?.trim()) return invoice.description.trim()

  const py = invoice.period_year
  const pm = invoice.period_month
  const monthLabel = pm >= 1 && pm <= 12 ? MONTH_NAMES_UPPER[pm - 1] : ''
  const periodLabel = pm >= 1 && pm <= 12
    ? `${MONTH_NAMES[pm - 1]} ${py}`
    : String(py || '')

  switch (invoice.invoice_type) {
    case 'monthly_fee':
    case 'one_off_service': {
      const tpl = client.soa_consultancy_template || DEFAULT_CONSULTANCY_TEMPLATE
      return tpl.replaceAll('{MONTH}', monthLabel).replaceAll('{YEAR}', String(py || ''))
    }
    case 'fixed_expense':
    case 'variable_expense':
    case 'one_off_reimbursement': {
      const tpl = client.soa_reimbursement_template || DEFAULT_REIMBURSEMENT_TEMPLATE
      return tpl.replaceAll('{EXPENSE_PERIOD}', periodLabel)
    }
    case 'credit_note':
      // The credit-note row's "original invoice" reference isn't
      // tracked as a structured field today — we fall back to a
      // generic message. User overrides via invoice.description.
      return `Credit Note ${invoice.invoice_number || ''}`.trim()
    case 'pro_forma':
      return `Pro Forma — ${periodLabel}`
    default:
      return invoice.invoice_type
  }
}

// Brief description for the INWARDS TRANSFER row's parenthetical
// (e.g. "MAY FEE 2026" or "REIMBURSEMENT OF PROCURE AND RUNNING
// EXPENSES (May 2026 expense report)"). Used inside
// "INWARDS TRANSFER ({brief} Inv.No:{number})".
function briefForInwardsTransfer(invoice) {
  const py = invoice.period_year
  const pm = invoice.period_month
  const monthLabel = pm >= 1 && pm <= 12 ? MONTH_NAMES_UPPER[pm - 1] : ''
  const periodLabel = pm >= 1 && pm <= 12 ? `${MONTH_NAMES[pm - 1]} ${py}` : String(py || '')

  switch (invoice.invoice_type) {
    case 'monthly_fee':
    case 'one_off_service':
      return `${monthLabel} FEE ${py}`
    case 'fixed_expense':
    case 'variable_expense':
    case 'one_off_reimbursement':
      return `REIMBURSEMENT OF PROCURE AND RUNNING EXPENSES (${periodLabel} expense report)`
    default:
      return ''
  }
}

// Map an invoice_type to its SOA "DOCUMENT Type" column value.
function documentTypeFor(invoice) {
  switch (invoice.invoice_type) {
    case 'credit_note': return 'CREDIT NOTE'
    case 'pro_forma':   return 'PROFORMA INVOICE'
    default:            return 'INVOICE'
  }
}

// ---------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------

// Build the ledger row objects (date-sorted, ungrouped). Each row is
// a plain object — the worksheet writer later turns it into cells +
// formulas.
//
// Row shape: {
//   date:        Date object
//   docType:     '' | 'INVOICE' | 'CREDIT NOTE' | 'PROFORMA INVOICE'
//   docNumber:   string | ''
//   description: string
//   amount:      number | null      (debit, goes in col F)
//   received:    number | null      (credit, goes in col G)
//   balanceMode: 'normal' | 'proforma'   (proforma carries balance forward)
//   sourceKind:  'invoice' | 'inwards_transfer' | 'orphan_payment'
// }
function buildLedgerRows(invoices, orphanPayments, historicalRows, client) {
  const rows = []

  // Historical rows come first — they're stored exactly as the user
  // pasted them from her old SOA Excel, so we trust the doc_type /
  // description / amount fields verbatim. The generator just routes
  // them into the same ledger-row shape as system invoices so the
  // year-grouping + balance logic treats them uniformly.
  //
  // Filter out any "PREVIOUS TOTALS:" rows the user pasted — the
  // generator will insert its own anchors at the start of each year
  // group, so the user's manual anchors would duplicate them.
  for (const h of historicalRows || []) {
    if (!h.row_date) continue
    const docType = (h.doc_type || '').trim().toUpperCase()
    if (docType.includes('PREVIOUS TOTALS')) continue
    rows.push({
      date:        new Date(h.row_date),
      docType:     h.doc_type || '',
      docNumber:   h.doc_number || '',
      description: h.description || '',
      amount:      h.amount   != null ? Number(h.amount)   : null,
      received:    h.received != null ? Number(h.received) : null,
      // Pro forma historical rows: detect by doc_type and apply the
      // balance-carry-forward rule (matches system-generated pro formas).
      balanceMode: docType.includes('PROFORMA') ? 'proforma' : 'normal',
      sourceKind:  docType.includes('CREDIT NOTE') ? 'invoice'
                 : (docType.includes('INVOICE') || docType.includes('PROFORMA')) ? 'invoice'
                 : 'inwards_transfer',
    })
  }

  for (const inv of invoices || []) {
    const isCredit  = inv.invoice_type === 'credit_note'
    const isProForma = inv.invoice_type === 'pro_forma'
    const amount    = Number(inv.amount_total || 0)
    const issueDate = inv.date_issued ? new Date(inv.date_issued) : null
    if (!issueDate) continue   // skip drafts that haven't been issued

    rows.push({
      date:        issueDate,
      docType:     documentTypeFor(inv),
      docNumber:   formatInvoiceNumber(inv.invoice_number),
      description: descriptionFor(inv, client),
      // Credit notes go in the RECEIVED column (credit to client,
      // reduces what they owe). Everything else goes in AMOUNT.
      amount:      isCredit ? null : amount,
      received:    isCredit ? amount : null,
      balanceMode: isProForma ? 'proforma' : 'normal',
      sourceKind:  'invoice',
    })

    // If this invoice has been paid, emit an INWARDS TRANSFER row at
    // the payment date. Credit notes and pro formas never generate
    // inwards transfers (the credit note IS the reduction; pro forma
    // is informational).
    if (!isCredit && !isProForma && inv.date_paid) {
      const paidDate = new Date(inv.date_paid)
      const brief    = briefForInwardsTransfer(inv)
      // Normalize the embedded invoice number to slashes here too,
      // not just on the DOCUMENT No column.
      const numPart  = inv.invoice_number
        ? ` Inv.No: ${formatInvoiceNumber(inv.invoice_number)}`
        : ''
      rows.push({
        date:        paidDate,
        docType:     '',
        docNumber:   '',
        description: `INWARDS TRANSFER (${brief}${numPart})`,
        amount:      null,
        received:    amount,
        balanceMode: 'normal',
        sourceKind:  'inwards_transfer',
      })
    }
  }

  // Orphan payments — client payments / reimbursements typed in the
  // Bank Parser whose invoice_number doesn't match any invoice in
  // the system (typo, or invoice not logged yet). Still show in the
  // ledger so the running balance reflects actual cash received.
  for (const p of orphanPayments || []) {
    if (!p.date) continue
    const numPart = p.invoice_number ? ` Inv.No: ${formatInvoiceNumber(p.invoice_number)}` : ''
    rows.push({
      date:        new Date(p.date),
      docType:     '',
      docNumber:   '',
      description: `INWARDS TRANSFER (${p.vendor || 'unmatched payment'}${numPart})`,
      amount:      null,
      received:    Number(p.amount || 0),
      balanceMode: 'normal',
      sourceKind:  'orphan_payment',
    })
  }

  // Sort by date ascending. Stable order within same date.
  rows.sort((a, b) => a.date - b.date)
  return rows
}

// ---------------------------------------------------------------------
// Workbook assembly
// ---------------------------------------------------------------------

// Excel A1-style address from 1-based row + column number.
function addr(row, col) {
  // col 1 → A, 2 → B, ..., 26 → Z, 27 → AA
  let s = ''
  let n = col
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return `${s}${row}`
}

// Write a single cell with optional value + format + style. Helper to
// keep the assembly readable.
//
// Note: SheetJS expects `cell.f` to be the formula WITHOUT the leading
// "=". We strip it defensively so callers can pass either form.
//
// opts.s is the cell-style object (xlsx-js-style format), e.g.:
//   { font: { name: 'Avenir',bold: true }, fill: { fgColor: { rgb: 'FFFFFF' } },
//     alignment: { wrapText: true } }
function setCell(ws, row, col, value, opts = {}) {
  const ref = addr(row, col)
  if (value == null && !opts.formula) {
    return
  }
  const cell = { t: opts.t || (typeof value === 'number' ? 'n' : 's') }
  if (opts.formula) {
    cell.f = String(opts.formula).replace(/^=/, '')
    cell.t = 'n'
    cell.v = 0
    if (opts.z) cell.z = opts.z
  } else if (value instanceof Date) {
    cell.t = 'd'
    cell.v = value
    cell.z = opts.z || 'dd/mm/yyyy'
  } else {
    cell.v = value
    if (opts.z) cell.z = opts.z
  }
  if (opts.s) cell.s = opts.s
  ws[ref] = cell
}

// ---------------------------------------------------------------------
// Style presets — kept here so the worksheet builder reads cleanly.
// All colors in 6-char RGB hex (no #).
// ---------------------------------------------------------------------
const COLOR_HEADER_BG  = '1F4E78'  // dark blue — column titles row
const COLOR_HEADER_FG  = 'FFFFFF'
const COLOR_ANCHOR_BG  = 'DBEAFE'  // light blue — PREVIOUS TOTALS rows
// Toned-down palette per user request May 27 2026 — less colorful
// overall: keep blue (titles + totals + anchor), light pink for
// credit notes, light gray for inwards transfers (and OVERPAY
// footer, which reuses COLOR_INWARDS_BG).
const COLOR_CREDIT_BG  = 'FEF2F2'  // very light pink — credit notes (was FEE2E2)
const COLOR_PROFORMA_BG = 'FEF3C7' // soft yellow — pro formas (kept distinct so the rare pro forma still stands out)
const COLOR_INWARDS_BG = 'F3F4F6'  // light gray — inwards transfers + OVERPAY (was DCFCE7)
const COLOR_TOTAL_BG   = '1F4E78'  // dark blue — year totals
const COLOR_TOTAL_FG   = 'FFFFFF'
const COLOR_BORDER     = 'D1D5DB'  // light gray border

// Accounting format: thousands sep, parens for negative, BLANK for zero.
// Blank-on-zero is critical so we can write 0 as the underlying value
// in "empty" amount/received cells (keeping formulas + borders intact)
// while the cell visually appears empty.
const FMT_AMOUNT = '#,##0.00;(#,##0.00);""'
const FMT_DATE   = 'dd/mm/yyyy'

// Standard thin border on all four sides.
const BORDER_THIN = {
  top:    { style: 'thin', color: { rgb: COLOR_BORDER } },
  bottom: { style: 'thin', color: { rgb: COLOR_BORDER } },
  left:   { style: 'thin', color: { rgb: COLOR_BORDER } },
  right:  { style: 'thin', color: { rgb: COLOR_BORDER } },
}

// Style for the client-info LABELS (Company number:, VAT Number:,
// Address:). Per user May 27 2026: regular weight (not bold) and
// right-aligned so the label sits flush against its value.
const STYLE_HEADER_LABEL = {
  font: { name: 'Avenir', sz: 11 },
  alignment: { horizontal: 'right', vertical: 'top' },
}
// Bold variant — for "project:" and "Client" which sit alongside
// strong headings ("Statement of Account" / the client name).
const STYLE_HEADER_LABEL_BOLD = {
  font: { name: 'Avenir', sz: 11, bold: true },
  alignment: { horizontal: 'right', vertical: 'top' },
}
const STYLE_HEADER_VALUE = {
  font: { name: 'Avenir', sz: 11 },
  alignment: { wrapText: true, vertical: 'top' },
}

// Style for the column-title row (row 9). White bold on dark blue.
const STYLE_COL_TITLE = {
  font:      { name: 'Avenir',bold: true, color: { rgb: COLOR_HEADER_FG }, sz: 11 },
  fill:      { fgColor: { rgb: COLOR_HEADER_BG } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border:    BORDER_THIN,
}

// Base style for body rows — thin border, vertical-top alignment.
// Per-row variants below layer on fills/fonts.
const STYLE_BODY_BASE = {
  font:      { name: 'Avenir',sz: 10 },
  alignment: { vertical: 'top', wrapText: true },
  border:    BORDER_THIN,
}
function styleBody(opts = {}) {
  return {
    ...STYLE_BODY_BASE,
    ...(opts.fill   ? { fill:   opts.fill }   : {}),
    ...(opts.font   ? { font:   { ...STYLE_BODY_BASE.font, ...opts.font } } : {}),
    ...(opts.alignment ? { alignment: { ...STYLE_BODY_BASE.alignment, ...opts.alignment } } : {}),
    ...(opts.numFmt ? { numFmt: opts.numFmt } : {}),
  }
}

// Per-row-kind styling. The fill differentiates row types at a glance
// (matches the on-screen color coding in the Compose Emails modal +
// View Expenses).
function styleForRowKind(kind, baseExtras = {}) {
  let fill
  if (kind === 'CREDIT NOTE')           fill = { fgColor: { rgb: COLOR_CREDIT_BG } }
  else if (kind === 'PROFORMA INVOICE') fill = { fgColor: { rgb: COLOR_PROFORMA_BG } }
  else if (kind === 'INWARDS')          fill = { fgColor: { rgb: COLOR_INWARDS_BG } }
  // INVOICE: explicit white fill so the row isn't transparent —
  // keeps the look consistent across spreadsheets / PDF viewers
  // that show the default cell background as cream or light gray.
  else                                  fill = { fgColor: { rgb: 'FFFFFF' } }
  return styleBody({ ...baseExtras, fill })
}

const STYLE_ANCHOR = {
  font:      { name: 'Avenir',bold: true, sz: 11 },
  fill:      { fgColor: { rgb: COLOR_ANCHOR_BG } },
  alignment: { vertical: 'center' },
  border:    BORDER_THIN,
}

const STYLE_TOTAL = {
  font:      { name: 'Avenir',bold: true, color: { rgb: COLOR_TOTAL_FG }, sz: 11 },
  fill:      { fgColor: { rgb: COLOR_TOTAL_BG } },
  alignment: { vertical: 'center' },
  border:    BORDER_THIN,
}

// --- Footer status block (FOR PAYMENT / OVERPAY) ---
// Matches the small status block at the bottom of the user's external
// SOA. AS OF row uses bold + right-align. FOR PAYMENT row stays plain
// (only shows a value when balance > 0). OVERPAY row gets the soft-
// green fill always (highlight is the bookkeeping cue that this is
// the "good news" case).
const STYLE_FOOTER_LABEL = {
  font:      { name: 'Avenir',bold: true, sz: 11 },
  alignment: { horizontal: 'right', vertical: 'center' },
}
const STYLE_FOOTER_VALUE_PLAIN = {
  font:      { name: 'Avenir',bold: true, sz: 11 },
  alignment: { horizontal: 'right', vertical: 'center' },
  border:    BORDER_THIN,
}
const STYLE_FOOTER_VALUE_GREEN = {
  font:      { name: 'Avenir',bold: true, sz: 11 },
  fill:      { fgColor: { rgb: COLOR_INWARDS_BG } },  // soft green
  alignment: { horizontal: 'right', vertical: 'center' },
  border:    BORDER_THIN,
}
const STYLE_FOOTER_LABEL_GREEN = {
  font:      { name: 'Avenir',bold: true, sz: 11 },
  fill:      { fgColor: { rgb: COLOR_INWARDS_BG } },
  alignment: { horizontal: 'right', vertical: 'center' },
}
const FMT_AMOUNT_EURO = '"€"#,##0.00;("€"#,##0.00);"€"0.00'  // shows €0.00 explicitly

// Generate the worksheet for one client's SOA.
// headerText is an object with editable text the user can adjust in
// the modal before generating: { companyName, companyNumber, vatNumber, address }
// issuingCompany is the name of the company issuing the SOA — used
// as the dark-blue brand mark in cell B1 (top-left).
function buildWorksheet(client, ledgerRows, headerText, issuingCompany) {
  const ws = {}
  // We use rows 1-7 for the header block, row 9 for column titles,
  // row 10+ for ledger lines (matching the user's sample layout
  // exactly).

  // --- Issuing-company letterhead (rows 1-7, cols B-D) ---
  // Full letterhead block on the LEFT — legal name (bold, large,
  // dark blue), registration number, address lines, VAT, T.I.C.
  // The SOA title + client info still live on the RIGHT (cols E-H).
  const letterhead = LETTERHEADS[issuingCompany] || LETTERHEADS['Rabona Holdings']
  // Per user May 27 2026: only the legal name stays bold (it's the
  // logo substitute). Everything below — reg number, address lines,
  // VAT, T.I.C — is regular weight in medium gray, to keep the
  // letterhead understated.
  const COLOR_LETTERHEAD_GRAY = '6B7280'
  const LH_GRAY_STYLE = {
    font: { name: 'Avenir', sz: 11, color: { rgb: COLOR_LETTERHEAD_GRAY } },
    alignment: { vertical: 'center' },
  }

  // Row 1: legal name in big bold gray — substitutes for the logo.
  // Same gray as the rest of the letterhead (reg number, address, VAT,
  // T.I.C) so the whole block reads as a unified, understated block.
  setCell(ws, 1, 2, letterhead.legalName, {
    s: {
      font:      { name: 'Avenir', bold: true, sz: 16, color: { rgb: COLOR_LETTERHEAD_GRAY } },
      alignment: { vertical: 'center', horizontal: 'left' },
    },
  })
  if (!ws['!rows']) ws['!rows'] = []
  ws['!rows'][0] = { hpx: 28 }
  // Row 2: registration number  — gray regular
  if (letterhead.regNumber)
    setCell(ws, 2, 2, letterhead.regNumber, { s: LH_GRAY_STYLE })
  // Rows 3-5: address lines       — gray regular
  letterhead.addressLines.forEach((line, i) => {
    if (line) setCell(ws, 3 + i, 2, line, { s: LH_GRAY_STYLE })
  })
  // Row 6: VAT Reg.No.            — gray regular
  if (letterhead.vatNumber)
    setCell(ws, 6, 2, letterhead.vatNumber, { s: LH_GRAY_STYLE })
  // Row 7: T.I.C                   — gray regular
  if (letterhead.ticNumber)
    setCell(ws, 7, 2, letterhead.ticNumber, { s: LH_GRAY_STYLE })

  // --- SOA title + client info (rows 2-7, cols E-F) ---
  // Layout matches user's manually-tuned reference file (May 27 2026):
  // R2: 'Statement of Account' | 'project:' | trade_name  (cols E/F/G)
  // R4: 'Client'               | legal_name                (cols E/F)
  // R5: 'Company number:'      | regNumber                 (cols E/F)
  // R6: 'VAT Number: '         | vatNumber                 (cols E/F)
  // R7: 'Address: '            | address (merged F7:H7)    (cols E/F)
  setCell(ws, 2, 5, 'Statement of Account', { s: { font: { name: 'Avenir', bold: true, sz: 16 } } })
  setCell(ws, 2, 6, 'project:',              { s: STYLE_HEADER_LABEL_BOLD })
  setCell(ws, 2, 7, client.trade_name || '', { s: { font: { name: 'Avenir', bold: true, sz: 12 } } })

  setCell(ws, 4, 5, 'Client',                                                                   { s: STYLE_HEADER_LABEL_BOLD })
  setCell(ws, 4, 6, headerText.companyName || client.legal_name || '',                          { s: { font: { name: 'Avenir', bold: true, sz: 12 } } })
  setCell(ws, 5, 5, 'Company number:',                 { s: STYLE_HEADER_LABEL })
  setCell(ws, 5, 6, headerText.companyNumber || '',    { s: STYLE_HEADER_VALUE })
  setCell(ws, 6, 5, 'VAT Number: ',                    { s: STYLE_HEADER_LABEL })
  setCell(ws, 6, 6, headerText.vatNumber || '',        { s: STYLE_HEADER_VALUE })
  setCell(ws, 7, 5, 'Address: ',                       { s: STYLE_HEADER_LABEL })
  setCell(ws, 7, 6, headerText.address || '',          { s: STYLE_HEADER_VALUE })
  // Merge F7:H7 so a long address fits across the right side without
  // bleeding into other columns or wrapping awkwardly.
  ws['!merges'] = ws['!merges'] || []
  ws['!merges'].push({ s: { r: 6, c: 5 }, e: { r: 6, c: 7 } })

  // Explicit row heights for the header rows (matches user's layout).
  ws['!rows'][1] = { hpx: 23 }   // R2 — Statement of Account row
  ws['!rows'][3] = { hpx: 17 }   // R4 — Client
  ws['!rows'][4] = { hpx: 17 }   // R5 — Company number
  ws['!rows'][5] = { hpx: 17 }   // R6 — VAT Number
  ws['!rows'][6] = { hpx: 40 }   // R7 — Address (tall for wrap)
  ws['!rows'][7] = { hpx: 15 }   // R8 — thin separator

  // --- Column titles (row 9) ---
  // Explicit \n line breaks force consistent two-line wrapping
  // regardless of column width or font metrics. wrapText:true on
  // STYLE_COL_TITLE honors the breaks.
  const headers = [
    'DOCUMENT\nDate',
    'DOCUMENT\nType',
    'DOCUMENT\nNo:',
    'DESCRIPTION',
    'DEBIT',
    'CREDIT',
    'PROG.\nBALANCE',
  ]
  headers.forEach((h, i) => setCell(ws, 9, 2 + i, h, { s: STYLE_COL_TITLE }))
  // Taller column-title row so the wrapped two-line headers fit cleanly.
  if (!ws['!rows']) ws['!rows'] = []
  ws['!rows'][8] = { hpx: 36 }

  // --- Ledger body (row 10+) ---
  // Group rows by year, inserting a "PREVIOUS TOTALS:" anchor at the
  // top of each year. The anchor's balance carries forward via formula
  // from the last row of the prior year (or 0 for the first year).
  const groupedByYear = new Map()
  for (const r of ledgerRows) {
    const y = r.date.getFullYear()
    if (!groupedByYear.has(y)) groupedByYear.set(y, [])
    groupedByYear.get(y).push(r)
  }
  const years = [...groupedByYear.keys()].sort()

  // Track the (Excel) row index of the LAST balance cell of each year
  // so subsequent year anchors and the bottom totals can reference it.
  const yearLastBalanceRow = new Map()   // year → Excel row
  const yearAnchorRow      = new Map()   // year → Excel row of the anchor
  const yearBodyRange      = new Map()   // year → { firstRow, lastRow } for SUM(F:G)

  let curRow = 10   // first ledger row
  let lastBodyRow = 9   // tracked so we can scope the AutoFilter range
                        // to (header row 9) → (last body row), leaving
                        // the YEAR TOTAL block below the filter.

  // When the SOA opens, only the current year's rows should be
  // visible by default. Other years' rows are flagged hidden=true
  // (row hiding) so PDF print captures just the current year. User
  // can still expand by selecting all rows → right-click → Unhide,
  // or by clearing the AutoFilter on the Date column.
  const currentYear = new Date().getFullYear()
  // Helper — mark an Excel row (1-indexed) as hidden if `cond` is true.
  // Idempotent: layers onto any existing row-options.
  const hideRowIf = (rowOneIndexed, cond) => {
    if (!cond) return
    if (!ws['!rows']) ws['!rows'] = []
    const idx = rowOneIndexed - 1
    ws['!rows'][idx] = { ...(ws['!rows'][idx] || {}), hidden: true }
  }

  for (let i = 0; i < years.length; i++) {
    const year = years[i]
    const yearRows = groupedByYear.get(year)
    const isOtherYear = year !== currentYear   // hide everything if not current year

    // Anchor row — "PREVIOUS TOTALS:" Jan 1 of this year
    setCell(ws, curRow, 2, new Date(year, 0, 1), { z: FMT_DATE, s: STYLE_ANCHOR })
    setCell(ws, curRow, 3, 'PREVIOUS TOTALS:',   { s: STYLE_ANCHOR })
    setCell(ws, curRow, 4, '', { s: STYLE_ANCHOR })  // empty padded cells so the fill spans
    setCell(ws, curRow, 5, '', { s: STYLE_ANCHOR })
    // F and G must be numeric 0 (not empty strings) so subsequent
    // PROG. BALANCE formulas can reference them without #VALUE!.
    // The blank-on-zero number format keeps them visually empty.
    setCell(ws, curRow, 6, 0, { t: 'n', z: FMT_AMOUNT, s: { ...STYLE_ANCHOR, numFmt: FMT_AMOUNT } })
    setCell(ws, curRow, 7, 0, { t: 'n', z: FMT_AMOUNT, s: { ...STYLE_ANCHOR, numFmt: FMT_AMOUNT } })
    if (i === 0) {
      setCell(ws, curRow, 8, 0, { t: 'n', z: FMT_AMOUNT, s: { ...STYLE_ANCHOR, numFmt: FMT_AMOUNT } })
    } else {
      const prevYear = years[i - 1]
      const prevLastBalance = yearLastBalanceRow.get(prevYear)
      setCell(ws, curRow, 8, null, { formula: addr(prevLastBalance, 8), z: FMT_AMOUNT, s: STYLE_ANCHOR })
    }
    yearAnchorRow.set(year, curRow)
    hideRowIf(curRow, isOtherYear)   // hide anchor for non-current years
    let lastBalanceRow = curRow
    const firstBodyRow = curRow + 1
    curRow++

    // Body rows for this year
    for (const r of yearRows) {
      // Decide row-kind for fill color: INWARDS TRANSFER rows have
      // empty docType, so we use the sourceKind to disambiguate.
      const rowKind =
        r.docType === 'CREDIT NOTE'      ? 'CREDIT NOTE' :
        r.docType === 'PROFORMA INVOICE' ? 'PROFORMA INVOICE' :
        r.sourceKind === 'inwards_transfer' || r.sourceKind === 'orphan_payment' ? 'INWARDS' :
        'INVOICE'
      const baseStyle     = styleForRowKind(rowKind)
      const centeredStyle = styleForRowKind(rowKind, { alignment: { horizontal: 'center' } })
      const numericStyle  = styleForRowKind(rowKind, { alignment: { horizontal: 'right' } })

      // First three columns (date / type / number) centered;
      // description column left-aligned (default); numeric columns
      // right-aligned (see below).
      setCell(ws, curRow, 2, r.date, { z: FMT_DATE, s: centeredStyle })
      setCell(ws, curRow, 3, r.docType || '', { s: centeredStyle })
      setCell(ws, curRow, 4, r.docNumber || '', { s: centeredStyle })
      setCell(ws, curRow, 5, r.description || '', { s: baseStyle })
      // Write 0 (numeric) for "empty" amount/received cells so the
      // PROG. BALANCE formula can do arithmetic on them. The
      // blank-on-zero number format makes them display as empty.
      setCell(ws, curRow, 6, r.amount   != null ? r.amount   : 0, { t: 'n', z: FMT_AMOUNT, s: numericStyle })
      setCell(ws, curRow, 7, r.received != null ? r.received : 0, { t: 'n', z: FMT_AMOUNT, s: numericStyle })

      // Balance formula. PROFORMA carries previous balance forward
      // unchanged (informational row); normal rows = prev + F - G.
      const prevRef = addr(curRow - 1, 8)
      const formula = r.balanceMode === 'proforma'
        ? `=${prevRef}`
        : `=${prevRef}+${addr(curRow, 6)}-${addr(curRow, 7)}`
      setCell(ws, curRow, 8, null, { formula, z: FMT_AMOUNT, s: numericStyle })

      hideRowIf(curRow, isOtherYear)   // hide body row for non-current years
      lastBalanceRow = curRow
      curRow++
    }

    yearLastBalanceRow.set(year, lastBalanceRow)
    yearBodyRange.set(year, { firstRow: firstBodyRow, lastRow: lastBalanceRow })
    // Track the last body row across all years so the AutoFilter
    // range covers the full data (but excludes the year-total block).
    if (lastBalanceRow > lastBodyRow) lastBodyRow = lastBalanceRow

    // Blank separator row between years for breathing room.
    hideRowIf(curRow, isOtherYear)   // hide the separator after non-current-year sections too
    curRow++
  }

  // --- AutoFilter ---
  // Add dropdown arrows to the column-title row so the user can
  // filter the ledger in Excel (e.g. show only 2025 rows by clicking
  // the DOCUMENT Date dropdown → group by year → check 2025). Excel
  // gives free year/month grouping on date columns. The range only
  // covers the data rows — the YEAR YYYY TOTAL block below stays
  // visible regardless of filter state.
  ws['!autofilter'] = { ref: `${addr(9, 2)}:${addr(lastBodyRow, 8)}` }

  // --- Bottom totals block ---
  // One "YEAR YYYY TOTAL" row per year, summing F and G for that
  // year's body range. Bold white on dark blue fill so it stands out
  // from the body rows.
  let prevTotalsBalanceRow = null
  curRow++ // leave a blank separator row before the totals block
  for (const year of years) {
    const range = yearBodyRange.get(year)
    // Range strings for the SUMIF formulas below — sum AMOUNT
    // (col F) and AMOUNT RECEIVED (col G) ONLY for rows where the
    // DOCUMENT Type (col C) is NOT 'PROFORMA INVOICE'. Pro formas
    // are informational; they shouldn't inflate the year-total
    // payable amount. See task #105.
    const typeRange = `${addr(range.firstRow, 3)}:${addr(range.lastRow, 3)}`
    const amtRange  = `${addr(range.firstRow, 6)}:${addr(range.lastRow, 6)}`
    const recRange  = `${addr(range.firstRow, 7)}:${addr(range.lastRow, 7)}`

    setCell(ws, curRow, 2, `YEAR ${year}`, { s: STYLE_TOTAL })
    setCell(ws, curRow, 3, '', { s: STYLE_TOTAL })
    setCell(ws, curRow, 4, '', { s: STYLE_TOTAL })
    setCell(ws, curRow, 5, 'TOTAL', { s: STYLE_TOTAL })
    setCell(ws, curRow, 6, null, {
      formula: `=SUMIF(${typeRange},"<>PROFORMA INVOICE",${amtRange})`,
      z: FMT_AMOUNT, s: STYLE_TOTAL,
    })
    setCell(ws, curRow, 7, null, {
      formula: `=SUMIF(${typeRange},"<>PROFORMA INVOICE",${recRange})`,
      z: FMT_AMOUNT, s: STYLE_TOTAL,
    })
    // Running total balance across years in the totals block too.
    const balPrevRef = prevTotalsBalanceRow
      ? addr(prevTotalsBalanceRow, 8)
      : '0'
    setCell(ws, curRow, 8, null, {
      formula: `=${balPrevRef}+${addr(curRow, 6)}-${addr(curRow, 7)}`,
      z: FMT_AMOUNT, s: STYLE_TOTAL,
    })
    // Hide YEAR XXXX TOTAL rows for non-current years too, so the
    // default view (and any PDF print) shows ONLY the current year's
    // totals. The closing balance in the footer below is still
    // accurate because its formula chains through prevTotalsBalanceRow
    // regardless of hidden state — Excel formulas reference hidden
    // cells correctly.
    hideRowIf(curRow, year !== currentYear)
    prevTotalsBalanceRow = curRow
    curRow++
  }

  // --- Footer status block (AS OF / FOR PAYMENT / OVERPAY) ---
  // Mirrors the user's external SOA footer. Sits at the very bottom
  // beneath the YEAR TOTAL block. Shows the as-of date (today) plus
  // the closing balance split into two rows:
  //   FOR PAYMENT — = MAX(closing_balance, 0)  → only when client owes
  //   OVERPAY     — = MAX(-closing_balance, 0) → only when client has credit
  // The closing balance comes from the LAST year-total balance cell
  // (col H of prevTotalsBalanceRow). We skip the entire block when
  // there's nothing to summarize.
  if (prevTotalsBalanceRow) {
    curRow++   // blank separator between year totals and footer

    const closingRef = addr(prevTotalsBalanceRow, 8)

    // AS OF row — label in G, today's date in H
    setCell(ws, curRow, 7, 'as of', { s: STYLE_FOOTER_LABEL })
    setCell(ws, curRow, 8, new Date(), { z: FMT_DATE, s: STYLE_FOOTER_VALUE_PLAIN })
    curRow++

    // FOR PAYMENT row
    setCell(ws, curRow, 7, 'FOR PAYMENT', { s: STYLE_FOOTER_LABEL })
    setCell(ws, curRow, 8, null, {
      formula: `=MAX(${closingRef},0)`,
      z: FMT_AMOUNT_EURO,
      s: STYLE_FOOTER_VALUE_PLAIN,
    })
    curRow++

    // OVERPAY row — soft green fill (highlights the "client has credit" case)
    setCell(ws, curRow, 7, 'OVERPAY', { s: STYLE_FOOTER_LABEL_GREEN })
    setCell(ws, curRow, 8, null, {
      formula: `=MAX(-${closingRef},0)`,
      z: FMT_AMOUNT_EURO,
      s: STYLE_FOOTER_VALUE_GREEN,
    })
    curRow++
  }

  // --- Column widths ---
  // Tuned to match the user's manually-adjusted reference file
  // (May 27 2026 — SOA Urban City). Slightly wider than my v1
  // defaults; Excel adds ~0.83 to displayed widths over the raw
  // character count, so these values mirror her on-screen sizes.
  ws['!cols'] = [
    { wch: 4.83 },    // A (gutter — outside the print area)
    { wch: 13.83 },   // B Date
    { wch: 19.83 },   // C Type
    { wch: 16.83 },   // D Doc No
    { wch: 70.83 },   // E Description (wide for contract refs)
    { wch: 12.83 },   // F Debit
    { wch: 14.83 },   // G Credit
    { wch: 14 },      // H Balance
  ]

  // Tell SheetJS the range
  ws['!ref'] = `A1:H${curRow}`

  // --- Print setup ---
  // Portrait A4 with default fit (no fit-to-width). The user adjusted
  // column widths so the body table fits portrait at native scale.
  // Rows are atomic in Excel pagination — they never split mid-cell.
  ws['!pageSetup'] = {
    orientation: 'portrait',
    paperSize:   9,   // A4
  }
  ws['!margins'] = {
    left:   0.5,
    right:  0.5,
    top:    0.5,
    bottom: 0.5,
    header: 0.3,
    footer: 0.3,
  }

  return ws
}

// ---------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------

// Generate a complete SOA workbook for one client.
//   client          — the clients row (must include trade_name, legal_name,
//                     soa_consultancy_template, soa_reimbursement_template)
//   invoices        — array of invoice rows for this client (any date range
//                     the caller wants — typically all of them, sorted is fine
//                     either way since we sort internally)
//   orphanPayments  — array of incoming expense rows whose invoice_number
//                     doesn't link to any invoice, for THIS client. Pass [] if
//                     you don't want to include them.
//   headerText      — { companyName, companyNumber, vatNumber, address } — the
//                     editable header text the user filled in.
// Returns: a SheetJS workbook ready for XLSX.write / writeFile.
export function generateSoaWorkbook({ client, invoices, orphanPayments = [], historicalRows = [], headerText = {}, issuingCompany = '' }) {
  const rows = buildLedgerRows(invoices, orphanPayments, historicalRows, client)
  const wb   = XLSX.utils.book_new()
  const ws   = buildWorksheet(client, rows, headerText, issuingCompany)
  // Sheet name = client trade_name (Excel caps at 31 chars, no
  // special chars like / \ ? * [ ]).
  const sheetName = (client.trade_name || 'SOA')
    .replace(/[\\/?*[\]]/g, '-')
    .slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)

  // --- Print Area (workbook-level defined name) ---
  // Explicitly set Excel's print-area named range so File → Print
  // (and Save as PDF) only captures the SOA content, not any random
  // empty cells the user might tab into later. The range covers
  // A1 → H{last row}, derived from the worksheet's stored ref.
  const refMatch = (ws['!ref'] || '').match(/:[A-Z]+(\d+)$/)
  const lastRow  = refMatch ? refMatch[1] : '100'
  wb.Workbook = wb.Workbook || {}
  wb.Workbook.Names = wb.Workbook.Names || []
  wb.Workbook.Names.push({
    Name:  '_xlnm.Print_Area',
    // Skip col A (the narrow gutter) — print area starts at B1 so
    // the printed page doesn't have an empty left strip.
    Ref:   `'${sheetName}'!$B$1:$H$${lastRow}`,
    Sheet: 0,
  })

  return wb
}

// Trigger a browser download of the SOA workbook. Filename pattern:
//   "SOA {TRADE_NAME}.xlsx"
// No year suffix — the file is canonical per client. Re-downloads
// land alongside the previous one (browser default), making it
// easy to keep one "current" SOA per client in Downloads.
export function downloadSoaWorkbook({ client, invoices, orphanPayments = [], historicalRows = [], headerText = {}, issuingCompany = '' }) {
  const wb = generateSoaWorkbook({ client, invoices, orphanPayments, historicalRows, headerText, issuingCompany })
  const safe = (client.trade_name || 'CLIENT').replace(/[\\/?*[\]]/g, '-')
  const filename = `SOA ${safe}.xlsx`
  XLSX.writeFile(wb, filename)
}
