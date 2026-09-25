import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { RabonaLogo } from '../../assets/RabonaLogo'
import { EspargosLogo } from '../../assets/EspargosLogo'
import { useIsCurrentPeriodLocked } from '../../lib/useIsCurrentPeriodLocked'
import { resolveMonthlyFee, fmtPhaseRange } from '../../lib/feePhases'
import './InvoiceBuilder.css'

/**
 * InvoiceBuilder — "Issue Invoice" tab.
 *
 * Produces the printable invoice document and, on save, writes an `issued`
 * row (or several, for multi-month runs) to the invoices table so it shows
 * up in the Client Invoicing tracker.
 *
 * Invoice numbers are YYYY/MM/NNN where YYYY/MM ALWAYS comes from the
 * top-bar (accounting) month — only the running sequence NNN is editable.
 * So an invoice can never be numbered outside the month selected up top:
 * to issue an October number, switch the top bar to October.
 *
 * Monthly fee / fixed expense support MULTIPLE months in one run: months
 * with no invoice on record are auto-ticked (catch-up); future months can
 * be ticked to bill in advance. Each ticked month is its own invoice, but
 * all carry the top-bar month's number (the period lives in the description).
 */

const ISSUERS = {
  'Rabona Holdings': {
    legalName: 'RABONA HOLDINGS LTD',
    regNo: 'HE 402420',
    vatNo: 'VAT 10402420X',
    addressLines: [
      'Spyrou Kyprianou 75, 1st Floor, Flat 102',
      'Potamos Germasogeias, 4042 Limassol, Cyprus',
    ],
    email: 'accounts@rabonaholdings.com',
    web: 'www.rabonaholdings.com',
  },
  'Espargos': { legalName: 'ESPARGOS', regNo: '', vatNo: '', addressLines: [], email: '', web: '' },
}

// Bank / payment details printed at the bottom of the invoice (from the
// real invoice template).
const BANK = {
  'Rabona Holdings': {
    bank: 'Bank of Cyprus',
    branch: 'Corporate Banking Centre Limassol 1',
    address: 'Corner G. Neofytou &, Georgiou Griva Digeni 121',
    beneficiary: 'RABONA HOLDINGS LTD',
    account: '357032438089',
    iban: 'CY76002001950000357032438089',
    swift: 'BCYPCY2N',
  },
}

const TYPES = [
  { value: 'monthly_fee',           label: 'Monthly fee (§6.1)',                 vat: 'client', multi: true,  src: 'fee' },
  { value: 'fixed_expense',         label: 'Fixed expenses reimbursement (§6.2)', vat: false,    multi: true,  src: 'fixed' },
  { value: 'variable_expense',      label: 'Variable expense reimbursement',     vat: false,    multi: false, src: 'manual' },
  { value: 'one_off_service',       label: 'One-off — service',                  vat: 'client', multi: false, src: 'manual' },
  { value: 'one_off_reimbursement', label: 'One-off — reimbursement',            vat: false,    multi: false, src: 'manual' },
  { value: 'credit_note',           label: 'Credit note',                        vat: false,    multi: false, src: 'manual' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Agreement section + schedule + project name + optional custom fee wording
// come from the client record (V38: agreement_section, agreement_schedule,
// invoice_project_name, fee_wording). Blank = the standard defaults
// (section 6.1 / Schedule 2 / trade name / standard wording).

function typeInfo(t) { return TYPES.find(x => x.value === t) || TYPES[0] }
function pad3(n) { return String(n).padStart(3, '0') }
function pad2(n) { return String(n).padStart(2, '0') }
function fmtEuro(n) {
  const v = Number(n || 0)
  return (v < 0 ? '-' : '') + '€' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

// "June 30th, 2026" — last day of the given month with an ordinal suffix.
function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }
function lastDayLabel(m, y) { return `${MONTHS[(m || 1) - 1]} ${ordinal(new Date(y, m, 0).getDate())}, ${y}` }

// Wording precedence for the monthly fee of month m:
//   1. the fee phase covering m has its own invoice_wording (V40)
//   2. the client's custom fee_wording (V38)
//   3. standard wording with the client's section / schedule
function fillWording(tpl, { M, y, proj, phase }) {
  const d = (iso) => { if (!iso) return ''; const [yy, mm, dd] = iso.split('-'); return `${dd}/${mm}/${yy}` }
  return tpl.trim()
    .replace(/\{MONTH\}/g, M.toUpperCase())
    .replace(/\{YEAR\}/g, String(y))
    .replace(/\{PROJECT\}/g, proj)
    .replace(/\{PHASE\}/g, phase?.label || '')
    .replace(/\{AMOUNT\}/g, phase ? fmtEuro(phase.amount_net) : '')
    .replace(/\{FROM\}/g, d(phase?.effective_from))
    .replace(/\{TO\}/g, phase?.effective_to ? d(phase.effective_to) : 'open')
}

function describe(client, type, m, y, phase = null) {
  if (!client) return ''
  const M = MONTHS[(m || 1) - 1]
  const proj = (client.invoice_project_name || client.trade_name || client.legal_name || '').toUpperCase()
  const sec = (client.agreement_section || '').trim() || '6.1'
  const sched = (client.agreement_schedule || '').trim() || '2'
  switch (type) {
    case 'monthly_fee':
      if ((phase?.invoice_wording || '').trim()) return fillWording(phase.invoice_wording, { M, y, proj, phase })
      if ((client.fee_wording || '').trim()) return fillWording(client.fee_wording, { M, y, proj, phase })
      return `Services per Consultancy Service Agreement section ${sec} and Schedule ${sched}, ${M} fee ${y}\nProject ${proj}`
    case 'fixed_expense':
      return `Services per Consultancy Service Agreement section 6.2 (Reimbursement of Fixed Procure and Running Expenses) ${M} ${y}\nProject ${proj}`
    case 'variable_expense':
      return `Services per Consultancy Service Agreement section 6.2 (Reimbursement of Procure and Running Expenses)\nExpenses as of ${lastDayLabel(m, y)} expense report`
    case 'one_off_service':
      return `Services per Consultancy Service Agreement — [describe the service], ${M} ${y}`
    case 'one_off_reimbursement':
      return `Reimbursement of [describe] — expenses as of ${lastDayLabel(m, y)} expense report`
    case 'credit_note':
      return `Credit note to invoice [number]`
    default:
      return ''
  }
}

export function InvoiceBuilder({ selectedCompany, selectedMonth, selectedYear }) {
  const isLocked = useIsCurrentPeriodLocked()

  const [companyId, setCompanyId] = useState(null)
  const [clients, setClients] = useState([])
  const [loadError, setLoadError] = useState(null)

  const [form, setForm] = useState({
    client_id: '',
    invoice_type: 'monthly_fee',
    date_issued: todayISO(),
    amount_net: '',
    vat_rate: '0',
    description: '',
    notes: '',
  })

  const [selMonths, setSelMonths] = useState(() => new Set())
  const [issuedMonths, setIssuedMonths] = useState(() => new Set())
  const [baseSeq, setBaseSeq] = useState(1)
  const [seqInput, setSeqInput] = useState('')          // editable running sequence
  const [numberTouched, setNumberTouched] = useState(false)
  const [numberApproved, setNumberApproved] = useState(false)
  const [dateTouched, setDateTouched] = useState(false)
  const [dateApproved, setDateApproved] = useState(false)
  const [descTouched, setDescTouched] = useState(false)
  const [amountTouched, setAmountTouched] = useState(false)   // user typed over the phase/agreement amount

  // Fee phases (V38) of the selected client: { clientId, rows, error }
  const [phaseState, setPhaseState] = useState({ clientId: null, rows: [], error: null, loading: false })

  const [showInfo, setShowInfo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedInfo, setSavedInfo] = useState(null)
  // After a save, the document shows the invoice(s) exactly as saved —
  // number, date, wording, amounts — so they can be printed afterwards.
  // Without this the page moved on to the NEXT free number as soon as the
  // save completed. savedIdx picks which saved invoice (multi-month runs).
  const [savedIdx, setSavedIdx] = useState(0)
  // Multi-month runs: ONE invoice listing every ticked month (one number,
  // one line per month) or a separate invoice per month. Either way each
  // month is still stored as its own invoices row (its own period), so the
  // per-month tracking, VAT and "already invoiced" logic are unchanged;
  // combined rows simply share the invoice number and date.
  const [combine, setCombine] = useState(true)

  // Variable-expense report picker (pulled from the system).
  const [reportOptions, setReportOptions] = useState([]) // [{ y, m, amount, deferredTo }]
  const [selReports, setSelReports] = useState(() => new Set())
  const [reportsLoading, setReportsLoading] = useState(false)

  const issuer = ISSUERS[selectedCompany] || { legalName: selectedCompany, addressLines: [] }
  const bank = BANK[selectedCompany] || null
  const selectedClient = clients.find(c => c.id === form.client_id) || null
  const info = typeInfo(form.invoice_type)

  // Numbers are YYYY/MM from the TOP-BAR month; only the sequence is editable.
  const dashPrefix = `${selectedYear}/${pad2(selectedMonth)}/`
  // Credit notes have their OWN yearly sequence: YYYY/NNN (no month),
  // separate from invoice numbers. YYYY comes from the top-bar year.
  const isCN = form.invoice_type === 'credit_note'
  const numPrefix = isCN ? `${selectedYear}/` : dashPrefix

  // ---- Load clients ------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoadError(null)
      try {
        const { data: comp, error: cErr } = await supabase
          .from('companies').select('id').eq('name', selectedCompany).single()
        if (cErr) throw cErr
        if (cancelled) return
        setCompanyId(comp.id)
        const { data: cl, error: clErr } = await supabase
          .from('clients').select('*')
          .eq('company_id', comp.id).eq('active', true)
          .order('trade_name', { ascending: true, nullsFirst: false })
          .order('legal_name', { ascending: true })
        if (clErr) throw clErr
        if (!cancelled) setClients(cl || [])
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Failed to load clients.')
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedCompany])

  // ---- Fee phases of the selected client ---------------------------------
  // Fail-soft: if the table is missing (V38 not run yet) or the read fails,
  // the client is treated as having no phases (monthly_fee_net is used, as
  // before) and a note is shown.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!form.client_id) { setPhaseState({ clientId: null, rows: [], error: null, loading: false }); return }
      setPhaseState({ clientId: form.client_id, rows: [], error: null, loading: true })
      try {
        const { data, error } = await supabase
          .from('client_fee_phases').select('*')
          .eq('client_id', form.client_id)
          .order('kind', { ascending: true })
          .order('sort_order', { ascending: true })
        if (error) throw error
        if (!cancelled) setPhaseState({ clientId: form.client_id, rows: data || [], error: null, loading: false })
      } catch (err) {
        if (!cancelled) setPhaseState({ clientId: form.client_id, rows: [], error: err.message || 'Could not load fee phases', loading: false })
      }
    }
    run()
    return () => { cancelled = true }
  }, [form.client_id, savedInfo])

  // ---- Which months are already invoiced (multi types) -------------------
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!companyId || !form.client_id || !info.multi) { setIssuedMonths(new Set()); return }
      try {
        const { data, error } = await supabase
          .from('invoices').select('period_month')
          .eq('company_id', companyId)
          .eq('client_id', form.client_id)
          .eq('invoice_type', form.invoice_type)
          .eq('period_year', selectedYear)
        if (error) throw error
        if (cancelled) return
        const s = new Set((data || []).map(r => r.period_month))
        setIssuedMonths(s)
        const def = new Set()
        for (let m = 1; m <= selectedMonth; m++) if (!s.has(m)) def.add(m)
        if (def.size === 0) def.add(selectedMonth)
        setSelMonths(def)
      } catch {
        if (!cancelled) { setIssuedMonths(new Set()); setSelMonths(new Set([selectedMonth])) }
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, form.client_id, form.invoice_type, selectedYear, selectedMonth, savedInfo])

  // ---- Next free sequence -----------------------------------------------
  // Invoices: YYYY/MM/NNN per top-bar month. Older invoices from the Client
  // Invoicing tab were written YYYY-MM-NNN, so BOTH spellings count.
  // Credit notes: YYYY/NNN per year (older ones written YYYY-NNN, some
  // with a suffix like "2026-001 (4)"), counted per company.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        let max = 0
        if (isCN) {
          if (!companyId) return
          const { data, error } = await supabase
            .from('invoices').select('invoice_number')
            .eq('company_id', companyId).eq('invoice_type', 'credit_note')
          if (error) throw error
          if (cancelled) return
          const re = new RegExp(`^${selectedYear}[/-](\\d{1,4})(?!\\d)(?![/-]\\d)`)
          for (const r of (data || [])) {
            const mm = (r.invoice_number || '').trim().match(re)
            if (mm) max = Math.max(max, parseInt(mm[1], 10))
          }
        } else {
          const y = selectedYear, m = pad2(selectedMonth)
          const { data, error } = await supabase
            .from('invoices').select('invoice_number')
            .or(`invoice_number.ilike.${y}/${m}/*,invoice_number.ilike.${y}-${m}-*`)
          if (error) throw error
          if (cancelled) return
          const re = new RegExp(`^${y}[/-]${m}[/-](\\d+)`)
          for (const r of (data || [])) {
            const mm = (r.invoice_number || '').trim().match(re)
            if (mm) max = Math.max(max, parseInt(mm[1], 10))
          }
        }
        setBaseSeq(max + 1)
      } catch {
        if (!cancelled) setBaseSeq(1)
      }
    }
    run()
    return () => { cancelled = true }
  }, [numPrefix, isCN, selectedYear, selectedMonth, companyId, savedInfo])

  // When the number series changes (month, or invoice <-> credit note),
  // re-suggest the sequence and require confirmation again.
  useEffect(() => { setNumberTouched(false); setNumberApproved(false) }, [numPrefix])

  // Keep the running sequence in step (unless the user edited it).
  useEffect(() => {
    if (numberTouched) return
    setSeqInput(pad3(baseSeq))
  }, [baseSeq, numberTouched])

  // ---- Anchor month = first selected (multi) or top-bar month (single) ---
  const anchorMonth = info.multi
    ? ([...selMonths].sort((a, b) => a - b)[0] || selectedMonth)
    : selectedMonth

  // ---- Auto-build the description (unless the user edited it) -------------
  useEffect(() => {
    if (descTouched) return
    setForm(f => ({ ...f, description: describe(selectedClient, f.invoice_type, anchorMonth, selectedYear, phaseFor(anchorMonth)) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_id, form.invoice_type, anchorMonth, selectedYear, clients, descTouched, phaseState])

  // ---- Variable expense: pull un-invoiced reimbursable expense reports ----
  // For the chosen project, group reimbursable expenses by the month they
  // were incurred, apply the client's deferrals (a deferred month shows only
  // once its target month has arrived), drop any already covered by an
  // earlier variable-expense invoice, and offer what's left.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!companyId || !form.client_id || form.invoice_type !== 'variable_expense') {
        setReportOptions([]); setSelReports(new Set()); return
      }
      setReportsLoading(true)
      try {
        const client = clients.find(c => c.id === form.client_id) || null
        const names = [client?.trade_name, client?.legal_name]
          .filter(Boolean).map(s => s.trim().toLowerCase())

        // Match the Client Report exactly: reimbursable outgoing expenses
        // (is_reimbursable), bucketed by the period they're attributed to
        // (main_ref_year / main_ref_month), summed per project.
        const { data: exp, error: eErr } = await supabase
          .from('expenses').select('client_name, amount, main_ref_year, main_ref_month')
          .eq('company_id', companyId)
          .eq('is_reimbursable', true)
          .not('client_name', 'is', null)
        if (eErr) throw eErr
        const byMonth = new Map()
        for (const r of (exp || [])) {
          const nm = (r.client_name || '').trim().toLowerCase()
          if (!names.includes(nm)) continue
          const yy = Number(r.main_ref_year), mm = Number(r.main_ref_month)
          if (!yy || !mm) continue
          const key = `${yy}-${mm}`
          byMonth.set(key, (byMonth.get(key) || 0) + Number(r.amount || 0))
        }

        // Variable-expense deferrals ONLY (the same table also holds
        // monthly_fee / fixed_expense deferrals — those must not affect
        // which expense reports are offered).
        const { data: defs } = await supabase
          .from('expense_deferrals').select('*')
          .eq('company_id', companyId).eq('client_id', form.client_id)
        const varDefs = (defs || []).filter(d => (d.invoice_type || 'variable_expense') === 'variable_expense')
        const deferBySource = new Map()
        for (const d of varDefs) deferBySource.set(`${d.source_year}-${d.source_month}`, d)

        // Which expense months are already invoiced?
        //  - Invoices made here record the exact months (covered_expense_periods).
        //  - Older invoices (Client Invoicing tab) don't; there an invoice
        //    filed under month P billed P's own expenses UNLESS P was
        //    deferred away, PLUS every month deferred INTO P. This is the
        //    same rule the Client Invoicing tab uses to build the amount.
        const { data: invs } = await supabase
          .from('invoices').select('covered_expense_periods, period_year, period_month')
          .eq('company_id', companyId).eq('client_id', form.client_id).eq('invoice_type', 'variable_expense')
        const covered = new Set()
        for (const iv of (invs || [])) {
          const cp = Array.isArray(iv.covered_expense_periods) ? iv.covered_expense_periods : []
          if (cp.length > 0) {
            for (const p of cp) covered.add(`${p.year}-${p.month}`)
          } else if (iv.period_year && iv.period_month) {
            const pk = `${iv.period_year}-${iv.period_month}`
            if (!deferBySource.has(pk)) covered.add(pk)
            for (const d of varDefs) {
              if (d.target_year === iv.period_year && d.target_month === iv.period_month) {
                covered.add(`${d.source_year}-${d.source_month}`)
              }
            }
          }
        }

        const opts = []
        for (const [key, amount] of byMonth.entries()) {
          if (amount <= 0 || covered.has(key)) continue
          const [yy, mm] = key.split('-').map(Number)
          const def = deferBySource.get(key)
          if (def) {
            const targetInFuture = def.target_year > selectedYear ||
              (def.target_year === selectedYear && def.target_month > selectedMonth)
            if (targetInFuture) continue // deferred to a month that hasn't arrived — hide
          }
          opts.push({ y: yy, m: mm, amount, deferredTo: def ? { y: def.target_year, m: def.target_month } : null })
        }
        opts.sort((a, b) => (a.y - b.y) || (a.m - b.m))
        if (cancelled) return
        setReportOptions(opts)
        setSelReports(new Set(opts.map(o => `${o.y}-${o.m}`)))
      } catch {
        if (!cancelled) { setReportOptions([]); setSelReports(new Set()) }
      } finally {
        if (!cancelled) setReportsLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, form.client_id, form.invoice_type, selectedYear, selectedMonth, savedInfo, clients])

  // ---- Defaults when client / type changes -------------------------------
  const applyDefaults = useCallback((clientId, type) => {
    const client = clients.find(c => c.id === clientId) || null
    const ti = typeInfo(type)
    let amount_net = ''
    if (client) {
      if (ti.src === 'fee') amount_net = String(client.monthly_fee_net ?? '')
      else if (ti.src === 'fixed') amount_net = String(client.monthly_fixed_expense_net ?? '')
    }
    const vat_rate = ti.vat === 'client' && client ? String(client.vat_rate ?? '0') : '0'
    setDescTouched(false)
    setAmountTouched(false)
    setForm(f => ({ ...f, client_id: clientId, invoice_type: type, amount_net, vat_rate }))
  }, [clients])

  const onClientChange = (id) => applyDefaults(id, form.invoice_type)
  const onTypeChange = (t) => applyDefaults(form.client_id, t)

  const toggleMonth = (m) => {
    setSelMonths(prev => {
      const n = new Set(prev)
      if (n.has(m)) n.delete(m); else n.add(m)
      return n
    })
  }
  const toggleReport = (key) => {
    setSelReports(prev => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key); else n.add(key)
      return n
    })
  }

  // ---- Variable expense: selected reports + their sum --------------------
  const isVar = form.invoice_type === 'variable_expense'
  const VAR_HEADING = 'Services per Consultancy Service Agreement section 6.2 (Reimbursement of Procure and Running Expenses)'
  const selectedReportList = reportOptions.filter(o => selReports.has(`${o.y}-${o.m}`))
  const variableTotal = selectedReportList.reduce((s, o) => s + o.amount, 0)
  const variableDescription = isVar
    ? [VAR_HEADING, ...selectedReportList.map(o => `Expenses as of ${lastDayLabel(o.m, o.y)} expense report`)].join('\n')
    : ''

  // ---- Fee phases → per-month monthly-fee amount -------------------------
  // For the monthly fee, unless the user typed over the amount, each month
  // takes the amount of the fee phase covering THAT month (so a run that
  // crosses a phase change bills each month at its own rate). Clients with
  // no phases fall back to the client's monthly fee (unchanged behaviour).
  const phasesReady = !!selectedClient && phaseState.clientId === form.client_id && !phaseState.loading
  const clientPhases = phasesReady ? phaseState.rows : []
  const usePhases = form.invoice_type === 'monthly_fee' && !amountTouched && !!selectedClient
  const feeFor = (m) => resolveMonthlyFee(selectedClient, clientPhases, selectedYear, m)
  // Phase covering month m — drives the invoice WORDING even when the
  // amount has been typed over.
  const phaseFor = (m) => (form.invoice_type === 'monthly_fee' && selectedClient) ? feeFor(m).phase : null
  const anchorFee = usePhases ? feeFor(anchorMonth) : null

  // ---- Derived amounts ---------------------------------------------------
  const vatRate = info.vat === 'client' ? (parseFloat(form.vat_rate) || 0) : 0
  // Credit notes are stored as a POSITIVE amount, like every earlier credit
  // note: the Statement of Account puts them in the credit (received)
  // column by type. So a minus typed in is ignored.
  const typedAmount = () => { const v = parseFloat(form.amount_net) || 0; return isCN ? Math.abs(v) : v }
  const amountForMonth = (m) => usePhases ? feeFor(m).amount : typedAmount()
  const net = isVar ? variableTotal : (usePhases ? (anchorFee.amount || 0) : typedAmount())
  const vatAmount = net * vatRate
  const total = net + vatAmount
  const totalFor = (m) => { const a = amountForMonth(m) || 0; return a + a * vatRate }

  const monthsToIssue = info.multi ? [...selMonths].sort((a, b) => a - b) : [selectedMonth]
  const unresolvedMonths = usePhases
    ? monthsToIssue.filter(m => { const r = feeFor(m); return r.amount == null })
    : []
  const startSeq = Number.isNaN(parseInt(seqInput, 10)) ? baseSeq : parseInt(seqInput, 10)
  const combined = info.multi && combine && monthsToIssue.length > 1
  const plannedNumbers = monthsToIssue.map((_, i) => numPrefix + pad3(startSeq + (combined ? 0 : i)))
  const singleNumber = plannedNumbers[0] || (numPrefix + pad3(startSeq))

  // ---- Confirmation state (screen aid only) ------------------------------
  // The invoice number and the issue date arrive pre-filled (next free
  // sequence / today), and the project comes from the client picker. Until
  // each one is explicitly confirmed - edited, or ticked - it is shown in
  // RED on the invoice document so it is obvious at a glance what has not
  // been checked. Red never prints: the printed/PDF invoice is always black.
  // Printing and saving stay blocked while anything is still red.
  const seqValid = !Number.isNaN(parseInt(seqInput, 10))
  const numberOk = seqValid && (numberTouched || numberApproved)
  const dateOk = dateTouched || dateApproved
  const clientOk = !!form.client_id
  const allConfirmed = clientOk && numberOk && dateOk
  const pendingLabels = [
    !clientOk && 'project',
    !numberOk && 'invoice number',
    !dateOk && 'date issued',
  ].filter(Boolean)

  // ---- Save --------------------------------------------------------------
  const canSave =
    allConfirmed &&
    (isVar
      ? (selectedReportList.length > 0 && variableTotal !== 0)
      : usePhases
        ? (phasesReady && monthsToIssue.length > 0 && unresolvedMonths.length === 0 &&
           monthsToIssue.every(m => Number(feeFor(m).amount) !== 0))
        : (!Number.isNaN(parseFloat(form.amount_net)) && parseFloat(form.amount_net) !== 0 && monthsToIssue.length > 0))

  const handleSave = async () => {
    setSaveError(null); setSavedInfo(null)
    if (isLocked) {
      setSaveError(`🔒 The period ${pad2(selectedMonth)}/${selectedYear} is closed for ${selectedCompany}. Unlock it via the Monthly Checklist tab to issue invoices.`)
      return
    }
    if (!canSave) { setSaveError('Pick a client, a sequence number, and an amount / at least one expense report.'); return }
    setSaving(true)
    try {
      let rows
      if (isVar) {
        rows = [{
          company_id: companyId,
          client_id: form.client_id,
          period_year: selectedYear,
          period_month: selectedMonth,
          invoice_type: 'variable_expense',
          description: variableDescription,
          amount_net: variableTotal,
          vat_rate: 0,
          amount_total: variableTotal,
          status: 'issued',
          invoice_number: dashPrefix + pad3(startSeq),
          date_issued: form.date_issued,
          notes: (form.notes || '').trim() || null,
          covered_expense_periods: selectedReportList.map(o => ({ year: o.y, month: o.m, amount: o.amount })),
        }]
      } else {
        rows = monthsToIssue.map((m, i) => {
          const number = numPrefix + pad3(startSeq + (combined ? 0 : i))
          const desc = info.multi
            ? describe(selectedClient, form.invoice_type, m, selectedYear, phaseFor(m))
            : (form.description || '').trim()
          return {
            company_id: companyId,
            client_id: form.client_id,
            period_year: selectedYear,
            period_month: m,
            invoice_type: form.invoice_type,
            description: desc || null,
            amount_net: amountForMonth(m),
            vat_rate: vatRate,
            amount_total: totalFor(m),
            status: 'issued',
            invoice_number: number,
            date_issued: form.date_issued,
            notes: (form.notes || '').trim() || null,
          }
        })
      }
      const { error } = await supabase.from('invoices').insert(rows).select('id')
      if (error) throw error
      setSavedIdx(0)
      setSavedInfo({
        count: rows.length,
        numbers: [...new Set(rows.map(r => r.invoice_number))],
        rows,                                    // exactly what was written
        combined,                                // one document for all rows
        client: selectedClient,                  // BILL TO as saved
        reports: isVar ? selectedReportList.map(o => ({ ...o })) : [],
      })
    } catch (err) {
      setSaveError(err.message || 'Could not save the invoice(s).')
    } finally {
      setSaving(false)
    }
  }

  const handleNew = () => {
    setSavedInfo(null); setSaveError(null); setSavedIdx(0)
    setNumberTouched(false); setNumberApproved(false)
    setDateTouched(false); setDateApproved(false)
    setDescTouched(false)
    setForm(f => ({ ...f, notes: '' }))
  }

  const LogoEl = selectedCompany === 'Espargos'
    ? <EspargosLogo height={128} />
    : <RabonaLogo height={128} />

  const docMonth = anchorMonth

  // ---- What the invoice document shows -----------------------------------
  // Before saving: the live form. After saving: the saved invoice (frozen).
  const savedRow = savedInfo?.rows?.[savedInfo?.combined ? 0 : savedIdx] || null
  const doc = savedRow ? {
    number: savedRow.invoice_number,
    date: savedRow.date_issued,
    client: savedInfo.client,
    isVar: savedRow.invoice_type === 'variable_expense',
    reports: savedInfo.reports || [],
    desc: savedRow.description || '—',
    lines: (savedInfo.combined ? savedInfo.rows : [savedRow])
      .map(r => ({ desc: r.description || '—', amount: Number(r.amount_net) || 0 })),
    net: 0,
    vatRate: Number(savedRow.vat_rate) || 0,
  } : {
    number: singleNumber,
    date: form.date_issued,
    client: selectedClient,
    isVar,
    reports: selectedReportList,
    desc: info.multi
      ? (describe(selectedClient, form.invoice_type, docMonth, selectedYear, phaseFor(docMonth)) || 'Select a project above…')
      : (form.description || (clientOk ? '—' : 'Select a project above…')),
    lines: null,
    net,
    vatRate,
  }
  if (!savedRow) {
    doc.lines = combined
      ? monthsToIssue.map(m => ({
          desc: describe(selectedClient, form.invoice_type, m, selectedYear, phaseFor(m)),
          amount: amountForMonth(m) || 0,
        }))
      : [{ desc: doc.desc, amount: net }]
  }
  doc.net = doc.lines.reduce((t, l) => t + l.amount, 0)
  doc.vatAmount = doc.net * doc.vatRate
  doc.total = doc.net + doc.vatAmount
  const docIsCN = savedRow ? savedRow.invoice_type === 'credit_note' : isCN
  const docNumberOk = !!savedRow || numberOk
  const docDateOk = !!savedRow || dateOk
  const docClientOk = !!savedRow || clientOk

  return (
    <div className="invoice-builder">
      {/* ---- Controls (screen only) -------------------------------------- */}
      <div className="ib-controls no-print">
        <h2>Issue Invoice</h2>
        <p className="ib-sub">
          Company: <strong>{selectedCompany}</strong> · Invoice month: <strong>{MONTHS[selectedMonth - 1]} {selectedYear}</strong> (from the top bar).
          Choose a client and type, then Print / Save as PDF and Save invoice.
        </p>

        {loadError && <div className="ib-error">{loadError}</div>}

        {savedInfo && (
          <div className="ib-savedbar">
            Showing the saved invoice exactly as issued — print it now if you haven't yet.
            Click <strong>+ New invoice</strong> to start the next one.
          </div>
        )}

        <fieldset className="ib-lockable" disabled={!!savedInfo}>
        <div className="ib-grid">
          <label className="ib-field ib-field-wide2">
            <span>Project</span>
            <select value={form.client_id} onChange={e => onClientChange(e.target.value)}>
              <option value="">— select —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>
                  {(c.trade_name || c.legal_name)}{c.trade_name ? ` — ${c.legal_name}` : ''}
                </option>
              ))}
            </select>
            <button type="button" className="ib-link" onClick={() => setShowInfo(v => !v)}>
              View client details / fee schedule →
            </button>
          </label>

          <label className="ib-field ib-field-wide2">
            <span>Type</span>
            <select value={form.invoice_type} onChange={e => onTypeChange(e.target.value)}>
              {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>

          <label className="ib-field ib-field-sm">
            <span>{isCN ? 'Credit note number (yearly series)' : `Invoice number${info.multi ? ' (first of the batch)' : ''}`}</span>
            <div className="ib-num">
              <span className="ib-num-prefix">{numPrefix}</span>
              <input
                type="text"
                className="ib-num-seq"
                value={seqInput}
                onChange={e => { setNumberTouched(true); setSeqInput(e.target.value.replace(/[^0-9]/g, '')) }}
                placeholder="002"
              />
            </div>
            <span className="ib-confirm">
              <input type="checkbox" checked={numberTouched || numberApproved} disabled={numberTouched}
                onChange={e => setNumberApproved(e.target.checked)} />
              <span>Number confirmed</span>
            </span>
          </label>

          <label className="ib-field ib-field-sm">
            <span>Date issued</span>
            <input type="date" value={form.date_issued}
              onChange={e => { setDateTouched(true); setForm(f => ({ ...f, date_issued: e.target.value })) }} />
            <span className="ib-confirm">
              <input type="checkbox" checked={dateTouched || dateApproved} disabled={dateTouched}
                onChange={e => setDateApproved(e.target.checked)} />
              <span>Date confirmed</span>
            </span>
          </label>

          <label className="ib-field ib-field-sm">
            <span>Amount (net €){isVar ? ' — from expense reports'
              : usePhases && anchorFee?.status === 'phase' ? ` — phase: ${anchorFee.phase.label}`
              : amountTouched && form.invoice_type === 'monthly_fee' ? ' — typed (overrides phases)'
              : (info.src !== 'manual' ? ' — from agreement' : '')}</span>
            <input type="number" step="0.01"
              value={isVar ? variableTotal : (usePhases ? (anchorFee.amount ?? '') : form.amount_net)}
              disabled={isVar}
              onChange={e => { if (form.invoice_type === 'monthly_fee') setAmountTouched(true); setForm(f => ({ ...f, amount_net: e.target.value })) }}
              placeholder="0.00" />
            {amountTouched && form.invoice_type === 'monthly_fee' && (
              <button type="button" className="ib-link" onClick={() => setAmountTouched(false)}>↺ Use fee phases again</button>
            )}
          </label>

          <label className="ib-field ib-field-sm">
            <span>VAT rate{info.vat === 'client' ? '' : ' (n/a — reimbursement)'}</span>
            <input type="number" step="0.01"
              value={info.vat === 'client' ? form.vat_rate : '0'}
              disabled={info.vat !== 'client'}
              onChange={e => setForm(f => ({ ...f, vat_rate: e.target.value }))} placeholder="0.19" />
          </label>

          <label className="ib-field ib-field-wide">
            <span>Line description ({isVar ? 'auto from the selected expense reports' : info.multi ? 'auto — per-month for multi-month runs' : 'auto — editable'})</span>
            <textarea rows={isVar ? 3 : 2} value={isVar ? variableDescription : form.description} disabled={info.multi || isVar}
              onChange={e => { setDescTouched(true); setForm(f => ({ ...f, description: e.target.value })) }}
              placeholder="Description shown on the invoice line" />
          </label>

          <label className="ib-field ib-field-wide">
            <span>Internal notes (not printed)</span>
            <input type="text" value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional — stored with the invoice record" />
          </label>
        </div>

        {showInfo && (
          <div className="ib-clientinfo">
            {selectedClient ? (
              <>
                <div><strong>{selectedClient.legal_name}</strong> · project <strong>{selectedClient.trade_name || '—'}</strong></div>
                <div>Company number: {selectedClient.registration_number || '—'} · VAT number: {selectedClient.vat_id || '—'}</div>
                <div>Address: {selectedClient.address || '— none on file —'}</div>
                <div>
                  Base monthly fee: <strong>{fmtEuro(selectedClient.monthly_fee_net)}</strong>
                  {Number(selectedClient.monthly_fixed_expense_net) > 0 && <> · Fixed reimb: <strong>{fmtEuro(selectedClient.monthly_fixed_expense_net)}</strong></>}
                  {' '}· VAT rate: <strong>{(Number(selectedClient.vat_rate) * 100)}%</strong>
                </div>
                <div>
                  Wording: section <strong>{selectedClient.agreement_section || '6.1'}</strong> · Schedule <strong>{selectedClient.agreement_schedule || '2'}</strong>
                  {' '}· Project line: <strong>{(selectedClient.invoice_project_name || selectedClient.trade_name || '—').toUpperCase()}</strong>
                  {selectedClient.fee_wording ? <> · custom wording on file</> : null}
                </div>
                <div className="ib-phasebox">
                  {phaseState.loading ? 'Loading fee phases…'
                    : phaseState.error ? <>Fee phases unavailable ({phaseState.error}) — using the base monthly fee. Run the V38 migration if not done yet.</>
                    : clientPhases.length === 0 ? <>No fee phases on file — the base monthly fee is used for every month. Add phases on the Clients tab (edit client → Fee phases).</>
                    : (
                      <table className="ib-phasetable"><tbody>
                        {clientPhases.map(p => {
                          const live = p.kind === 'monthly' && anchorFee?.phase?.id === p.id
                          return (
                            <tr key={p.id} className={live ? 'live' : undefined}>
                              <td>{p.kind === 'monthly' ? 'Monthly' : 'One-off'}</td>
                              <td>{p.label}{live ? ' ◀ in effect' : ''}{p.source_ref ? <div className="ib-phaseref">{p.source_ref}</div> : null}{p.invoice_wording ? <div className="ib-phaseref">Invoice wording: {p.invoice_wording}</div> : null}</td>
                              <td>{fmtPhaseRange(p)}</td>
                              <td className="a">{fmtEuro(p.amount_net)}{p.kind === 'monthly' ? '/mo' : ''}</td>
                            </tr>
                          )
                        })}
                      </tbody></table>
                    )}
                  <div style={{ marginTop: 4 }}>Edit client details, wording and phases on the Clients tab (edit client).</div>
                </div>
              </>
            ) : <div>Select a client first.</div>}
          </div>
        )}

        {info.multi && selectedClient && (
          <div className="ib-periods">
            <div className="ib-periods-lbl">Periods to invoice — {selectedYear}</div>
            <div className="ib-months">
              {MONTHS.map((m, i) => {
                const mo = i + 1
                const already = issuedMonths.has(mo)
                const past = mo <= selectedMonth && !already
                const on = selMonths.has(mo)
                const title = already ? `${m} — already invoiced`
                  : (mo <= selectedMonth ? `${m} — not yet invoiced` : `${m} — advance`)
                return (
                  <button key={mo} type="button" title={title}
                    className={`ib-mchip${on ? ' on' : ''}${past ? ' past' : ''}${already ? ' done' : ''}`}
                    onClick={() => toggleMonth(mo)}>
                    {m.slice(0, 3)}
                  </button>
                )
              })}
            </div>
            <div className="ib-plegend">
              Dashed = a month with no invoice on record (auto-ticked to catch up). Grey = already invoiced.
              Tick future months to bill in advance. Each ticked month becomes its own invoice — all numbered under {MONTHS[selectedMonth - 1]} {selectedYear}.
            </div>
            {unresolvedMonths.length > 0 && (
              <div className="ib-error" style={{ marginTop: 8 }}>
                No single fee phase covers {unresolvedMonths.map(m => MONTHS[m - 1]).join(', ')} {selectedYear}
                {' '}({unresolvedMonths.map(m => feeFor(m).status === 'overlap' ? 'phases overlap' : 'no phase').filter((v, i, a) => a.indexOf(v) === i).join(' / ')}).
                Fix the phases on the Clients tab, or type the amount above to override.
              </div>
            )}
            {monthsToIssue.length > 1 && (
              <div className="ib-combine">
                <label>
                  <input type="radio" name="ib-combine" checked={combine} onChange={() => setCombine(true)} />
                  <span><strong>One invoice</strong> for all {monthsToIssue.length} months (one number, one line per month)</span>
                </label>
                <label>
                  <input type="radio" name="ib-combine" checked={!combine} onChange={() => setCombine(false)} />
                  <span>A <strong>separate invoice</strong> per month</span>
                </label>
              </div>
            )}
            {monthsToIssue.length > 0 && (
              <div className="ib-willmake">
                <strong>{combined
                  ? `Will create 1 invoice (${plannedNumbers[0]}) covering ${monthsToIssue.length} months:`
                  : `Will create ${monthsToIssue.length} invoice${monthsToIssue.length > 1 ? 's' : ''}:`}</strong>
                <table><tbody>
                  {monthsToIssue.map((m, i) => (
                    <tr key={m}>
                      <td className="n">{plannedNumbers[i]}</td>
                      <td>{describe(selectedClient, form.invoice_type, m, selectedYear, phaseFor(m))}</td>
                      <td className="a">{usePhases && feeFor(m).amount == null ? '—' : fmtEuro(totalFor(m))}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>
        )}

        {isVar && selectedClient && (
          <div className="ib-periods">
            <div className="ib-periods-lbl">Expense reports to include — {selectedClient.trade_name || selectedClient.legal_name}</div>
            {reportsLoading ? (
              <div className="ib-muted">Looking up un-invoiced reimbursable expenses…</div>
            ) : reportOptions.length === 0 ? (
              <div className="ib-muted">No un-invoiced reimbursable expenses found for this project.</div>
            ) : (
              <div className="ib-reports">
                {reportOptions.map(o => {
                  const key = `${o.y}-${o.m}`
                  return (
                    <label key={key} className="ib-report">
                      <input type="checkbox" checked={selReports.has(key)} onChange={() => toggleReport(key)} />
                      <span className="ib-report-lbl">Expenses as of {lastDayLabel(o.m, o.y)} expense report{o.deferredTo ? ' (deferred)' : ''}</span>
                      <span className="ib-report-amt">{fmtEuro(o.amount)}</span>
                    </label>
                  )
                })}
                <div className="ib-report-total"><span>Total</span><span>{fmtEuro(variableTotal)}</span></div>
              </div>
            )}
            <div className="ib-plegend">
              Totals come straight from the Client Report (reimbursable expenses per project per month), for reports not yet invoiced. Deferred expenses appear only once their target month has arrived. Untick any you don't want on this invoice.
            </div>
          </div>
        )}

        </fieldset>

        <div className="ib-actions">
          <button className="ib-btn ib-btn-secondary" onClick={() => window.print()} disabled={!allConfirmed && !savedRow}>
            🖨 Print / Save as PDF
          </button>
          <button className="ib-btn ib-btn-primary" onClick={handleSave} disabled={saving || !canSave || !!savedInfo}
            title={savedInfo ? 'Already saved — click + New invoice to issue another' : undefined}>
            {saving ? 'Saving…' : (combined ? `Save invoice (${monthsToIssue.length} months)` : monthsToIssue.length > 1 ? `Save ${monthsToIssue.length} invoices` : 'Save invoice')}
          </button>
          {savedInfo && <button className="ib-btn ib-btn-secondary" onClick={handleNew}>+ New invoice</button>}
        </div>

        {!savedInfo && pendingLabels.length > 0 && (
          <div className="ib-pending">
            Shown in red on the invoice - still to confirm: {pendingLabels.join(', ')}.
          </div>
        )}

        {saveError && <div className="ib-error">{saveError}</div>}
        {savedInfo && (
          <div className="ib-success">
            ✅ {savedInfo.combined
              ? <>Invoice {savedInfo.numbers[0]} saved as issued, covering {savedInfo.count} months</>
              : <>{savedInfo.count} invoice{savedInfo.count > 1 ? 's' : ''} saved as issued ({savedInfo.numbers.join(', ')})</>}
            {' '}— now in the Client Invoicing tracker.
            {savedInfo.count > 1 && !savedInfo.combined && (
              <div className="ib-savedpick">
                Show / print:{' '}
                {savedInfo.rows.map((r, i) => (
                  <button key={r.invoice_number + i} type="button"
                    className={`ib-mchip${i === savedIdx ? ' on' : ''}`}
                    onClick={() => setSavedIdx(i)}>
                    {r.invoice_number} · {MONTHS[(r.period_month || 1) - 1].slice(0, 3)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Invoice document -------------------------------------------- */}
      {savedInfo && savedInfo.count > 1 && !savedInfo.combined ? (
        <div className="ib-papernote no-print">
          Showing saved invoice {savedIdx + 1} of {savedInfo.count} ({savedRow?.invoice_number}) — pick another above to print it.
        </div>
      ) : !savedInfo && monthsToIssue.length > 1 && !combined && (
        <div className="ib-papernote no-print">
          Showing 1 of {monthsToIssue.length} — each ticked month is a separate, separately-numbered invoice. After saving you can show and print each one.
        </div>
      )}
      <div className="ib-paper">
        <div className="ib-doc">
          <div className="ib-doc-head">
            <div className="ib-logo">{LogoEl}</div>
            <div className="ib-issuer">
              <div className="ib-issuer-name">{issuer.legalName}</div>
              {(issuer.regNo || issuer.vatNo) && (
                <div className="ib-issuer-line">{[issuer.regNo, issuer.vatNo].filter(Boolean).join('  |  ')}</div>
              )}
              {(issuer.addressLines || []).map((l, i) => <div key={i} className="ib-issuer-line">{l}</div>)}
              {issuer.email && <div className="ib-issuer-line">{issuer.email}</div>}
              {issuer.web && <div className="ib-issuer-line">{issuer.web}</div>}
            </div>
          </div>

          <div className="ib-title-row">
            <h1 className="ib-doc-title">{docIsCN ? 'CREDIT NOTE' : 'INVOICE'}</h1>
            <table className="ib-meta"><tbody>
              <tr><td>{docIsCN ? 'Credit Note No' : 'Invoice No'}</td><td className={docNumberOk ? undefined : 'ib-unconfirmed'}>{doc.number || '—'}</td></tr>
              <tr><td>Date issued</td><td className={docDateOk ? undefined : 'ib-unconfirmed'}>{doc.date || '—'}</td></tr>
            </tbody></table>
          </div>

          <div className="ib-billto">
            <div className="ib-billto-label">BILL TO</div>
            {doc.client ? (
              <>
                <div className="ib-billto-name">{doc.client.legal_name}</div>
                {doc.client.registration_number && <div className="ib-billto-line">Company number: {doc.client.registration_number}</div>}
                {doc.client.vat_id && <div className="ib-billto-line">VAT number: {doc.client.vat_id}</div>}
                {doc.client.address && <div className="ib-billto-line">Address: {doc.client.address}</div>}
              </>
            ) : <div className="ib-billto-line ib-unconfirmed">Select a project above…</div>}
          </div>

          <table className="ib-lines">
            <thead><tr><th className="ib-col-desc">Description</th><th className="ib-col-amt">Amount</th></tr></thead>
            <tbody>
              {doc.isVar ? (
                <>
                  <tr>
                    <td className="ib-col-desc">{VAR_HEADING}</td>
                    <td className="ib-col-amt"></td>
                  </tr>
                  {doc.reports.map(o => (
                    <tr key={`${o.y}-${o.m}`}>
                      <td className="ib-col-desc">Expenses as of {lastDayLabel(o.m, o.y)} expense report</td>
                      <td className="ib-col-amt">{fmtEuro(o.amount)}</td>
                    </tr>
                  ))}
                  {doc.reports.length === 0 && (
                    <tr><td className="ib-col-desc ib-muted">No expense reports selected</td><td className="ib-col-amt"></td></tr>
                  )}
                </>
              ) : (
                doc.lines.map((l, i) => (
                  <tr key={i}>
                    <td className={'ib-col-desc' + (docClientOk ? '' : ' ib-unconfirmed')}>
                      {l.desc}
                    </td>
                    <td className="ib-col-amt">{fmtEuro(l.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <div className="ib-totals">
            <table><tbody>
              {doc.vatRate > 0 ? (
                <>
                  <tr><td>Subtotal (excl. VAT)</td><td>{fmtEuro(doc.net)}</td></tr>
                  <tr><td>VAT ({(doc.vatRate * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%)</td><td>{fmtEuro(doc.vatAmount)}</td></tr>
                  <tr className="ib-total-grand"><td>Total (incl. VAT)</td><td>{fmtEuro(doc.total)}</td></tr>
                </>
              ) : (
                <tr className="ib-total-grand"><td>Total</td><td>{fmtEuro(doc.total)}</td></tr>
              )}
            </tbody></table>
          </div>

          {bank && (
            <div className="ib-doc-bank">
              <div className="ib-bank-label">BANK DETAILS</div>
              <div>{bank.bank}</div>
              <div>{bank.branch}</div>
              <div>{bank.address}</div>
              <div className="ib-bank-gap">Beneficiary: {bank.beneficiary}</div>
              <div>Account No: {bank.account}</div>
              <div>IBAN: {bank.iban}</div>
              <div>SWIFT: {bank.swift}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
