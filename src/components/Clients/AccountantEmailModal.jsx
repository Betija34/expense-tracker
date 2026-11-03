import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { isFrozen } from '../../lib/projectFreeze'
import {
  buildAccountantSubject,
  buildAccountantBody,
  buildOutlookComposeUrl,
  ACCOUNTANT_DEFAULT_TO,
} from '../../lib/emailTemplateBuilder'

// =====================================================================
// AccountantEmailModal — monthly "invoices issued" email to the
// accountants (Mastserve). Opens from Client Invoicing.
// Lists every invoice / credit note whose date_issued falls in the
// chosen calendar month, for BOTH companies (Rabona + Espargos), and
// prefills an Outlook-on-the-web compose window. PDFs are attached by
// hand (compose deeplinks can't carry attachments).
// Pro formas are excluded — they are not tax invoices.
// =====================================================================
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function AccountantEmailModal({ selectedMonth, selectedYear, onClose }) {
  const [month, setMonth] = useState(selectedMonth)
  const [year,  setYear]  = useState(selectedYear)
  const [companies, setCompanies] = useState([])
  const [clientsById, setClientsById] = useState(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [to, setTo] = useState(ACCOUNTANT_DEFAULT_TO)
  const [cc, setCc] = useState('')
  const [subjectOv, setSubjectOv] = useState(null)
  const [bodyOv, setBodyOv] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true); setError(null); setSubjectOv(null); setBodyOv(null)
        const first = `${year}-${String(month).padStart(2, '0')}-01`
        const nextM = month === 12 ? 1 : month + 1
        const nextY = month === 12 ? year + 1 : year
        const next  = `${nextY}-${String(nextM).padStart(2, '0')}-01`

        const { data: comps, error: cErr } = await supabase
          .from('companies').select('id, name, code').order('name')
        if (cErr) throw cErr
        const { data: cl, error: clErr } = await supabase
          .from('clients').select('*')
        if (clErr) throw clErr
        const { data: inv, error: iErr } = await supabase
          .from('invoices')
          .select('id, company_id, client_id, invoice_type, invoice_number, description, date_issued, amount_net, amount_total, status, period_year, period_month, represents_period_year, represents_period_month, covered_expense_periods')
          .gte('date_issued', first)
          .lt('date_issued', next)
          .neq('invoice_type', 'pro_forma')
          .order('invoice_number', { ascending: true })
        if (iErr) throw iErr

        // ---- Expense reimbursement calculated for the month ----------
        // Same rule as Client Invoicing: reimbursable expenses dated in
        // the month, matched to a project on trade_name / legal_name.
        const lastDay = new Date(year, month, 0).getDate()
        const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
        const { data: exp, error: eErr } = await supabase
          .from('expenses')
          .select('company_id, client_name, amount')
          .eq('requires_reimbursement', true)
          .not('client_name', 'is', null)
          .gte('date', first)
          .lte('date', monthEnd)
        if (eErr) throw eErr
        // Variable-expense invoices covering this month — either billed
        // for this period, or listing it in covered_expense_periods (V37).
        const { data: vinv, error: vErr } = await supabase
          .from('invoices')
          .select('id, company_id, client_id, invoice_number, date_issued, status, period_year, period_month, covered_expense_periods')
          .eq('invoice_type', 'variable_expense')
          .not('date_issued', 'is', null)
        if (vErr) throw vErr
        const { data: defs, error: dErr } = await supabase
          .from('expense_deferrals')
          .select('company_id, client_id, source_year, source_month, target_year, target_month, invoice_type')
          .eq('source_year', year).eq('source_month', month)
        if (dErr && dErr.code !== '42P01') throw dErr

        const covers = (v) => {
          if (v.status === 'voided') return false
          const cov = Array.isArray(v.covered_expense_periods) ? v.covered_expense_periods : []
          if (cov.some(p => Number(p.year) === year && Number(p.month) === month)) return true
          return cov.length === 0 && v.period_year === year && v.period_month === month
        }
        const expenseCalcFor = (companyId) => {
          const rows = []
          for (const c of (cl || []).filter(x => x.company_id === companyId)) {
            const keys = [c.trade_name, c.legal_name].map(k => (k || '').trim().toLowerCase()).filter(Boolean)
            const calc = Math.round((exp || [])
              .filter(e => e.company_id === companyId && keys.includes((e.client_name || '').trim().toLowerCase()))
              .reduce((s, e) => s + Math.abs(Number(e.amount) || 0), 0) * 100) / 100
            if (!(calc > 0)) continue
            const def = (defs || []).find(d => d.client_id === c.id && (d.invoice_type || 'variable_expense') === 'variable_expense')
            // Invoiced = an issued variable-expense invoice covers this month,
            // or (if deferred) the target month's invoice has been issued.
            const invoicedBy = (vinv || []).filter(v => v.client_id === c.id && v.status !== 'voided' && (
              covers(v) || (def && v.period_year === def.target_year && v.period_month === def.target_month)))
            let status = 'pending', target = null
            if (invoicedBy.length) status = 'invoiced'
            else if (def) { status = 'deferred'; target = { year: def.target_year, month: def.target_month } }
            else if (isFrozen(c, year, month)) status = 'frozen'
            rows.push({ client: c, calculated: calc, status, target, invoices: invoicedBy })
          }
          return rows.sort((a, b) => (a.client.trade_name || '').localeCompare(b.client.trade_name || ''))
        }

        if (cancelled) return
        // Rabona first, then Espargos (matches how the emails are written).
        const ordered = [...(comps || [])].sort((a, b) =>
          (a.code === 'RH' ? 0 : 1) - (b.code === 'RH' ? 0 : 1))
        setCompanies(ordered.map(c => ({
          ...c,
          invoices: (inv || []).filter(i => i.company_id === c.id),
          expenseCalc: expenseCalcFor(c.id),
        })))
        setClientsById(new Map((cl || []).map(c => [c.id, c])))
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [month, year])

  const genSubject = useMemo(() => buildAccountantSubject(companies, month, year), [companies, month, year])
  const genBody    = useMemo(() => buildAccountantBody(companies, clientsById, month, year), [companies, clientsById, month, year])
  const subject = subjectOv ?? genSubject
  const body    = bodyOv ?? genBody
  const total   = companies.reduce((s, c) => s + c.invoices.length, 0)
  const voided  = companies.flatMap(c => c.invoices).filter(i => i.status === 'voided').length

  const open = () => window.open(buildOutlookComposeUrl({ to, cc, subject, body }), '_blank', 'noopener')

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 900, width: '95%' }}>
        <div className="modal-header">
          <h3>📨 Accountant Email — Invoices Issued</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <label style={{ fontSize: 13 }}>Invoices issued in</label>
            <select className="form-input" style={{ width: 150 }} value={month} onChange={e => setMonth(parseInt(e.target.value, 10))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select className="form-input" style={{ width: 100 }} value={year} onChange={e => setYear(parseInt(e.target.value, 10))}>
              {[selectedYear - 1, selectedYear, selectedYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <small style={{ color: '#6b7280', display: 'block', marginBottom: 10 }}>
            Uses the <strong>Date Issued</strong> of each invoice (not the billing period), both companies. Credit notes are placed after the invoice they credit; pro formas excluded. Expense reimbursement calculated for the month is shown per project with its status (invoiced / deferred / not yet invoiced).
          </small>

          {loading && <div className="message">Loading invoices…</div>}
          {error   && <div className="message error">{error}</div>}
          {!loading && !error && (
            <div style={{ fontSize: 13, marginBottom: 10 }}>
              {companies.map(c => <span key={c.id} style={{ marginRight: 14 }}><strong>{c.name}:</strong> {c.invoices.length}</span>)}
              {voided > 0 && <span style={{ color: '#b45309' }}>⚠ {voided} voided — check whether to include</span>}
              {total === 0 && <span style={{ color: '#6b7280' }}>No invoices issued this month.</span>}
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 12 }}>To</label>
            <input type="text" className="form-input" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 12 }}>Cc</label>
            <input type="text" className="form-input" value={cc} onChange={e => setCc(e.target.value)} placeholder="(optional)" />
          </div>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 12 }}>Subject</label>
            <input type="text" className="form-input" value={subject} onChange={e => setSubjectOv(e.target.value)} />
          </div>
          <div className="form-group" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 12 }}>Body</label>
            <textarea className="form-input" rows={18} value={body} onChange={e => setBodyOv(e.target.value)}
              style={{ fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={open} disabled={loading}
              style={{ background: '#185FA5', color: 'white', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              📧 Open in Outlook
            </button>
            {(subjectOv !== null || bodyOv !== null) && (
              <button type="button" className="btn-secondary" onClick={() => { setSubjectOv(null); setBodyOv(null) }}>
                ↺ Reset text
              </button>
            )}
          </div>
          <small style={{ color: '#9ca3af', fontSize: 11, marginTop: 6, display: 'block' }}>
            💡 Opens in Outlook on the web (company account) — attach the invoice PDFs and the checklist before sending.
          </small>
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 12, borderTop: '1px solid #e5e7eb' }}>
          <button onClick={onClose} className="btn-cancel">Close</button>
        </div>
      </div>
    </div>
  )
}
