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

import * as XLSX from 'xlsx'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTH_NAMES_UPPER = MONTH_NAMES.map(m => m.toUpperCase())

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
function buildLedgerRows(invoices, orphanPayments, client) {
  const rows = []

  for (const inv of invoices || []) {
    const isCredit  = inv.invoice_type === 'credit_note'
    const isProForma = inv.invoice_type === 'pro_forma'
    const amount    = Number(inv.amount_total || 0)
    const issueDate = inv.date_issued ? new Date(inv.date_issued) : null
    if (!issueDate) continue   // skip drafts that haven't been issued

    rows.push({
      date:        issueDate,
      docType:     documentTypeFor(inv),
      docNumber:   inv.invoice_number || '',
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
      const numPart  = inv.invoice_number ? ` Inv.No: ${inv.invoice_number}` : ''
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
    const numPart = p.invoice_number ? ` Inv.No: ${p.invoice_number}` : ''
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

// Write a single cell with optional value + format. Helper to keep
// the assembly readable.
//
// Note: SheetJS expects `cell.f` to be the formula WITHOUT the leading
// "=". We strip it defensively so callers can pass either form.
function setCell(ws, row, col, value, opts = {}) {
  const ref = addr(row, col)
  if (value == null && !opts.formula) {
    return
  }
  const cell = { t: opts.t || (typeof value === 'number' ? 'n' : 's') }
  if (opts.formula) {
    cell.f = String(opts.formula).replace(/^=/, '')
    // Excel needs a default value type for formulas; 'n' (number) is
    // safest for numeric ledgers. SheetJS will overwrite cell.v on
    // recalc but we set 0 here so the file opens cleanly even before
    // Excel recalculates.
    cell.t = 'n'
    cell.v = 0
    if (opts.z) cell.z = opts.z
  } else if (value instanceof Date) {
    cell.t = 'd'
    cell.v = value
    cell.z = opts.z || 'yyyy-mm-dd'
  } else {
    cell.v = value
    if (opts.z) cell.z = opts.z
  }
  ws[ref] = cell
}

// Generate the worksheet for one client's SOA.
// headerText is an object with editable text the user can adjust in
// the modal before generating: { companyName, companyNumber, vatNumber, address }
function buildWorksheet(client, ledgerRows, headerText) {
  const ws = {}
  // We use rows 1-7 for the header block, row 9 for column titles,
  // row 10+ for ledger lines (matching the user's sample layout
  // exactly).

  // --- Header block (rows 1-7) ---
  setCell(ws, 2, 5, 'Statement of Account')
  setCell(ws, 2, 6, 'project:')
  setCell(ws, 2, 7, client.trade_name || '')

  setCell(ws, 4, 5, headerText.companyName || client.legal_name || '')
  setCell(ws, 5, 4, 'Company number:')
  setCell(ws, 5, 5, headerText.companyNumber || '')
  setCell(ws, 6, 4, 'VAT Number: ')
  setCell(ws, 6, 5, headerText.vatNumber || '')
  setCell(ws, 7, 4, 'Address: ')
  setCell(ws, 7, 5, headerText.address || '')

  // --- Column titles (row 9) ---
  const headers = ['DOCUMENT Date', 'DOCUMENT Type', 'DOCUMENT   No:',
                   'DESCRIPTION', 'AMOUNT', 'AMOUNT          RECEIVED', 'PROG. BALANCE']
  headers.forEach((h, i) => setCell(ws, 9, 2 + i, h))

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

  for (let i = 0; i < years.length; i++) {
    const year = years[i]
    const yearRows = groupedByYear.get(year)

    // Anchor row — "PREVIOUS TOTALS:" Jan 1 of this year
    setCell(ws, curRow, 2, new Date(year, 0, 1), { z: 'yyyy-mm-dd' })
    setCell(ws, curRow, 3, 'PREVIOUS TOTALS:')
    if (i === 0) {
      setCell(ws, curRow, 8, 0, { t: 'n' })
    } else {
      const prevYear = years[i - 1]
      const prevLastBalance = yearLastBalanceRow.get(prevYear)
      setCell(ws, curRow, 8, null, { formula: addr(prevLastBalance, 8) })
    }
    yearAnchorRow.set(year, curRow)
    let lastBalanceRow = curRow
    const firstBodyRow = curRow + 1
    curRow++

    // Body rows for this year
    for (const r of yearRows) {
      setCell(ws, curRow, 2, r.date, { z: 'yyyy-mm-dd' })
      if (r.docType)   setCell(ws, curRow, 3, r.docType)
      if (r.docNumber) setCell(ws, curRow, 4, r.docNumber)
      setCell(ws, curRow, 5, r.description || '')
      if (r.amount   != null) setCell(ws, curRow, 6, r.amount,   { t: 'n', z: '#,##0.00' })
      if (r.received != null) setCell(ws, curRow, 7, r.received, { t: 'n', z: '#,##0.00' })

      // Balance formula. PROFORMA carries previous balance forward
      // unchanged (informational row); normal rows = prev + F - G.
      const prevRef = addr(curRow - 1, 8)
      const formula = r.balanceMode === 'proforma'
        ? `=${prevRef}`
        : `=${prevRef}+${addr(curRow, 6)}-${addr(curRow, 7)}`
      setCell(ws, curRow, 8, null, { formula, z: '#,##0.00' })

      lastBalanceRow = curRow
      curRow++
    }

    yearLastBalanceRow.set(year, lastBalanceRow)
    yearBodyRange.set(year, { firstRow: firstBodyRow, lastRow: lastBalanceRow })

    // Blank separator row between years for breathing room.
    curRow++
  }

  // --- Bottom totals block ---
  // One "YEAR YYYY TOTAL" row per year, summing F and G for that
  // year's body range. Mirrors the user's sample.
  let prevTotalsBalanceRow = null
  for (const year of years) {
    const range = yearBodyRange.get(year)
    setCell(ws, curRow, 2, `YEAR ${year}`)
    setCell(ws, curRow, 5, 'TOTAL')
    setCell(ws, curRow, 6, null, {
      formula: `=SUM(${addr(range.firstRow, 6)}:${addr(range.lastRow, 6)})`,
      z: '#,##0.00',
    })
    setCell(ws, curRow, 7, null, {
      formula: `=SUM(${addr(range.firstRow, 7)}:${addr(range.lastRow, 7)})`,
      z: '#,##0.00',
    })
    // Running total balance across years in the totals block too.
    const balPrevRef = prevTotalsBalanceRow
      ? addr(prevTotalsBalanceRow, 8)
      : '0'
    setCell(ws, curRow, 8, null, {
      formula: `=${balPrevRef}+${addr(curRow, 6)}-${addr(curRow, 7)}`,
      z: '#,##0.00',
    })
    prevTotalsBalanceRow = curRow
    curRow++
  }

  // --- Column widths ---
  ws['!cols'] = [
    { wch: 4 },   // A (gutter)
    { wch: 13 },  // B Date
    { wch: 18 },  // C Type
    { wch: 16 },  // D Doc No
    { wch: 70 },  // E Description (wide for the long contract refs)
    { wch: 12 },  // F Amount
    { wch: 14 },  // G Received
    { wch: 14 },  // H Balance
  ]

  // Tell SheetJS the range
  ws['!ref'] = `A1:H${curRow}`

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
export function generateSoaWorkbook({ client, invoices, orphanPayments = [], headerText = {} }) {
  const rows = buildLedgerRows(invoices, orphanPayments, client)
  const wb   = XLSX.utils.book_new()
  const ws   = buildWorksheet(client, rows, headerText)
  // Sheet name = client trade_name (Excel caps at 31 chars, no
  // special chars like / \ ? * [ ]).
  const sheetName = (client.trade_name || 'SOA')
    .replace(/[\\/?*[\]]/g, '-')
    .slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

// Trigger a browser download of the SOA workbook. Filename pattern:
//   "SOA {TRADE_NAME} {YEAR}.xlsx"
export function downloadSoaWorkbook({ client, invoices, orphanPayments = [], headerText = {} }) {
  const wb = generateSoaWorkbook({ client, invoices, orphanPayments, headerText })
  const year = new Date().getFullYear()
  const safe = (client.trade_name || 'CLIENT').replace(/[\\/?*[\]]/g, '-')
  const filename = `SOA ${safe} ${year}.xlsx`
  XLSX.writeFile(wb, filename)
}
