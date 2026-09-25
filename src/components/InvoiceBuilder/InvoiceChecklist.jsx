import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { resolveMonthlyFee } from '../../lib/feePhases'

/**
 * InvoiceChecklist — printable monthly invoicing checklist (Issue Invoice tab).
 *
 * One line per project and per thing to invoice in the top-bar month:
 * monthly fee, fixed expense reimbursement, variable expense reports,
 * plus any one-off / credit note / pro forma filed in the month.
 * READ-ONLY: it only reads invoices, deferrals, expenses and fee phases.
 *
 * Status per line:
 *   Issued   — invoice row with number + issue date
 *   Draft    — invoice row exists but no number / date yet
 *   To do    — expected this month, no invoice row yet
 *   Deferred — this month's amount was deferred to a later month
 *   Invoiced earlier / in advance — covered by an invoice filed in another month
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const mShort = (m) => MONTHS[(m || 1) - 1].slice(0, 3)
const euro = (n) => '€' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const key = (y, m) => `${y}-${m}`
const before = (y1, m1, y2, m2) => y1 < y2 || (y1 === y2 && m1 < m2)

const TYPE_ORDER = { monthly_fee: 1, fixed_expense: 2, variable_expense: 3, one_off_service: 4, one_off_reimbursement: 5, credit_note: 6, pro_forma: 7 }
const TYPE_LABEL = {
  monthly_fee: 'Monthly fee', fixed_expense: 'Fixed expenses', variable_expense: 'Variable expenses',
  one_off_service: 'One-off service', one_off_reimbursement: 'One-off reimbursement',
  credit_note: 'Credit note', pro_forma: 'Pro forma',
}

function covers(inv) {
  return inv.represents_period_year && inv.represents_period_month
    ? { y: inv.represents_period_year, m: inv.represents_period_month }
    : { y: inv.period_year, m: inv.period_month }
}
function rowStatus(rows) {
  const r = rows[0]
  const issued = !!(r.invoice_number && r.date_issued)
  return {
    status: issued ? 'Issued' : 'Draft',
    number: r.invoice_number || '', date: r.date_issued || '',
    issued, emailed: rows.every(x => x.email_sent_at), soa: rows.every(x => x.soa_updated_at_issue),
    paid: rows.every(x => x.date_paid),
  }
}

export function InvoiceChecklist({ selectedCompany, selectedMonth, selectedYear }) {
  const [state, setState] = useState({ loading: true, error: null, lines: [], companyName: selectedCompany })

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setState(s => ({ ...s, loading: true, error: null }))
      try {
        const Y = selectedYear, M = selectedMonth
        const { data: comp, error: cErr } = await supabase
          .from('companies').select('id').eq('name', selectedCompany).single()
        if (cErr) throw cErr
        const cid = comp.id
        const [clRes, invRes, defRes, expRes] = await Promise.all([
          supabase.from('clients').select('*').eq('company_id', cid).eq('active', true),
          supabase.from('invoices').select('*').eq('company_id', cid),
          supabase.from('expense_deferrals').select('*').eq('company_id', cid),
          supabase.from('expenses').select('client_name, amount, main_ref_year, main_ref_month')
            .eq('company_id', cid).eq('is_reimbursable', true).not('client_name', 'is', null),
        ])
        for (const r of [clRes, invRes, defRes, expRes]) if (r.error) throw r.error
        const clients = clRes.data || []
        const invs = invRes.data || []
        const defs = defRes.data || []
        const exps = expRes.data || []
        // Fee phases: optional (fail-soft if V38 not present).
        let phases = []
        if (clients.length) {
          const { data: ph } = await supabase.from('client_fee_phases').select('*').in('client_id', clients.map(c => c.id))
          phases = ph || []
        }

        const lines = []
        const name = (c) => c.trade_name || c.legal_name
        const defType = (d) => d.invoice_type || 'variable_expense'

        for (const c of clients) {
          const cInvs = invs.filter(i => i.client_id === c.id)
          const cPhases = phases.filter(p => p.client_id === c.id)
          const cDefs = defs.filter(d => d.client_id === c.id)
          const vat = Number(c.vat_rate || 0)
          const push = (o) => lines.push({ project: name(c), vat, ...o })

          // ---- Monthly fee + fixed expenses ------------------------------
          for (const T of ['monthly_fee', 'fixed_expense']) {
            const feeFor = (y, m) => T === 'monthly_fee'
              ? (y === Y ? resolveMonthlyFee(c, cPhases, y, m).amount : Number(c.monthly_fee_net || 0))
              : Number(c.monthly_fixed_expense_net || 0)
            const expected = T === 'monthly_fee'
              ? (Number(c.monthly_fee_net || 0) > 0 || cPhases.some(p => p.kind === 'monthly'))
              : Number(c.monthly_fixed_expense_net || 0) > 0
            const tInvs = cInvs.filter(i => i.invoice_type === T)
            const filedHere = tInvs.filter(i => i.period_year === Y && i.period_month === M)
            // Group rows that share a number (one document, several months).
            const groups = new Map()
            filedHere.forEach(i => {
              const k = i.invoice_number ? `n:${i.invoice_number}` : `id:${i.id}`
              groups.set(k, [...(groups.get(k) || []), i])
            })
            for (const rows of groups.values()) {
              rows.sort((a, b) => { const A = covers(a), B = covers(b); return (A.y - B.y) || (A.m - B.m) })
              const what = rows.map(r => {
                const cv = covers(r)
                const tag = before(Y, M, cv.y, cv.m) ? ' (advance)' : before(cv.y, cv.m, Y, M) ? ' (late)' : ''
                return `${mShort(cv.m)} ${cv.y}${tag}`
              }).join(' + ')
              push({ type: T, what: `${TYPE_LABEL[T]}: ${what}`,
                amount: rows.reduce((s, r) => s + Number(r.amount_total || 0), 0), ...rowStatus(rows), billable: true })
            }
            const coveredAnywhere = new Set(tInvs.map(i => { const cv = covers(i); return key(cv.y, cv.m) }))
            const coveredHere = new Set(filedHere.map(i => { const cv = covers(i); return key(cv.y, cv.m) }))

            // This month's own amount.
            if (expected && !coveredHere.has(key(Y, M))) {
              const elsewhere = tInvs.find(i => { const cv = covers(i); return cv.y === Y && cv.m === M &&
                !(i.period_year === Y && i.period_month === M) })
              const out = cDefs.find(d => defType(d) === T && d.source_year === Y && d.source_month === M)
              if (elsewhere) {
                const adv = before(elsewhere.period_year, elsewhere.period_month, Y, M)
                push({ type: T, what: `${TYPE_LABEL[T]}: ${mShort(M)} ${Y}`, amount: Number(elsewhere.amount_total || 0),
                  status: adv ? `Invoiced in advance (${mShort(elsewhere.period_month)})` : `Invoiced later (${mShort(elsewhere.period_month)})`,
                  number: elsewhere.invoice_number || '', date: elsewhere.date_issued || '',
                  issued: true, emailed: !!elsewhere.email_sent_at, soa: !!elsewhere.soa_updated_at_issue, paid: !!elsewhere.date_paid,
                  billable: false, muted: true })
              } else if (out) {
                push({ type: T, what: `${TYPE_LABEL[T]}: ${mShort(M)} ${Y}`, amount: null,
                  status: `Deferred to ${mShort(out.target_month)} ${out.target_year}`, billable: false, muted: true })
              } else {
                const amt = feeFor(Y, M)
                push({ type: T, what: `${TYPE_LABEL[T]}: ${mShort(M)} ${Y}`,
                  amount: amt == null ? null : amt * (T === 'monthly_fee' ? 1 + vat : 1),
                  status: amt == null ? 'To do (no fee phase)' : 'To do', todo: true, billable: true })
              }
            }
            // Deferred INTO this month and not invoiced anywhere yet.
            for (const d of cDefs.filter(d => defType(d) === T && d.target_year === Y && d.target_month === M)) {
              if (coveredAnywhere.has(key(d.source_year, d.source_month))) continue
              const amt = feeFor(d.source_year, d.source_month)
              push({ type: T, what: `${TYPE_LABEL[T]}: ${mShort(d.source_month)} ${d.source_year} (deferred in)`,
                amount: amt == null ? null : amt * (T === 'monthly_fee' ? 1 + vat : 1),
                status: 'To do', todo: true, billable: true })
            }
          }

          // ---- Variable expenses -----------------------------------------
          const vInvs = cInvs.filter(i => i.invoice_type === 'variable_expense')
          const vDefs = cDefs.filter(d => defType(d) === 'variable_expense')
          const vDefBySrc = new Map(vDefs.map(d => [key(d.source_year, d.source_month), d]))
          for (const i of vInvs.filter(i => i.period_year === Y && i.period_month === M)) {
            const cp = Array.isArray(i.covered_expense_periods) ? i.covered_expense_periods : []
            const what = cp.length
              ? cp.map(p => `${mShort(p.month)} ${p.year}`).join(' + ')
              : (i.description || '').split('\n').pop().slice(0, 60)
            push({ type: 'variable_expense', what: `Variable expenses: ${what}`, amount: Number(i.amount_total || 0),
              ...rowStatus([i]), billable: true })
          }
          // Reports not yet invoiced and billable now.
          const names = [c.trade_name, c.legal_name].filter(Boolean).map(s => s.trim().toLowerCase())
          const byMonth = new Map()
          for (const e of exps) {
            if (!names.includes((e.client_name || '').trim().toLowerCase())) continue
            if (!e.main_ref_year || !e.main_ref_month) continue
            const k = key(Number(e.main_ref_year), Number(e.main_ref_month))
            byMonth.set(k, (byMonth.get(k) || 0) + Number(e.amount || 0))
          }
          const covered = new Set()
          for (const iv of vInvs) {
            const cp = Array.isArray(iv.covered_expense_periods) ? iv.covered_expense_periods : []
            if (cp.length) { cp.forEach(p => covered.add(key(p.year, p.month))); continue }
            const pk = key(iv.period_year, iv.period_month)
            if (!vDefBySrc.has(pk)) covered.add(pk)
            vDefs.forEach(d => { if (d.target_year === iv.period_year && d.target_month === iv.period_month) covered.add(key(d.source_year, d.source_month)) })
          }
          const open = []
          for (const [k, amt] of byMonth) {
            if (amt <= 0 || covered.has(k)) continue
            const [y, m] = k.split('-').map(Number)
            const d = vDefBySrc.get(k)
            const due = d ? !before(Y, M, d.target_year, d.target_month) : before(y, m, Y, M)
            if (due) open.push({ y, m, amt, deferred: !!d })
          }
          open.sort((a, b) => (a.y - b.y) || (a.m - b.m))
          if (open.length) {
            push({ type: 'variable_expense',
              what: `Variable expenses: ${open.map(o => `${mShort(o.m)} ${o.y}${o.deferred ? ' (deferred in)' : ''}`).join(' + ')}`,
              amount: open.reduce((s, o) => s + o.amt, 0), status: 'To do', todo: true, billable: true })
          }

          // ---- One-offs / credit notes / pro formas filed this month -------
          for (const i of cInvs.filter(i => i.period_year === Y && i.period_month === M &&
            ['one_off_service', 'one_off_reimbursement', 'credit_note', 'pro_forma'].includes(i.invoice_type))) {
            const neg = i.invoice_type === 'credit_note'
            push({ type: i.invoice_type,
              what: `${TYPE_LABEL[i.invoice_type]}: ${(i.description || '').split('\n')[0].slice(0, 60)}`,
              amount: Number(i.amount_total || 0) * (neg ? -1 : 1), ...rowStatus([i]),
              billable: i.invoice_type !== 'pro_forma' })
          }
        }

        lines.sort((a, b) => a.project.localeCompare(b.project) || (TYPE_ORDER[a.type] || 9) - (TYPE_ORDER[b.type] || 9))
        if (!cancelled) setState({ loading: false, error: null, lines, companyName: selectedCompany })
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err.message || 'Could not build the checklist.', lines: [], companyName: selectedCompany })
      }
    }
    run()
    return () => { cancelled = true }
  }, [selectedCompany, selectedMonth, selectedYear])

  const { loading, error, lines } = state
  const billable = lines.filter(l => l.billable && l.amount != null)
  const total = billable.reduce((s, l) => s + l.amount, 0)
  const issuedTotal = billable.filter(l => l.issued).reduce((s, l) => s + l.amount, 0)
  const todoCount = lines.filter(l => l.todo || l.status === 'Draft').length
  const box = (on) => (on ? '☑' : '☐')

  return (
    <div className="ib-checklist">
      <div className="ib-cl-head">
        <div>
          <div className="ib-cl-title">Invoicing checklist — {selectedCompany}</div>
          <div className="ib-cl-sub">{MONTHS[selectedMonth - 1]} {selectedYear} · printed {new Date().toLocaleDateString('en-GB')}</div>
        </div>
        {!loading && !error && (
          <div className="ib-cl-sum">
            <div><span>To bill this month</span><strong>{euro(total)}</strong></div>
            <div><span>Issued so far</span><strong>{euro(issuedTotal)}</strong></div>
            <div><span>Still to do</span><strong>{todoCount} line{todoCount === 1 ? '' : 's'}</strong></div>
          </div>
        )}
      </div>

      {loading ? <div className="ib-muted">Building the checklist…</div>
        : error ? <div className="ib-error">{error}</div>
        : lines.length === 0 ? <div className="ib-muted">Nothing to invoice this month.</div>
        : (
          <table className="ib-cl-table">
            <thead>
              <tr>
                <th>Project</th><th>What to invoice</th><th className="a">Amount (incl. VAT)</th>
                <th>Status</th><th>Inv. no.</th><th>Issued on</th>
                <th className="c">Issued</th><th className="c">Emailed</th><th className="c">SOA</th><th className="c">Paid</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const first = i === 0 || lines[i - 1].project !== l.project
                return (
                  <tr key={i} className={[first ? 'first' : '', l.todo ? 'todo' : '', l.muted ? 'muted' : ''].join(' ')}>
                    <td className="p">{first ? l.project : ''}</td>
                    <td>{l.what}</td>
                    <td className="a">{l.amount == null ? '—' : euro(l.amount)}</td>
                    <td className="s">{l.status}</td>
                    <td className="n">{l.number || ''}</td>
                    <td className="n">{dmy(l.date)}</td>
                    <td className="c">{l.muted && !l.issued ? '' : box(l.issued)}</td>
                    <td className="c">{l.muted && !l.issued ? '' : box(l.emailed)}</td>
                    <td className="c">{l.muted && !l.issued ? '' : box(l.soa)}</td>
                    <td className="c">{l.muted && !l.issued ? '' : box(l.paid)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr><td colSpan={2}>Total to bill in {MONTHS[selectedMonth - 1]} {selectedYear}</td><td className="a">{euro(total)}</td><td colSpan={7}></td></tr>
            </tfoot>
          </table>
        )}
      <div className="ib-cl-note">
        Amounts include VAT where it applies; credit notes are shown negative. Grey lines are already
        invoiced in another month or deferred — do not invoice them again. Notes: ____________________________________________
      </div>
    </div>
  )
}
