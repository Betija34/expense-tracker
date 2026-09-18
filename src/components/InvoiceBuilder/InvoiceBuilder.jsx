import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { RabonaLogo } from '../../assets/RabonaLogo'
import { EspargosLogo } from '../../assets/EspargosLogo'
import { useIsCurrentPeriodLocked } from '../../lib/useIsCurrentPeriodLocked'
import './InvoiceBuilder.css'

/**
 * InvoiceBuilder — "Issue Invoice" tab.
 *
 * Produces the actual printable invoice document and, on save, writes an
 * `issued` row (or several, for multi-month runs) to the invoices table so
 * it shows up in the Client Invoicing tracker.
 *
 * Behaviour (per the user's spec):
 *   - Project dropdown → auto-fills the legal entity.
 *   - Type dropdown drives amount + VAT + wording.
 *   - Monthly fee / fixed expense support MULTIPLE months in one run: any
 *     month with no invoice on record is auto-ticked (catch-up); future
 *     months can be ticked to bill in advance. Each ticked month becomes
 *     its own separately-numbered invoice.
 *   - Invoice number auto-generates from the ISSUE month (YYYY/MM/NNN),
 *     overridable for single invoices.
 *   - Date of issue defaults to today, overridable (pre-prepare invoices).
 *   - Description = project + section wording + period; auto, editable.
 *   - VAT: shown (as a subtotal→VAT%→total block) only when it applies;
 *     never on any reimbursement.
 *   - "View client details" link surfaces the client's identity + fee, and
 *     a placeholder for the fee-phase schedule (built next).
 */

// Issuer identity — from the company letterhead (RABONA LETTERHEAD.pdf).
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
  'Espargos': {
    legalName: 'ESPARGOS', regNo: '', vatNo: '', addressLines: [], email: '', web: '',
  },
}

// Type table. vat: 'client' = use the client's VAT rate; false = never.
// multi: supports the multi-month picker. src: where the default amount
// comes from.
const TYPES = [
  { value: 'monthly_fee',           label: 'Monthly fee (§6.1)',                 vat: 'client', multi: true,  src: 'fee' },
  { value: 'fixed_expense',         label: 'Fixed expense reimbursement (§6.2)', vat: false,    multi: true,  src: 'fixed' },
  { value: 'variable_expense',      label: 'Variable expense reimbursement',     vat: false,    multi: false, src: 'manual' },
  { value: 'one_off_service',       label: 'One-off — service',                  vat: 'client', multi: false, src: 'manual' },
  { value: 'one_off_reimbursement', label: 'One-off — reimbursement',            vat: false,    multi: false, src: 'manual' },
  { value: 'credit_note',           label: 'Credit note (negative)',             vat: false,    multi: false, src: 'manual' },
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Default agreement section per project, used only to seed the editable
// description text. This moves into the client record in the next phase
// (client info + fee phases); until then it lives here.
const SECTION_BY_TRADE = {
  'Urban City': '6.1', 'Blue Lagoon': '6.1', 'Green Field Hotel': '6.1',
  'Kypseli': '', 'Evia Mare': '6.1', 'BAD City Hall': '6.1', 'BAD City SPA Hotel': '6.1',
}

function typeInfo(t) { return TYPES.find(x => x.value === t) || TYPES[0] }
function pad3(n) { return String(n).padStart(3, '0') }
function fmtEuro(n) {
  const v = Number(n || 0)
  return (v < 0 ? '-' : '') + '€' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

// YYYY/MM/ prefix taken from the ISSUE date (numbers reset per issue-month).
function issuePrefix(dateStr) {
  const s = dateStr || todayISO()
  const [y, m] = s.split('-')
  return `${y}/${m}/`
}

// Build the invoice line description: project + section wording + period.
function describe(client, type, m, y) {
  if (!client) return ''
  const proj = client.trade_name || client.legal_name
  const M = MONTHS[(m || 1) - 1]
  const secRaw = SECTION_BY_TRADE[client.trade_name]
  const sec = secRaw === undefined ? '6.1' : secRaw
  switch (type) {
    case 'monthly_fee': {
      const s = sec ? ` per Consultancy Service Agreement §${sec}` : ''
      return `${proj} — Consultancy services${s}, ${M} fee ${y}`
    }
    case 'fixed_expense':
      return `${proj} — Fixed procure & running expenses per §6.2, ${M} ${y}`
    case 'variable_expense':
      return `${proj} — Reimbursement of procure & running expenses per §6.2, expenses as of ${M} ${y} expense report`
    case 'one_off_service':
      return `${proj} — [describe the service], ${M} ${y}`
    case 'one_off_reimbursement':
      return `${proj} — Reimbursement of [describe], ${M} ${y}`
    case 'credit_note':
      return `${proj} — Credit note re invoice [number] (amount wrongly issued)`
    default:
      return proj
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
    period_month: selectedMonth,
    period_year: selectedYear,
    date_issued: todayISO(),
    amount_net: '',
    vat_rate: '0',
    description: '',
    notes: '',
  })

  const [selMonths, setSelMonths] = useState(() => new Set())   // multi-month selection
  const [issuedMonths, setIssuedMonths] = useState(() => new Set()) // already-invoiced (client+type+year)
  const [baseSeq, setBaseSeq] = useState(1)                     // next sequence for the issue-month
  const [invoiceNumber, setInvoiceNumber] = useState('')       // single-invoice number (editable)
  const [numberTouched, setNumberTouched] = useState(false)
  const [descTouched, setDescTouched] = useState(false)

  const [showInfo, setShowInfo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedInfo, setSavedInfo] = useState(null)             // { count, numbers: [] }

  const issuer = ISSUERS[selectedCompany] || { legalName: selectedCompany, addressLines: [] }
  const selectedClient = clients.find(c => c.id === form.client_id) || null
  const info = typeInfo(form.invoice_type)

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

  // ---- Fetch which months are already invoiced (multi types) -------------
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
          .eq('period_year', form.period_year)
        if (error) throw error
        if (cancelled) return
        const s = new Set((data || []).map(r => r.period_month))
        setIssuedMonths(s)
        // Default selection: every month up to the anchor (top-bar) month
        // that isn't already invoiced. If none, tick the anchor itself.
        const anchor = form.period_month
        const def = new Set()
        for (let m = 1; m <= anchor; m++) if (!s.has(m)) def.add(m)
        if (def.size === 0) def.add(anchor)
        setSelMonths(def)
      } catch {
        if (!cancelled) { setIssuedMonths(new Set()); setSelMonths(new Set([form.period_month])) }
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, form.client_id, form.invoice_type, form.period_year, savedInfo])

  // ---- Next sequence for the issue-month ---------------------------------
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const prefix = issuePrefix(form.date_issued)
      try {
        const { data, error } = await supabase
          .from('invoices').select('invoice_number')
          .ilike('invoice_number', `${prefix}%`)
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
  }, [form.date_issued, companyId, savedInfo])

  // ---- Keep the single-invoice number in step (unless user edited it) ----
  useEffect(() => {
    if (numberTouched) return
    setInvoiceNumber(issuePrefix(form.date_issued) + pad3(baseSeq))
  }, [baseSeq, form.date_issued, numberTouched])

  // ---- Anchor month = first selected (multi) or period_month (single) ----
  const anchorMonth = info.multi
    ? ([...selMonths].sort((a, b) => a - b)[0] || form.period_month)
    : form.period_month

  // ---- Auto-build the description (unless user edited it) -----------------
  useEffect(() => {
    if (descTouched) return
    setForm(f => ({ ...f, description: describe(selectedClient, f.invoice_type, anchorMonth, f.period_year) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.client_id, form.invoice_type, anchorMonth, form.period_year, clients, descTouched])

  // ---- When client or type changes, reset amount / VAT / edit flags ------
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
    setNumberTouched(false)
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

  // ---- Derived amounts (for the on-screen document) ----------------------
  const net = parseFloat(form.amount_net) || 0
  const vatRate = info.vat === 'client' ? (parseFloat(form.vat_rate) || 0) : 0
  const vatAmount = net * vatRate
  const total = net + vatAmount

  const monthsToIssue = info.multi
    ? [...selMonths].sort((a, b) => a - b)
    : [form.period_month]

  const plannedNumbers = monthsToIssue.map((_, i) => issuePrefix(form.date_issued) + pad3(baseSeq + i))
  const singleNumber = info.multi ? plannedNumbers[0] : invoiceNumber

  // ---- Save --------------------------------------------------------------
  const canSave =
    !!form.client_id &&
    !Number.isNaN(parseFloat(form.amount_net)) &&
    parseFloat(form.amount_net) !== 0 &&
    monthsToIssue.length > 0 &&
    (info.multi || !!invoiceNumber.trim())

  const handleSave = async () => {
    setSaveError(null); setSavedInfo(null)
    if (isLocked) {
      setSaveError(`🔒 The period ${String(selectedMonth).padStart(2, '0')}/${selectedYear} is closed for ${selectedCompany}. Unlock it via the Monthly Checklist tab to issue invoices.`)
      return
    }
    if (!canSave) { setSaveError('Pick a client, a non-zero amount, and at least one month / an invoice number.'); return }
    setSaving(true)
    try {
      const prefix = issuePrefix(form.date_issued)
      const rows = monthsToIssue.map((m, i) => {
        const number = info.multi ? (prefix + pad3(baseSeq + i)) : invoiceNumber.trim()
        const desc = info.multi
          ? describe(selectedClient, form.invoice_type, m, form.period_year)
          : (form.description || '').trim()
        return {
          company_id: companyId,
          client_id: form.client_id,
          period_year: form.period_year,
          period_month: m,
          invoice_type: form.invoice_type,
          description: desc || null,
          amount_net: net,
          vat_rate: vatRate,
          amount_total: total,
          status: 'issued',
          invoice_number: number,
          date_issued: form.date_issued,
          notes: (form.notes || '').trim() || null,
        }
      })
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
    setNumberTouched(false); setDescTouched(false)
    setForm(f => ({ ...f, notes: '' }))
    // baseSeq + issuedMonths refresh via the savedInfo-keyed effects.
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
          Company: <strong>{selectedCompany}</strong>. Choose a client and type, fill the rest,
          then Print / Save as PDF and Save invoice — it appears in the Client Invoicing tracker.
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
            <span>Invoice number{info.multi ? ' (auto per month)' : ''}</span>
            <input
              type="text"
              value={singleNumber}
              disabled={info.multi}
              onChange={e => { setNumberTouched(true); setInvoiceNumber(e.target.value) }}
              placeholder="2026/09/002"
            />
          </label>

          <label className="ib-field ib-field-sm">
            <span>Date issued</span>
            <input
              type="date"
              value={form.date_issued}
              onChange={e => { setNumberTouched(false); setForm(f => ({ ...f, date_issued: e.target.value })) }}
            />
          </label>

          <label className="ib-field ib-field-sm">
            <span>Amount (net €){info.src !== 'manual' ? ' — from agreement' : ''}</span>
            <input type="number" step="0.01" value={form.amount_net}
              onChange={e => setForm(f => ({ ...f, amount_net: e.target.value }))} placeholder="0.00" />
          </label>

          <label className="ib-field ib-field-sm">
            <span>VAT rate{info.vat === 'client' ? '' : ' (n/a — reimbursement)'}</span>
            <input type="number" step="0.01"
              value={info.vat === 'client' ? form.vat_rate : '0'}
              disabled={info.vat !== 'client'}
              onChange={e => setForm(f => ({ ...f, vat_rate: e.target.value }))} placeholder="0.19" />
          </label>

          <label className="ib-field ib-field-wide">
            <span>Line description (auto — editable{info.multi ? '; applies per-month automatically for multi-month runs' : ''})</span>
            <textarea rows={2} value={form.description} disabled={info.multi}
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
                <div>Reg. No: {selectedClient.registration_number || '—'} · VAT: {selectedClient.vat_id || '—'}</div>
                <div>{selectedClient.address || '— no address on file —'}</div>
                <div>
                  Current monthly fee: <strong>{fmtEuro(selectedClient.monthly_fee_net)}</strong>
                  {Number(selectedClient.monthly_fixed_expense_net) > 0 && <> · Fixed reimb: <strong>{fmtEuro(selectedClient.monthly_fixed_expense_net)}</strong></>}
                  {' '}· VAT rate: <strong>{(Number(selectedClient.vat_rate) * 100)}%</strong>
                </div>
                <div className="ib-phasebox">
                  Fee <strong>phase schedule</strong> will live here (next build): amount auto-matches the period's phase, still overridable above.
                  Edit identity &amp; wording on the Client Invoicing tab.
                </div>
              </>
            ) : <div>Select a client first.</div>}
          </div>
        )}

        {info.multi && selectedClient && (
          <div className="ib-periods">
            <div className="ib-periods-lbl">Periods to invoice — {form.period_year}</div>
            <div className="ib-months">
              {MONTHS.map((m, i) => {
                const mo = i + 1
                const already = issuedMonths.has(mo)
                const past = mo <= form.period_month && !already
                const on = selMonths.has(mo)
                const title = already ? `${m} — already invoiced`
                  : (mo <= form.period_month ? `${m} — not yet invoiced` : `${m} — advance`)
                return (
                  <button
                    key={mo} type="button" title={title}
                    className={`ib-mchip${on ? ' on' : ''}${past ? ' past' : ''}${already ? ' done' : ''}`}
                    onClick={() => toggleMonth(mo)}
                  >
                    {m.slice(0, 3)}
                  </button>
                )
              })}
            </div>
            <div className="ib-plegend">
              Dashed = a month with no invoice on record (auto-ticked to catch up). Grey = already invoiced.
              Tick future months to bill in advance. Each ticked month becomes its own numbered invoice.
            </div>
            {monthsToIssue.length > 0 && (
              <div className="ib-willmake">
                <strong>Will create {monthsToIssue.length} invoice{monthsToIssue.length > 1 ? 's' : ''}:</strong>
                <table><tbody>
                  {monthsToIssue.map((m, i) => (
                    <tr key={m}>
                      <td className="n">{plannedNumbers[i]}</td>
                      <td>{describe(selectedClient, form.invoice_type, m, form.period_year)}</td>
                      <td className="a">{fmtEuro(total)}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>
        )}

        <div className="ib-actions">
          <button className="ib-btn ib-btn-secondary" onClick={() => window.print()} disabled={!form.client_id}>
            🖨 Print / Save as PDF
          </button>
          <button className="ib-btn ib-btn-primary" onClick={handleSave} disabled={saving || !canSave}>
            {saving ? 'Saving…' : (monthsToIssue.length > 1 ? `Save ${monthsToIssue.length} invoices` : 'Save invoice')}
          </button>
          {savedInfo && <button className="ib-btn ib-btn-secondary" onClick={handleNew}>+ New invoice</button>}
        </div>

        {saveError && <div className="ib-error">{saveError}</div>}
        {savedInfo && (
          <div className="ib-success">
            ✅ {savedInfo.count} invoice{savedInfo.count > 1 ? 's' : ''} saved as issued
            ({savedInfo.numbers.join(', ')}) — now in the Client Invoicing tracker.
          </div>
        )}
      </div>

      {/* ---- Invoice document (screen preview + print) ------------------- */}
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
              <tr><td>Invoice No</td><td>{singleNumber || '—'}</td></tr>
              <tr><td>Date issued</td><td>{form.date_issued || '—'}</td></tr>
            </tbody></table>
          </div>

          <div className="ib-billto">
            <div className="ib-billto-label">BILL TO</div>
            {selectedClient ? (
              <>
                <div className="ib-billto-name">{selectedClient.legal_name}</div>
                {selectedClient.registration_number && <div className="ib-billto-line">Reg. No: {selectedClient.registration_number}</div>}
                {selectedClient.vat_id && <div className="ib-billto-line">VAT: {selectedClient.vat_id}</div>}
                {selectedClient.address && <div className="ib-billto-line">{selectedClient.address}</div>}
              </>
            ) : <div className="ib-billto-line ib-muted">Select a client above…</div>}
          </div>

          <table className="ib-lines">
            <thead><tr><th className="ib-col-desc">Description</th><th className="ib-col-amt">Amount</th></tr></thead>
            <tbody>
              <tr>
                <td className="ib-col-desc">
                  {info.multi
                    ? describe(selectedClient, form.invoice_type, docMonth, form.period_year)
                    : (form.description || <span className="ib-muted">—</span>)}
                </td>
                <td className="ib-col-amt">{fmtEuro(net)}</td>
              </tr>
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

          <div className="ib-doc-foot">
            <div className="ib-foot-name">{issuer.legalName}</div>
            {(issuer.regNo || issuer.vatNo) && <div>{[issuer.regNo, issuer.vatNo].filter(Boolean).join('  |  ')}</div>}
            {(issuer.addressLines || []).map((l, i) => <div key={i}>{l}</div>)}
            {issuer.email && <div>{issuer.email}</div>}
            {issuer.web && <div>{issuer.web}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
