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
  { value: 'credit_note',           label: 'Credit note (negative)',             vat: false,    multi: false, src: 'manual' },
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

function describe(client, type, m, y) {
  if (!client) return ''
  const M = MONTHS[(m || 1) - 1]
  const proj = (client.invoice_project_name || client.trade_name || client.legal_name || '').toUpperCase()
  const sec = (client.agreement_section || '').trim() || '6.1'
  const sched = (client.agreement_schedule || '').trim() || '2'
  switch (type) {
    case 'monthly_fee':
      if ((client.fee_wording || '').trim()) {
        return client.fee_wording.trim()
          .replace(/\{MONTH\}/g, M.toUpperCase())
          .replace(/\{YEAR\}/g, String(y))
          .replace(/\{PROJECT\}/g, proj)
      }
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
      return `Credit note re invoice [number] (amount wrongly issued)`
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

  // ---- Next sequence for the top-bar month -------------------------------
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const { data, error } = await supabase
          .from('invoices').select('invoice_number')
          .ilike('invoice_number', `${dashPrefix}%`)
        if (error) throw error
        if (cancelled) return
        let max = 0
        for (const r of (data || [])) {
          const mm = (r.invoice_number || '').match(/\/(\d+)\s*$/)
          if (mm) max = Math.max(max, parseInt(mm[1], 10))
        }
        setBaseSeq(max + 1)
      } catch {
        if (!cancelled) setBaseSeq(1)
      }
    }
    run()
    return () => { cancelled = true }
  }, [dashPrefix, companyId, savedInfo])

  // When the top-bar month changes, re-suggest the sequence for that month.
  useEffect(() => { setNumberTouched(false); setNumberApproved(false) }, [dashPrefix])

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
    setForm(f => ({ ...f, description: describe(selectedClient, f.invoice_type, anchorMonth, selectedYear) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_id, form.invoice_type, anchorMonth, selectedYear, clients, descTouched])

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

        const { data: defs } = await supabase
          .from('expense_deferrals').select('*')
          .eq('company_id', companyId).eq('client_id', form.client_id)
        const deferBySource = new Map()
        for (const d of (defs || [])) deferBySource.set(`${d.source_year}-${d.source_month}`, d)

        const { data: invs } = await supabase
          .from('invoices').select('covered_expense_periods, period_year, period_month')
          .eq('company_id', companyId).eq('client_id', form.client_id).eq('invoice_type', 'variable_expense')
        const covered = new Set()
        for (const iv of (invs || [])) {
          const cp = Array.isArray(iv.covered_expense_periods) ? iv.covered_expense_periods : []
          if (cp.length > 0) {
            // New picker invoices: the exact source months they covered.
            for (const p of cp) covered.add(`${p.year}-${p.month}`)
          } else if (iv.period_year && iv.period_month) {
            // Older variable invoices (e.g. from the Client Invoicing tab):
            // fall back to their own billing period.
            covered.add(`${iv.period_year}-${iv.period_month}`)
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
  const anchorFee = usePhases ? feeFor(anchorMonth) : null

  // ---- Derived amounts ---------------------------------------------------
  const vatRate = info.vat === 'client' ? (parseFloat(form.vat_rate) || 0) : 0
  const amountForMonth = (m) => usePhases ? feeFor(m).amount : (parseFloat(form.amount_net) || 0)
  const net = isVar ? variableTotal : (usePhases ? (anchorFee.amount || 0) : (parseFloat(form.amount_net) || 0))
  const vatAmount = net * vatRate
  const total = net + vatAmount
  const totalFor = (m) => { const a = amountForMonth(m) || 0; return a + a * vatRate }

  const monthsToIssue = info.multi ? [...selMonths].sort((a, b) => a - b) : [selectedMonth]
  const unresolvedMonths = usePhases
    ? monthsToIssue.filter(m => { const r = feeFor(m); return r.amount == null })
    : []
  const startSeq = Number.isNaN(parseInt(seqInput, 10)) ? baseSeq : parseInt(seqInput, 10)
  const plannedNumbers = monthsToIssue.map((_, i) => dashPrefix + pad3(startSeq + i))
  const singleNumber = plannedNumbers[0] || (dashPrefix + pad3(startSeq))

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
          const number = dashPrefix + pad3(startSeq + i)
          const desc = info.multi
            ? describe(selectedClient, form.invoice_type, m, selectedYear)
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
      setSavedInfo({ count: rows.length, numbers: rows.map(r => r.invoice_number) })
    } catch (err) {
      setSaveError(err.message || 'Could not save the invoice(s).')
    } finally {
      setSaving(false)
    }
  }

  const handleNew = () => {
    setSavedInfo(null); setSaveError(null)
    setNumberTouched(false); setNumberApproved(false)
    setDateTouched(false); setDateApproved(false)
    setDescTouched(false)
    setForm(f => ({ ...f, notes: '' }))
  }

  const LogoEl = selectedCompany === 'Espargos'
    ? <EspargosLogo height={128} />
    : <RabonaLogo height={128} />

  const docMonth = anchorMonth

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
            <span>Invoice number{info.multi ? ' (first of the batch)' : ''}</span>
            <div className="ib-num">
              <span className="ib-num-prefix">{dashPrefix}</span>
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
                              <td>{p.label}{live ? ' ◀ in effect' : ''}</td>
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
            {monthsToIssue.length > 0 && (
              <div className="ib-willmake">
                <strong>Will create {monthsToIssue.length} invoice{monthsToIssue.length > 1 ? 's' : ''}:</strong>
                <table><tbody>
                  {monthsToIssue.map((m, i) => (
                    <tr key={m}>
                      <td className="n">{plannedNumbers[i]}</td>
                      <td>{describe(selectedClient, form.invoice_type, m, selectedYear)}</td>
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

        <div className="ib-actions">
          <button className="ib-btn ib-btn-secondary" onClick={() => window.print()} disabled={!allConfirmed}>
            🖨 Print / Save as PDF
          </button>
          <button className="ib-btn ib-btn-primary" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? 'Saving…' : (monthsToIssue.length > 1 ? `Save ${monthsToIssue.length} invoices` : 'Save invoice')}
          </button>
          {savedInfo && <button className="ib-btn ib-btn-secondary" onClick={handleNew}>+ New invoice</button>}
        </div>

        {pendingLabels.length > 0 && (
          <div className="ib-pending">
            Shown in red on the invoice - still to confirm: {pendingLabels.join(', ')}.
          </div>
        )}

        {saveError && <div className="ib-error">{saveError}</div>}
        {savedInfo && (
          <div className="ib-success">
            ✅ {savedInfo.count} invoice{savedInfo.count > 1 ? 's' : ''} saved as issued
            ({savedInfo.numbers.join(', ')}) — now in the Client Invoicing tracker.
          </div>
        )}
      </div>

      {/* ---- Invoice document -------------------------------------------- */}
      {monthsToIssue.length > 1 && (
        <div className="ib-papernote no-print">
          Showing 1 of {monthsToIssue.length} — each ticked month is a separate, separately-numbered invoice.
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
            <h1 className="ib-doc-title">INVOICE</h1>
            <table className="ib-meta"><tbody>
              <tr><td>Invoice No</td><td className={numberOk ? undefined : 'ib-unconfirmed'}>{singleNumber || '—'}</td></tr>
              <tr><td>Date issued</td><td className={dateOk ? undefined : 'ib-unconfirmed'}>{form.date_issued || '—'}</td></tr>
            </tbody></table>
          </div>

          <div className="ib-billto">
            <div className="ib-billto-label">BILL TO</div>
            {selectedClient ? (
              <>
                <div className="ib-billto-name">{selectedClient.legal_name}</div>
                {selectedClient.registration_number && <div className="ib-billto-line">Company number: {selectedClient.registration_number}</div>}
                {selectedClient.vat_id && <div className="ib-billto-line">VAT number: {selectedClient.vat_id}</div>}
                {selectedClient.address && <div className="ib-billto-line">Address: {selectedClient.address}</div>}
              </>
            ) : <div className="ib-billto-line ib-unconfirmed">Select a project above…</div>}
          </div>

          <table className="ib-lines">
            <thead><tr><th className="ib-col-desc">Description</th><th className="ib-col-amt">Amount</th></tr></thead>
            <tbody>
              {isVar ? (
                <>
                  <tr>
                    <td className="ib-col-desc">{VAR_HEADING}</td>
                    <td className="ib-col-amt"></td>
                  </tr>
                  {selectedReportList.map(o => (
                    <tr key={`${o.y}-${o.m}`}>
                      <td className="ib-col-desc">Expenses as of {lastDayLabel(o.m, o.y)} expense report</td>
                      <td className="ib-col-amt">{fmtEuro(o.amount)}</td>
                    </tr>
                  ))}
                  {selectedReportList.length === 0 && (
                    <tr><td className="ib-col-desc ib-muted">No expense reports selected</td><td className="ib-col-amt"></td></tr>
                  )}
                </>
              ) : (
                <tr>
                  <td className={'ib-col-desc' + (clientOk ? '' : ' ib-unconfirmed')}>
                    {info.multi
                      ? (describe(selectedClient, form.invoice_type, docMonth, selectedYear) || 'Select a project above…')
                      : (form.description || (clientOk ? '—' : 'Select a project above…'))}
                  </td>
                  <td className="ib-col-amt">{fmtEuro(net)}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="ib-totals">
            <table><tbody>
              {vatRate > 0 ? (
                <>
                  <tr><td>Subtotal (excl. VAT)</td><td>{fmtEuro(net)}</td></tr>
                  <tr><td>VAT ({(vatRate * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%)</td><td>{fmtEuro(vatAmount)}</td></tr>
                  <tr className="ib-total-grand"><td>Total (incl. VAT)</td><td>{fmtEuro(total)}</td></tr>
                </>
              ) : (
                <tr className="ib-total-grand"><td>Total</td><td>{fmtEuro(total)}</td></tr>
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
