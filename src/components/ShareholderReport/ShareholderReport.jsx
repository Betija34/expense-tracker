import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { PrintLetterhead } from '../PrintLetterhead/PrintLetterhead'
import './ShareholderReport.css'

/**
 * Shareholder Report — per-shareholder ledger for the selected company / month.
 *
 * Sections (per shareholder, matches the V4 PDF):
 *   1. Transfers TO Shareholder Account
 *      = outgoing bank-paid, subcategory matches "Transfers to SH A/C" / "Cash Withdrawal"
 *   2. Payments on Behalf of Shareholder
 *      = outgoing bank-paid, subcategory matches "Payments Made on Behalf"
 *   3. Transfers FROM Shareholder
 *      = incoming "Shareholder Funding" tagged with shareholder_code
 *   4. Allowances (€daily_rate × travel_days)
 *      = persisted in shareholder_allowances (V5 table). Manually entered for now;
 *        will be auto-populated from the Travel Log when Part 6 is built.
 *   5. Cash Expenses paid by Shareholder
 *      = outgoing cash (account_id IS NULL) tagged with shareholder_code
 *
 * Net Balance:
 *   = transfers_from + cash_expenses + allowances
 *   − transfers_to     − payments_on_behalf
 *
 *   Positive  → company owes shareholder
 *   Negative  → shareholder owes company
 */

const SHAREHOLDERS = ['YK', 'BK']

export function ShareholderReport({ selectedCompany, selectedMonth, selectedYear, onSwitchTab }) {
  const [companyId, setCompanyId] = useState(null)
  const [expenses, setExpenses] = useState([])
  // allowances[code] = { id, daily_rate } or null if no row yet.
  // Note: travel_days is no longer stored here — it's derived from travel_periods (Travel Log).
  // The shareholder_allowances row is now only used to remember the daily_rate per month.
  const [allowances, setAllowances] = useState({ YK: null, BK: null })
  const [travelPeriods, setTravelPeriods] = useState([])     // all travel periods this month for this company
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [allowancesSaving, setAllowancesSaving] = useState({ YK: false, BK: false })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        // Company
        const { data: comp, error: compErr } = await supabase
          .from('companies')
          .select('id')
          .eq('name', selectedCompany)
          .single()
        if (compErr) throw compErr
        if (cancelled) return
        setCompanyId(comp.id)

        // All expenses for the period that are tagged with a shareholder OR are
        // Shareholder Funding (which is always shareholder-tagged anyway)
        const { data: exps, error: expErr } = await supabase
          .from('expenses')
          .select('*, expense_categories(name), accounts(name)')
          .eq('company_id', comp.id)
          .eq('main_ref_year', selectedYear)
          .eq('main_ref_month', selectedMonth)
          .not('shareholder_code', 'is', null)
        if (expErr) throw expErr
        if (cancelled) return
        setExpenses(exps || [])

        // Allowance rows for both shareholders (we now only use daily_rate from these)
        const { data: allowanceRows, error: allowErr } = await supabase
          .from('shareholder_allowances')
          .select('*')
          .eq('company_id', comp.id)
          .eq('year', selectedYear)
          .eq('month', selectedMonth)
        if (allowErr) throw allowErr
        if (cancelled) return

        const allowMap = { YK: null, BK: null }
        for (const r of (allowanceRows || [])) {
          allowMap[r.shareholder_code] = r
        }
        setAllowances(allowMap)

        // Travel periods whose from_date falls within the selected month — used to
        // compute Allowances Travel Days automatically (replaces the old manual input).
        // Same logic as the Travel Log tab.
        const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
        const monthStart = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`
        const monthEnd = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
        const { data: periodRows, error: periodErr } = await supabase
          .from('travel_periods')
          .select('*')
          .eq('company_id', comp.id)
          .gte('from_date', monthStart)
          .lte('from_date', monthEnd)
          .order('from_date')
        if (periodErr) throw periodErr
        if (cancelled) return
        setTravelPeriods(periodRows || [])
      } catch (e) {
        console.error('ShareholderReport load error:', e)
        if (!cancelled) setError(e.message || 'Failed to load shareholder report')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedCompany, selectedMonth, selectedYear])

  // -------------------------------------------------------------
  // Save daily rate change for a shareholder (upserts the row).
  // Travel days are no longer saved here — they come from travel_periods.
  // -------------------------------------------------------------
  const updateAllowance = async (code, patch) => {
    if (!companyId) return
    setAllowancesSaving(s => ({ ...s, [code]: true }))
    try {
      const existing = allowances[code]
      const payload = {
        company_id: companyId,
        shareholder_code: code,
        year: selectedYear,
        month: selectedMonth,
        // Keep the schema column populated with whatever the derived value is at save
        // time (mainly for backward-compat / SQL queries that read the column directly).
        travel_days: patch.travel_days ?? existing?.travel_days ?? 0,
        daily_rate:  patch.daily_rate  ?? existing?.daily_rate  ?? 150,
        notes:       patch.notes       ?? existing?.notes       ?? null,
        updated_at: new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from('shareholder_allowances')
        .upsert(payload, { onConflict: 'company_id,shareholder_code,year,month' })
        .select()
        .single()
      if (error) throw error
      setAllowances(prev => ({ ...prev, [code]: data }))
    } catch (e) {
      console.error('Allowance save error:', e)
      alert('Failed to save allowance: ' + (e.message || e))
    } finally {
      setAllowancesSaving(s => ({ ...s, [code]: false }))
    }
  }

  // -------------------------------------------------------------
  // Compute unique in-month travel days for a given shareholder.
  // Same algorithm as Travel Log: clamp each period to the selected month,
  // collect every covered ISO date into a Set, return the set size.
  // -------------------------------------------------------------
  const computeTravelDays = (code) => {
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
    const mm = String(selectedMonth).padStart(2, '0')
    const monthStart = `${selectedYear}-${mm}-01`
    const monthEnd = `${selectedYear}-${mm}-${String(lastDay).padStart(2, '0')}`
    const periods = travelPeriods.filter(p => p.shareholder_code === code)
    const uniqueDays = new Set()
    for (const p of periods) {
      const clampStart = p.from_date < monthStart ? monthStart : p.from_date
      const clampEnd   = p.to_date   > monthEnd   ? monthEnd   : p.to_date
      const cur = new Date(clampStart + 'T00:00:00')
      const end = new Date(clampEnd + 'T00:00:00')
      while (cur <= end) {
        uniqueDays.add(cur.toISOString().slice(0, 10))
        cur.setDate(cur.getDate() + 1)
      }
    }
    return { travelDays: uniqueDays.size, periodCount: periods.length }
  }

  // -------------------------------------------------------------
  // Per-shareholder aggregation
  // -------------------------------------------------------------
  const computeStats = (code) => {
    const sum = (arr) => arr.reduce((s, e) => s + Number(e.amount || 0), 0)
    const my = expenses.filter(e => e.shareholder_code === code)
    const outgoing = my.filter(e => e.direction === 'out')
    const incoming = my.filter(e => e.direction === 'in')

    // Section 1: transfers TO shareholder (bank-paid, subcategory transfer/withdrawal)
    const transfersTo = outgoing.filter(e =>
      e.account_id && matchesTransferSubcat(e.subcategory_name)
    )

    // Section 2: payments on behalf (bank-paid, subcategory payment-on-behalf)
    const paymentsOnBehalf = outgoing.filter(e =>
      e.account_id && matchesBehalfSubcat(e.subcategory_name)
    )

    // Section 5: cash expenses (account_id IS NULL)
    const cashExpenses = outgoing.filter(e => !e.account_id)

    // Catch-all: any bank-paid outgoing tagged with shareholder_code that doesn't
    // match either subcategory pattern (could be miscategorized — surface to user)
    const otherBankOutgoing = outgoing.filter(e =>
      e.account_id &&
      !matchesTransferSubcat(e.subcategory_name) &&
      !matchesBehalfSubcat(e.subcategory_name)
    )

    // Section 3: transfers FROM shareholder (incoming Shareholder Funding)
    const transfersFrom = incoming.filter(e =>
      e.expense_categories?.name === 'Shareholder Funding'
    )
    const otherIncoming = incoming.filter(e =>
      e.expense_categories?.name !== 'Shareholder Funding'
    )

    // Allowances — travel_days is now AUTO-DERIVED from the Travel Log (travel_periods),
    // not stored manually. daily_rate is still per-shareholder per-month in shareholder_allowances.
    const allowance = allowances[code]
    const { travelDays, periodCount } = computeTravelDays(code)
    const dailyRate  = Number(allowance?.daily_rate) || 150
    const allowanceTotal = travelDays * dailyRate

    const sumTo    = sum(transfersTo)
    const sumBehalf = sum(paymentsOnBehalf)
    const sumFrom   = sum(transfersFrom)
    const sumCash   = sum(cashExpenses)
    const sumOtherOut = sum(otherBankOutgoing)
    const sumOtherIn  = sum(otherIncoming)

    // Net Balance — positive = company owes shareholder
    const balance =
      sumFrom + sumCash + allowanceTotal + sumOtherIn
      - sumTo - sumBehalf - sumOtherOut

    return {
      transfersTo, sumTo,
      paymentsOnBehalf, sumBehalf,
      transfersFrom, sumFrom,
      cashExpenses, sumCash,
      otherBankOutgoing, sumOtherOut,
      otherIncoming, sumOtherIn,
      travelDays, periodCount, dailyRate, allowanceTotal,
      balance,
    }
  }

  if (loading) return <div className="loading">Loading shareholder report…</div>
  if (error) return <div className="error">{error}</div>

  const monthLabel = `${String(selectedMonth).padStart(2, '0')}/${selectedYear}`

  // CSS that overrides the global landscape @page (set in App.css) and forces
  // A4 portrait for the duration of the print. Injected before window.print()
  // and removed via the afterprint event. Same robust pattern used in Travel Log.
  const PORTRAIT_PRINT_CSS = `
    @media print {
      @page {
        size: A4 portrait;
        margin: 1.5cm 1cm 1.5cm 1cm;
        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
          font-size: 10px;
          color: #6b7280;
        }
      }
    }
  `

  // Single helper handling all three print modes (All / YK only / BK only).
  const printShareholderReport = (onlyShareholder = null) => {
    const cleanups = []

    const styleEl = document.createElement('style')
    styleEl.textContent = PORTRAIT_PRINT_CSS
    document.head.appendChild(styleEl)
    cleanups.push(() => styleEl.remove())

    if (onlyShareholder) {
      const cls = `print-only-${onlyShareholder}`
      document.body.classList.add(cls)
      cleanups.push(() => document.body.classList.remove(cls))
    }

    const cleanup = () => {
      cleanups.forEach(fn => fn())
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  const handlePrintAll = () => printShareholderReport()
  const handlePrintShareholder = (code) => printShareholderReport(code)

  return (
    <div className="shareholder-report" style={{
      background: 'white',
      padding: 20,
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      {/* Toolbar — hidden in print. Three print options matching Travel Log:
            - Print All: both shareholders, page-break between them
            - Print YK: only YK block (BK hidden via body class)
            - Print BK: only BK block (YK hidden via body class) */}
      <div className="action-bar no-print">
        <button onClick={handlePrintAll} className="toolbar-btn primary">🖨 Print All</button>
        <button onClick={() => handlePrintShareholder('YK')} className="toolbar-btn">🖨 Print YK</button>
        <button onClick={() => handlePrintShareholder('BK')} className="toolbar-btn">🖨 Print BK</button>
      </div>

      {/* Unified letterhead — shows on screen AND in print (text left / logo right). */}
      <PrintLetterhead
        companyName={selectedCompany}
        reportTitle="Shareholder Report"
        periodLabel={`Period: ${monthLabel}`}
      />

      {/* Helper note + jump-to anchors — only useful on screen, hidden in print */}
      <div className="no-print" style={{ marginBottom: 16 }}>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 8px' }}>
          Net balance per shareholder: positive = company owes shareholder, negative = shareholder owes company
        </p>
        <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
          <a href="#sh-YK" style={anchorLink}>Jump to YK ↓</a>
          <a href="#sh-BK" style={anchorLink}>Jump to BK ↓</a>
        </div>
      </div>

      {SHAREHOLDERS.map(code => (
        <ShareholderBlock
          key={code}
          code={code}
          stats={computeStats(code)}
          allowance={allowances[code]}
          saving={allowancesSaving[code]}
          companyName={selectedCompany}
          onUpdateAllowance={(patch) => updateAllowance(code, patch)}
          onSwitchTab={onSwitchTab}
        />
      ))}
    </div>
  )
}

// =============================================================
// Helpers
// =============================================================
function matchesTransferSubcat(subName) {
  if (!subName) return false
  const s = subName.toLowerCase()
  return s.includes('transfer') || s.includes('withdrawal')
}
function matchesBehalfSubcat(subName) {
  if (!subName) return false
  return subName.toLowerCase().includes('behalf')
}

const anchorLink = {
  color: '#185FA5', textDecoration: 'underline', fontSize: 13,
}

const fmt = (n) => `€${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// =============================================================
// One shareholder's full block
// =============================================================
function ShareholderBlock({ code, stats, allowance, saving, companyName, onUpdateAllowance, onSwitchTab }) {
  return (
    <div
      id={`sh-${code}`}
      className="shareholder-block"
      data-code={code}
      style={{
        marginTop: 24, paddingTop: 16, borderTop: '2px solid #e5e7eb',
      }}
    >
      <h3 style={{ margin: 0, color: '#3730a3', fontSize: 18 }}>
        {code} Shareholder Report
      </h3>

      {/* Section 1 */}
      <SectionWithTable
        number="1"
        title="Transfers to Shareholder Account"
        emptyText="No items"
        rows={stats.transfersTo}
        total={stats.sumTo}
        totalColor="#dc2626"
        totalLabel={`Total Transfers: ${fmt(stats.sumTo)}`}
      />

      {/* Section 2 */}
      <SectionWithTable
        number="2"
        title={`Payments Made on Behalf of ${code}`}
        emptyText="No items"
        rows={stats.paymentsOnBehalf}
        total={stats.sumBehalf}
        totalColor="#dc2626"
        totalLabel={`Total Payments on Behalf: ${fmt(stats.sumBehalf)}`}
      />

      {/* Section 3 */}
      <SectionWithTable
        number="3"
        title="Transfers from Shareholder Account"
        emptyText="No items"
        rows={stats.transfersFrom}
        total={stats.sumFrom}
        totalColor="#16a34a"
        totalLabel={`Total Transfers from Shareholder: ${fmt(stats.sumFrom)}`}
        amountSign="positive-in"
      />

      {/* Section 4 — Allowances. Travel Days now derived from Travel Log;
          only Daily Rate is editable.
          Hidden for Espargos because shareholders don't travel from Espargos
          (matches the Travel Log tab hide in App.jsx). To re-enable, remove
          the `companyName !== 'Espargos' &&` condition. */}
      {companyName !== 'Espargos' && (
        <AllowanceSection
          number="4"
          code={code}
          allowance={allowance}
          saving={saving}
          onUpdate={onUpdateAllowance}
          total={stats.allowanceTotal}
          travelDays={stats.travelDays}
          periodCount={stats.periodCount}
          dailyRate={stats.dailyRate}
          onSwitchTab={onSwitchTab}
        />
      )}

      {/* Section 5 */}
      <SectionWithTable
        number="5"
        title={`Cash Expenses paid by ${code}`}
        emptyText="No items"
        rows={stats.cashExpenses}
        total={stats.sumCash}
        totalColor="#16a34a"
        totalLabel={`Total Cash Expenses: ${fmt(stats.sumCash)}`}
        amountSign="positive-in"
      />

      {/* Catch-all warnings if there's anything that didn't fit subcategory patterns */}
      {(stats.otherBankOutgoing.length > 0 || stats.otherIncoming.length > 0) && (
        <div style={{
          marginTop: 12, padding: 10,
          background: '#fef3c7', border: '1px solid #fcd34d',
          borderRadius: 4, fontSize: 12, color: '#92400e',
        }}>
          ⚠ Items tagged with {code} that didn't match section patterns (included in balance but not listed in sections 1–5 above):
          <ul style={{ margin: '4px 0 0 18px' }}>
            {stats.otherBankOutgoing.length > 0 && (
              <li>{stats.otherBankOutgoing.length} bank outgoing ({fmt(stats.sumOtherOut)}) — categorize via subcategory to land in section 1 or 2.</li>
            )}
            {stats.otherIncoming.length > 0 && (
              <li>{stats.otherIncoming.length} incoming ({fmt(stats.sumOtherIn)}) — not "Shareholder Funding" but tagged with {code}.</li>
            )}
          </ul>
        </div>
      )}

      {/* Net Balance */}
      <NetBalanceCard code={code} stats={stats} companyName={companyName} />
    </div>
  )
}

// =============================================================
// Section with table
// =============================================================
function SectionWithTable({ number, title, rows, total, totalColor, totalLabel, emptyText, amountSign }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{
        fontSize: 14, fontWeight: 600, color: '#1f2937',
        marginBottom: 6,
      }}>
        {number}. {title}
      </div>
      {rows.length === 0 ? (
        <div style={{
          padding: 10, color: '#9ca3af', fontSize: 13, fontStyle: 'italic',
          background: '#f9fafb', borderRadius: 4,
        }}>
          {emptyText}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr style={thRowStyle}>
                  <th style={th}>Date</th>
                  <th style={th}>Ref</th>
                  <th style={th}>Sub-ref</th>
                  <th style={th}>Vendor</th>
                  <th style={th}>Category / Subcategory</th>
                  <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={tdRowStyle}>
                    <td style={td}>{fmtDate(r.date)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{r.reference_number || '—'}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                      {r.sub_ref_series ? `${r.sub_ref_series}${r.sub_ref_month}/${r.sub_ref_seq}` : '—'}
                    </td>
                    <td style={td}>{r.vendor || '—'}</td>
                    <td style={td}>
                      <div>{r.expense_categories?.name || '—'}</div>
                      {r.subcategory_name && (
                        <div style={{ fontSize: 11, color: '#6b7280' }}>→ {r.subcategory_name}</div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>
                      {amountSign === 'positive-in'
                        ? fmt(r.amount)
                        : fmt(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{
            marginTop: 4, padding: '6px 10px',
            background: '#f9fafb', borderRadius: 4,
            display: 'flex', justifyContent: 'flex-end',
            fontSize: 13, fontWeight: 600, color: totalColor,
          }}>
            {totalLabel}
          </div>
        </>
      )}
    </div>
  )
}

// =============================================================
// Allowance section — Travel Days auto-derived from Travel Log;
// Daily Rate editable per month (saved to shareholder_allowances).
// =============================================================
function AllowanceSection({ number, code, allowance, saving, onUpdate, total, travelDays, periodCount, dailyRate, onSwitchTab }) {
  const [rateInput, setRateInput] = useState(String(dailyRate || 150))

  // Sync rate input when allowance changes from outside
  useEffect(() => {
    setRateInput(String(dailyRate || 150))
  }, [dailyRate])

  const commitRate = () => {
    const rate = parseFloat(rateInput) || 150
    if (rate !== Number(allowance?.daily_rate || 150)) {
      onUpdate({ daily_rate: rate })
    }
  }

  return (
    <div className="allowance-section" style={{ marginTop: 16 }}>
      <div style={{
        fontSize: 14, fontWeight: 600, color: '#1f2937',
        marginBottom: 6,
      }}>
        {number}. Allowances Calculated per Month
      </div>
      <div style={{
        background: '#eef2ff', border: '1px solid #c7d2fe',
        borderRadius: 4, padding: 12,
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12,
          alignItems: 'end',
        }}>
          {/* Travel Days — read-only, auto-derived from Travel Log */}
          <div>
            <label style={{ fontSize: 12, color: '#3730a3', display: 'block', marginBottom: 4 }}>
              Travel Days <span style={{ fontWeight: 400, color: '#6366f1' }}>(from Travel Log)</span>
            </label>
            <div style={{
              padding: '6px 10px', fontSize: 18, fontWeight: 700,
              color: '#1f2937', background: 'white',
              border: '1px solid #c7d2fe', borderRadius: 4,
              textAlign: 'center',
            }}>
              {travelDays}
            </div>
          </div>

          {/* Daily Rate — editable */}
          <div>
            <label style={{ fontSize: 12, color: '#3730a3', display: 'block', marginBottom: 4 }}>
              Daily Rate (€) <span style={{ fontWeight: 400, color: '#6366f1' }}>(editable)</span>
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              onBlur={commitRate}
              style={{
                width: '100%', padding: '6px 8px',
                border: '1px solid #c7d2fe', borderRadius: 4,
                fontSize: 14,
              }}
            />
          </div>

          {/* Total Allowance — computed */}
          <div>
            <label style={{ fontSize: 12, color: '#3730a3', display: 'block', marginBottom: 4 }}>
              Total Allowance
            </label>
            <div style={{
              padding: '6px 8px', fontSize: 16, fontWeight: 700,
              color: '#16a34a',
            }}>
              {fmt(total)}
            </div>
          </div>
        </div>

        {/* Helper line — explain where the days come from + offer a link */}
        <div style={{ fontSize: 11, color: '#4338ca', marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>
            {saving
              ? '💾 Saving daily rate…'
              : <>Travel days = unique in-month dates across {periodCount} {code} travel period{periodCount === 1 ? '' : 's'} (clamped to month).</>}
          </span>
          {onSwitchTab && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onSwitchTab('travel') }}
              style={{ color: '#185FA5', textDecoration: 'underline', whiteSpace: 'nowrap' }}
            >
              Edit travel periods in Travel Log →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================
// Net Balance card
// =============================================================
function NetBalanceCard({ code, stats, companyName }) {
  const isPositive = stats.balance >= 0
  return (
    <div className="net-balance-card" style={{
      marginTop: 16,
      background: isPositive ? '#f0fdf4' : '#fef2f2',
      border: `2px solid ${isPositive ? '#86efac' : '#fca5a5'}`,
      borderRadius: 6, padding: 14,
    }}>
      <div style={{
        fontSize: 14, fontWeight: 700, marginBottom: 8,
        color: isPositive ? '#15803d' : '#991b1b',
      }}>
        Net Balance for {code}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13,
      }}>
        {/* LEFT — items that REDUCE what the company owes the shareholder
            (company paid out to / on behalf of shareholder) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <BreakdownRow label="Transfers to Shareholder" value={-stats.sumTo} />
          <BreakdownRow label="Payments on Behalf"        value={-stats.sumBehalf} />
          {stats.sumOtherOut > 0 && (
            <BreakdownRow label="Other bank outgoing tagged" value={-stats.sumOtherOut} />
          )}
        </div>

        {/* RIGHT — items that INCREASE what the company owes the shareholder
            (shareholder gave money to the company or paid out of pocket) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <BreakdownRow label="Transfers from Shareholder" value={stats.sumFrom} />
          <BreakdownRow label="Cash Expenses (out of pocket)" value={stats.sumCash} />
          {companyName !== 'Espargos' && (
            <BreakdownRow label="Allowances" value={stats.allowanceTotal} />
          )}
          {stats.sumOtherIn > 0 && (
            <BreakdownRow label="Other incoming tagged" value={stats.sumOtherIn} />
          )}
        </div>
      </div>
      <div style={{
        marginTop: 12, paddingTop: 10,
        borderTop: `1px dashed ${isPositive ? '#86efac' : '#fca5a5'}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span style={{ fontSize: 14, color: '#1f2937', fontWeight: 600 }}>
          Balance
        </span>
        <span style={{
          fontSize: 22, fontWeight: 800,
          color: isPositive ? '#15803d' : '#991b1b',
        }}>
          {fmt(stats.balance)}
        </span>
      </div>
      <div style={{
        marginTop: 4, fontSize: 12, color: '#6b7280', textAlign: 'right',
      }}>
        {isPositive
          ? `Company owes ${code}`
          : `${code} owes company`}
      </div>
    </div>
  )
}

function BreakdownRow({ label, value }) {
  const isPos = value >= 0
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between',
      padding: '4px 8px', background: 'white', borderRadius: 3,
    }}>
      <span style={{ color: '#374151' }}>{label}</span>
      <span style={{
        fontWeight: 600,
        color: isPos ? '#15803d' : '#991b1b',
      }}>
        {isPos ? '+' : '−'}€{Math.abs(value).toFixed(2)}
      </span>
    </div>
  )
}

// =============================================================
// Table style constants
// =============================================================
const tableStyle = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13,
  background: 'white', border: '1px solid #e5e7eb', borderRadius: 4,
}
const thRowStyle = { background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }
const tdRowStyle = { borderBottom: '1px solid #f3f4f6' }
const th = {
  textAlign: 'left', padding: '8px 10px', fontSize: 12,
  color: '#374151', fontWeight: 600,
}
const td = {
  padding: '8px 10px', verticalAlign: 'top',
}
