import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabaseClient'
import { PrintLetterhead } from '../PrintLetterhead/PrintLetterhead'
import { formatMonthYear } from '../../lib/monthUtils'
import './TravelLog.css'

/**
 * Travel Log Management
 *
 * Track and document travel periods + expenses for each shareholder (YK, BK).
 *
 * Data model:
 *   travel_periods (V6 table) — one row per trip, with from/to dates, destination, reason
 *   expenses.travel_where / travel_who / travel_why — per-expense travel metadata,
 *     stored generically and labeled by subcategory in the UI
 *
 * Expense → period auto-grouping:
 *   An expense appears under a period if:
 *     - same company_id and shareholder_code
 *     - expense.date falls within [period.from_date, period.to_date]
 *     - category = "Travel Expenses" (or sub_ref_series = 'T')
 *
 * Totals:
 *   Days Traveled  = sum of (to - from + 1) across periods
 *   Company-Paid   = sum of expense.amount where is_reimbursable = false
 *                    (reimbursable trip expenses are owed by clients, not company)
 */

const SHAREHOLDERS = [
  { code: 'YK', color: '#16a34a', bgLight: '#f0fdf4', bgPanel: '#dcfce7' },
  { code: 'BK', color: '#ea580c', bgLight: '#fff7ed', bgPanel: '#fed7aa' },
]

export function TravelLog({ selectedCompany, selectedMonth, selectedYear, onSwitchTab, onViewExpense }) {
  const [companyId, setCompanyId] = useState(null)
  const [periods, setPeriods] = useState([])              // all periods this month for this company
  const [travelExpenses, setTravelExpenses] = useState([]) // all Travel Expense entries this month
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadTrigger, setReloadTrigger] = useState(0)

  // -------------------------------------------------------------
  // Load periods + expenses for the selected month
  // -------------------------------------------------------------
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

        // Periods whose from_date falls within the selected month
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
        setPeriods(periodRows || [])

        // Travel expenses are always loaded by PAYMENT month. expected_travel_month
        // is a display-only badge ("flight is for August trip"), NOT a routing
        // key — the expense always belongs to the Travel Log of the month it
        // was paid. Otherwise it would disappear from the month where you
        // actually need to see the outflow.
        const { data: expData, error: expErr } = await supabase
          .from('expenses')
          .select('*, expense_categories(name)')
          .eq('company_id', comp.id)
          .eq('main_ref_year', selectedYear)
          .eq('main_ref_month', selectedMonth)
        if (expErr) throw expErr
        if (cancelled) return

        // Only T-series expenses belong in the Travel Log. Reimbursable
        // expenses (sub_ref_series='R') — even when their category is
        // "Travel Expenses" — are NOT travel; they're client work the
        // company will be reimbursed for. The 'R' series wins over 'T'
        // when is_reimbursable=true (see decideSubRefSeries in refUtils),
        // so filtering on sub_ref_series='T' cleanly excludes them.
        const travel = (expData || []).filter(e => e.sub_ref_series === 'T')
        setTravelExpenses(travel)
      } catch (e) {
        console.error('TravelLog load error:', e)
        if (!cancelled) setError(e.message || 'Failed to load travel log')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedCompany, selectedMonth, selectedYear, reloadTrigger])

  const triggerReload = () => setReloadTrigger(n => n + 1)

  // -------------------------------------------------------------
  // CRUD on periods
  // -------------------------------------------------------------
  const addPeriod = async (shareholderCode) => {
    if (!companyId) return
    // Default new period: today (clamped to selected month) for both dates
    const today = new Date()
    const isThisMonth = today.getFullYear() === selectedYear && (today.getMonth() + 1) === selectedMonth
    const defaultDate = isThisMonth
      ? today.toISOString().slice(0, 10)
      : `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`

    const { error } = await supabase
      .from('travel_periods')
      .insert([{
        company_id: companyId,
        shareholder_code: shareholderCode,
        from_date: defaultDate,
        to_date: defaultDate,
        destination: '',
        reason: '',
      }])
    if (error) {
      alert('Failed to add travel period: ' + error.message)
      return
    }
    triggerReload()
  }

  const updatePeriod = async (periodId, patch) => {
    const { error } = await supabase
      .from('travel_periods')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', periodId)
    if (error) {
      alert('Failed to update period: ' + error.message)
      return
    }
    // Optimistic: update local state without reloading
    setPeriods(prev => prev.map(p => p.id === periodId ? { ...p, ...patch } : p))
  }

  const deletePeriod = async (periodId) => {
    if (!window.confirm('Delete this travel period? Its expenses will remain in the system but will no longer be grouped under this period.')) return
    const { error } = await supabase
      .from('travel_periods')
      .delete()
      .eq('id', periodId)
    if (error) {
      alert('Failed to delete period: ' + error.message)
      return
    }
    triggerReload()
  }

  // -------------------------------------------------------------
  // Update expense travel-detail fields (where / who / why)
  // -------------------------------------------------------------
  const updateExpenseDetails = async (expenseId, patch) => {
    const { error } = await supabase
      .from('expenses')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', expenseId)
    if (error) {
      alert('Failed to save: ' + error.message)
      return
    }
    setTravelExpenses(prev => prev.map(e => e.id === expenseId ? { ...e, ...patch } : e))
  }

  if (loading) return <div className="loading">Loading travel log…</div>
  if (error) return <div className="error">{error}</div>

  const monthLabel = `${String(selectedMonth).padStart(2, '0')}/${selectedYear}`

  // CSS that overrides the global landscape @page (set in App.css) and forces
  // A4 portrait for the duration of the print. Injected dynamically right
  // before window.print() and removed afterward via the afterprint event.
  //
  // Why this approach (instead of just CSS): the named-page method (@page
  // travel-portrait + page: travel-portrait on .travel-log) doesn't reliably
  // apply across page breaks in all browsers — some trailing pages after
  // page-break-after revert to the global landscape default. Injecting a
  // global @page override at print time guarantees every page is portrait.
  const TRAVEL_PORTRAIT_CSS = `
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

  // Single helper that handles all three print modes (All / YK only / BK only).
  // Composes the per-shareholder body class with the portrait @page override
  // and registers a single afterprint cleanup that undoes everything.
  const printTravelLog = (onlyShareholder = null) => {
    const cleanups = []

    // 1. Inject the portrait @page override
    const styleEl = document.createElement('style')
    styleEl.textContent = TRAVEL_PORTRAIT_CSS
    document.head.appendChild(styleEl)
    cleanups.push(() => styleEl.remove())

    // 2. If filtering to one shareholder, add the body class that hides the other
    if (onlyShareholder) {
      const cls = `print-only-${onlyShareholder}`
      document.body.classList.add(cls)
      cleanups.push(() => document.body.classList.remove(cls))
    }

    // 3. Run all cleanups after print
    const cleanup = () => {
      cleanups.forEach(fn => fn())
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)

    // 4. Open the browser print dialog
    window.print()
  }

  const handlePrint = () => printTravelLog()
  const handlePrintShareholder = (code) => printTravelLog(code)

  // ----- Excel Export -----
  // Multi-sheet workbook:
  //   - One sheet per shareholder (YK, BK) with their travel periods + expenses
  //   - Sheets are skipped if the shareholder has no data this month
  // Filename: e.g. "RabonaHoldings_TravelLog_2026-01.xlsx"
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new()

    for (const s of SHAREHOLDERS) {
      const myPeriods = periods.filter(p => p.shareholder_code === s.code)
      const myExpenses = travelExpenses.filter(e => e.shareholder_code === s.code)
      // Skip empty shareholders so the workbook stays clean
      if (myPeriods.length === 0 && myExpenses.length === 0) continue

      const rows = []
      rows.push([`${s.code} TRAVEL PERIODS`])
      rows.push(['From', 'To', 'Days', 'Destination', 'Reason'])
      for (const p of myPeriods) {
        const fromD = p.from_date ? new Date(p.from_date) : null
        const toD = p.to_date ? new Date(p.to_date) : null
        const days = (fromD && toD)
          ? Math.round((toD - fromD) / (1000 * 60 * 60 * 24)) + 1
          : ''
        rows.push([
          p.from_date || '',
          p.to_date || '',
          days,
          p.destination || '',
          p.reason || '',
        ])
      }
      rows.push([])
      rows.push([`${s.code} TRAVEL EXPENSES`])
      rows.push(['Date', 'Reference', 'Sub-Ref', 'Vendor', 'Subcategory', 'Where', 'Who', 'Why', 'Amount', 'Reimbursable', 'Client'])
      for (const e of myExpenses) {
        const subRef = e.sub_ref_series
          ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
          : ''
        rows.push([
          e.date || '',
          e.reference_number || '',
          subRef,
          e.vendor || '',
          e.subcategory_name || '',
          e.travel_where || '',
          e.travel_who || '',
          e.travel_why || '',
          Number(e.amount || 0),
          e.is_reimbursable ? 'Yes' : '',
          e.client_name || '',
        ])
      }

      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [
        { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 18 },
        { wch: 22 }, { wch: 22 }, { wch: 22 }, { wch: 11 }, { wch: 12 }, { wch: 18 },
      ]
      XLSX.utils.book_append_sheet(wb, ws, `${s.code} Travel`)
    }

    // Extra sheet for unassigned travel — captures the "Pre-paid / Unassigned"
    // section visible on screen: travel expenses paid this month that don't
    // match any current-month trip for either shareholder, plus those with
    // no shareholder tag at all.
    {
      const matchedExpenseIds = new Set()
      for (const p of periods) {
        for (const e of travelExpenses) {
          // Use invoice_date when set (actual transaction date) instead of
          // expense.date (bank settlement date). Card swiped Mar 11, posted
          // Mar 13 → invoice_date = 2026-03-11 matches a Mar 10-12 trip.
          const matchDate = e.invoice_date || e.date
          if (
            e.shareholder_code === p.shareholder_code &&
            matchDate >= p.from_date &&
            matchDate <= p.to_date
          ) {
            matchedExpenseIds.add(e.id)
          }
        }
      }
      const looseExpenses = travelExpenses.filter(e => !matchedExpenseIds.has(e.id))
      if (looseExpenses.length > 0) {
        const rows = [
          ['PRE-PAID / UNASSIGNED TRAVEL'],
          ['Travel expenses paid this month that don\'t match a current-month trip.'],
          [],
          ['Shareholder', 'Date', 'Reference', 'Sub-Ref', 'Vendor', 'Subcategory', 'Amount', 'Reimbursable', 'Client'],
        ]
        for (const e of looseExpenses) {
          const subRef = e.sub_ref_series
            ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
            : ''
          rows.push([
            e.shareholder_code || '(none)',
            e.date || '',
            e.reference_number || '',
            subRef,
            e.vendor || '',
            e.subcategory_name || '',
            Number(e.amount || 0),
            e.is_reimbursable ? 'Yes' : '',
            e.client_name || '',
          ])
        }
        const ws = XLSX.utils.aoa_to_sheet(rows)
        ws['!cols'] = [
          { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 26 },
          { wch: 18 }, { wch: 11 }, { wch: 12 }, { wch: 18 },
        ]
        XLSX.utils.book_append_sheet(wb, ws, 'Pre-paid Travel')
      }
    }

    // If neither shareholder had data and there was no unassigned travel either,
    // still produce a single empty sheet so the file isn't broken.
    if (wb.SheetNames.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([['No travel data for this period']])
      XLSX.utils.book_append_sheet(wb, ws, 'Empty')
    }

    const safeCompany = (selectedCompany || 'Company').replace(/\s+/g, '')
    const periodTag = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
    XLSX.writeFile(wb, `${safeCompany}_TravelLog_${periodTag}.xlsx`)
  }

  return (
    <div className="travel-log" style={{
      background: 'white',
      padding: 20,
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      {/* Toolbar — hidden in print. Three print options:
            - Print All: both shareholders, page-break between them
            - Print YK: only YK section (BK hidden via body class)
            - Print BK: only BK section (YK hidden via body class)
          Plus Excel export covering both shareholders. */}
      <div className="action-bar no-print">
        <button onClick={handlePrint} className="toolbar-btn primary">🖨 Print All</button>
        <button onClick={() => handlePrintShareholder('YK')} className="toolbar-btn">🖨 Print YK</button>
        <button onClick={() => handlePrintShareholder('BK')} className="toolbar-btn">🖨 Print BK</button>
        <button onClick={handleExportExcel} className="toolbar-btn">📊 Export Excel</button>
      </div>

      {/* Unified letterhead — shows on screen AND in print. Replaces the
          previous separate h2 + print-letterhead pair so the text-left /
          logo-right layout is consistent everywhere. */}
      <PrintLetterhead
        companyName={selectedCompany}
        reportTitle="Travel Log Report"
        periodLabel={`Period: ${monthLabel}`}
      />

      {/* Month-summary bar — at-a-glance breakdown of travel expenses this
          month: how many landed on a YK trip, a BK trip, or aren't anchored
          to a current-month trip yet (pre-paid for future / unassigned). */}
      <TravelLogSummaryBar
        periods={periods}
        travelExpenses={travelExpenses}
      />

      {/* Two shareholder sections */}
      {SHAREHOLDERS.map(s => (
        <ShareholderTravelSection
          key={s.code}
          shareholder={s}
          periods={periods.filter(p => p.shareholder_code === s.code)}
          travelExpenses={travelExpenses.filter(e => e.shareholder_code === s.code)}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          onAddPeriod={() => addPeriod(s.code)}
          onUpdatePeriod={updatePeriod}
          onDeletePeriod={deletePeriod}
          onUpdateExpense={updateExpenseDetails}
          onSwitchTab={onSwitchTab}
        />
      ))}

      {/* Pre-paid / Unassigned Travel section — catches every travel expense
          paid this month that isn't accounted for by a YK/BK trip this month.
          Covers two cases:
            • Flight paid in May for a trip in June → tagged YK or BK, but no
              matching period this month. Surfaces as a reminder that this
              shareholder has pre-paid travel pending a future trip.
            • Travel expense not yet tagged with a shareholder → routes
              nowhere automatically. User can ✏️ in View Expenses to assign. */}
      <UnassignedTravelSection
        periods={periods}
        travelExpenses={travelExpenses}
        onSwitchTab={onSwitchTab}
        onUpdateExpense={updateExpenseDetails}
        onViewExpense={onViewExpense}
      />
    </div>
  )
}

// =============================================================
// Month-summary bar — counts and totals split into four buckets:
//   • Total travel expenses dated in this month
//   • Tagged YK + falling within a YK trip this month  (= "in YK's log")
//   • Tagged BK + falling within a BK trip this month  (= "in BK's log")
//   • Everything else (pre-paid for future trip, or no shareholder tag)
// =============================================================
function TravelLogSummaryBar({ periods, travelExpenses }) {
  const stats = useMemo(() => {
    const isMatched = (e, shareholder) => {
      if (e.shareholder_code !== shareholder) return false
      // invoice_date override beats bank settlement date for trip matching.
      const matchDate = e.invoice_date || e.date
      return periods.some(p =>
        p.shareholder_code === shareholder &&
        matchDate >= p.from_date &&
        matchDate <= p.to_date
      )
    }
    const yk = travelExpenses.filter(e => isMatched(e, 'YK'))
    const bk = travelExpenses.filter(e => isMatched(e, 'BK'))
    const ykIds = new Set(yk.map(e => e.id))
    const bkIds = new Set(bk.map(e => e.id))
    const other = travelExpenses.filter(e => !ykIds.has(e.id) && !bkIds.has(e.id))
    const sum = (arr) => arr.reduce((s, e) => s + Number(e.amount || 0), 0)
    return {
      total:    { count: travelExpenses.length, amount: sum(travelExpenses) },
      yk:       { count: yk.length,    amount: sum(yk) },
      bk:       { count: bk.length,    amount: sum(bk) },
      other:    { count: other.length, amount: sum(other) },
    }
  }, [periods, travelExpenses])

  const fmt = (n) => `€${Number(n || 0).toFixed(2)}`

  const Card = ({ label, helper, count, amount, accent, bg }) => (
    <div style={{
      background: bg,
      border: `1px solid ${accent}`,
      borderLeft: `4px solid ${accent}`,
      borderRadius: 4,
      padding: '10px 12px',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 11, color: '#6b7280', textTransform: 'uppercase',
        letterSpacing: 0.4, fontWeight: 600, marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: accent }}>
          {count}
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
          {fmt(amount)}
        </span>
      </div>
      {helper && (
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
          {helper}
        </div>
      )}
    </div>
  )

  return (
    <div style={{
      marginTop: 12,
      marginBottom: 8,
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: 10,
    }}>
      <Card
        label="Total travel expenses"
        helper="Paid this month"
        count={stats.total.count}
        amount={stats.total.amount}
        accent="#1f2937"
        bg="#f9fafb"
      />
      <Card
        label="On YK's trip this month"
        helper="Tagged YK, dated within a YK trip"
        count={stats.yk.count}
        amount={stats.yk.amount}
        accent="#16a34a"
        bg="#f0fdf4"
      />
      <Card
        label="On BK's trip this month"
        helper="Tagged BK, dated within a BK trip"
        count={stats.bk.count}
        amount={stats.bk.amount}
        accent="#ea580c"
        bg="#fff7ed"
      />
      <Card
        label="Pre-paid / unassigned"
        helper="Future trip or no shareholder yet"
        count={stats.other.count}
        amount={stats.other.amount}
        accent="#6366f1"
        bg="#eef2ff"
      />
    </div>
  )
}

// =============================================================
// One row in the Pre-paid / Unassigned section. Combines:
//   • Identity strip:   date, sub-ref, vendor, badges, amount
//   • Description line (italic, if present)
//   • Where / Who / Why editable fields — same data model as the YK/BK
//     trip cards above, so trip notes can be filled in right here while
//     still in Pre-paid
//   • Action row: Assign → YK / → BK / Clear, plus "View in View Expenses →"
//     to jump to the underlying expense for editing date / amount / etc.
// =============================================================
function PrepaidExpenseRow({ expense: e, fmt, fmtDate, AssignButtons, onUpdateExpense, onViewExpense }) {
  // Local state for the three free-text trip-note fields. Synced from
  // props whenever the parent re-renders with new data (optimistic
  // saves keep this in sync), and committed back on blur.
  const [where, setWhere] = useState(e.travel_where || '')
  const [who,   setWho]   = useState(e.travel_who   || '')
  const [why,   setWhy]   = useState(e.travel_why   || '')

  useEffect(() => { setWhere(e.travel_where || '') }, [e.travel_where])
  useEffect(() => { setWho(e.travel_who   || '') }, [e.travel_who])
  useEffect(() => { setWhy(e.travel_why   || '') }, [e.travel_why])

  const commitField = (field, value, currentValue) => {
    if (value === currentValue) return
    onUpdateExpense && onUpdateExpense(e.id, { [field]: value || null })
  }

  const subRef = e.sub_ref_series
    ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
    : ''

  const inpStyle = {
    padding: '4px 8px',
    fontSize: 11,
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    width: '100%',
    background: '#fafbff',
  }

  return (
    <div style={{
      padding: '8px 12px',
      fontSize: 12,
      borderTop: '1px solid #f3f4f6',
      color: '#374151',
    }}>
      {/* Identity strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '90px 70px 1fr 110px',
        gap: 8,
        alignItems: 'baseline',
      }}>
        <span style={{ fontFamily: 'monospace', color: '#6b7280' }}>{fmtDate(e.date)}</span>
        <span style={{ fontFamily: 'monospace', color: '#6b7280' }}>{subRef}</span>
        <span>
          <strong>{e.vendor || '—'}</strong>
          {e.subcategory_name && <span style={{ color: '#9ca3af' }}> · {e.subcategory_name}</span>}
          <span style={{ fontFamily: 'monospace', color: '#9ca3af', marginLeft: 6 }}>
            {e.reference_number}
          </span>
          {/* Multi-month "future trip" badges. */}
          {e.expected_travel_month && (e.expected_travel_month.split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(token => (
              <span
                key={token}
                style={{
                  marginLeft: 6,
                  padding: '1px 7px',
                  background: '#ede9fe',
                  color: '#6d28d9',
                  fontSize: 11,
                  borderRadius: 999,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                🔜 {formatMonthYear(token)}
              </span>
            ))
          )}
        </span>
        <span style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(e.amount)}</span>
      </div>

      {/* Description on its own line. */}
      {e.description && (
        <div style={{
          marginTop: 2,
          paddingLeft: 168,
          color: '#6b7280',
          fontStyle: 'italic',
        }}>
          {e.description}
        </div>
      )}

      {/* Trip-note editors — three side-by-side text inputs. Same data
          model as the YK/BK trip expense cards, so anything entered here
          flows straight into reports. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6,
        marginTop: 8,
      }}>
        <input
          type="text"
          placeholder="Destination (where)"
          value={where}
          onChange={(ev) => setWhere(ev.target.value)}
          onBlur={() => commitField('travel_where', where, e.travel_where)}
          style={inpStyle}
        />
        <input
          type="text"
          placeholder="Travelers (who)"
          value={who}
          onChange={(ev) => setWho(ev.target.value)}
          onBlur={() => commitField('travel_who', who, e.travel_who)}
          style={inpStyle}
        />
        <input
          type="text"
          placeholder="Reason / purpose (why)"
          value={why}
          onChange={(ev) => setWhy(ev.target.value)}
          onBlur={() => commitField('travel_why', why, e.travel_why)}
          style={inpStyle}
        />
      </div>

      {/* Action row — shareholder assignment + jump to View Expenses */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
        gap: 8,
      }}>
        <AssignButtons expense={e} />
        <button
          type="button"
          onClick={() => onViewExpense && onViewExpense(e.id)}
          style={{
            padding: '2px 10px',
            fontSize: 11,
            border: '1px solid #d1d5db',
            background: 'white',
            color: '#374151',
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            fontWeight: 500,
          }}
          title="Open the underlying expense in View Expenses to edit date, amount, etc."
        >
          View in View Expenses →
        </button>
      </div>
    </div>
  )
}

// =============================================================
// Pre-paid / Unassigned Travel section
// Catches all travel expenses paid this month that aren't anchored to a
// current-month trip for either shareholder.
// =============================================================
function UnassignedTravelSection({ periods, travelExpenses, onSwitchTab, onUpdateExpense, onViewExpense }) {
  // Build the same expense→period match as ShareholderTravelSection, but
  // across both shareholders. Anything that doesn't match a period this
  // month is "loose" and shows up here.
  const buckets = useMemo(() => {
    const matched = new Set()
    for (const p of periods) {
      for (const e of travelExpenses) {
        const matchDate = e.invoice_date || e.date
        if (
          e.shareholder_code === p.shareholder_code &&
          matchDate >= p.from_date &&
          matchDate <= p.to_date
        ) {
          matched.add(e.id)
        }
      }
    }
    const loose = travelExpenses.filter(e => !matched.has(e.id))
    return {
      yk:         loose.filter(e => e.shareholder_code === 'YK'),
      bk:         loose.filter(e => e.shareholder_code === 'BK'),
      unassigned: loose.filter(e => !e.shareholder_code),
      total:      loose.length,
    }
  }, [periods, travelExpenses])

  if (buckets.total === 0) return null

  const fmt = (n) => `€${Number(n || 0).toFixed(2)}`
  const fmtDate = (iso) => {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  const sectionSum = (arr) => arr.reduce((s, e) => s + Number(e.amount || 0), 0)

  // Inline shareholder-assignment buttons rendered per row.
  // Behavior depends on the current shareholder_code:
  //   • Unassigned → show "→ YK" and "→ BK"
  //   • Already YK → show "→ BK" and "Clear" (re-route or un-assign)
  //   • Already BK → show "→ YK" and "Clear" (re-route or un-assign)
  const AssignButtons = ({ expense }) => {
    const current = expense.shareholder_code || null
    const Btn = ({ target, color, label }) => (
      <button
        type="button"
        onClick={() => onUpdateExpense && onUpdateExpense(expense.id, { shareholder_code: target })}
        style={{
          padding: '2px 8px',
          fontSize: 11,
          border: `1px solid ${color}`,
          background: 'white',
          color: color,
          borderRadius: 999,
          cursor: 'pointer',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >{label}</button>
    )
    return (
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {current !== 'YK' && <Btn target="YK" color="#16a34a" label="→ YK" />}
        {current !== 'BK' && <Btn target="BK" color="#ea580c" label="→ BK" />}
        {current && <Btn target={null} color="#6b7280" label="Clear" />}
      </div>
    )
  }

  const Sub = ({ title, accent, items, helper }) => {
    if (items.length === 0) return null
    return (
      <div style={{
        marginTop: 12,
        border: `1px solid ${accent}`,
        borderRadius: 4,
        background: 'white',
      }}>
        <div style={{
          padding: '8px 12px',
          background: accent,
          color: 'white',
          fontSize: 13,
          fontWeight: 700,
          display: 'flex',
          justifyContent: 'space-between',
        }}>
          <span>{title} ({items.length})</span>
          <span>{fmt(sectionSum(items))}</span>
        </div>
        {helper && (
          <div style={{ padding: '6px 12px', fontSize: 11, color: '#6b7280', background: '#f9fafb' }}>
            {helper}
          </div>
        )}
        <div style={{ padding: '4px 0' }}>
          {items.map(e => (
            <PrepaidExpenseRow
              key={e.id}
              expense={e}
              fmt={fmt}
              fmtDate={fmtDate}
              AssignButtons={AssignButtons}
              onUpdateExpense={onUpdateExpense}
              onViewExpense={onViewExpense}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className="shareholder-section"
      style={{
        marginTop: 20,
        border: '2px solid #6366f1',
        borderRadius: 6,
        padding: 14,
        background: '#eef2ff',
      }}
    >
      <h3 style={{ margin: 0, color: '#3730a3', fontSize: 18 }}>
        Pre-paid / Unassigned Travel ({buckets.total})
      </h3>
      <div style={{ marginTop: 6, fontSize: 12, color: '#3730a3' }}>
        Travel expenses paid this month that don't match any current-month trip for either shareholder.
        Most commonly: a flight paid now for a future trip.
      </div>

      <Sub
        title="YK — pre-paid for future trip"
        accent="#16a34a"
        items={buckets.yk}
        helper="Tagged YK but doesn't fall within any YK travel period this month."
      />
      <Sub
        title="BK — pre-paid for future trip"
        accent="#ea580c"
        items={buckets.bk}
        helper="Tagged BK but doesn't fall within any BK travel period this month."
      />
      <Sub
        title="Not assigned to a shareholder"
        accent="#6366f1"
        items={buckets.unassigned}
        helper={
          <>
            No shareholder tag yet. Open the expense in{' '}
            <button
              type="button"
              onClick={() => onSwitchTab && onSwitchTab('view-expenses')}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: '#3730a3', textDecoration: 'underline', cursor: 'pointer', fontSize: 11,
              }}
            >View Expenses</button>{' '}
            and use ✏️ Edit to set the Shareholder field.
          </>
        }
      />
    </div>
  )
}

// =============================================================
// One shareholder's full Travel Log section
// =============================================================
function ShareholderTravelSection({
  shareholder, periods, travelExpenses,
  selectedMonth, selectedYear,
  onAddPeriod, onUpdatePeriod, onDeletePeriod, onUpdateExpense,
}) {
  const { code, color, bgLight, bgPanel } = shareholder

  // Per-period totals + grand totals
  //   Use UNIQUE-DAYS-IN-MONTH (set-based) so:
  //     - overlapping periods don't double-count (Jan 1–7 + Jan 7–10 = 10 unique days, not 11)
  //     - periods that extend outside the selected month only count their in-month days
  //     - total can never exceed the number of days in the selected month
  const totals = useMemo(() => {
    let sumPeriodDays = 0
    let totalCompanyPaid = 0
    const expensesByPeriod = new Map()
    const expenseToPeriodId = new Map()

    // For unique-day counting — only consider dates within the selected month
    const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate()
    const mm = String(selectedMonth).padStart(2, '0')
    const monthStart = `${selectedYear}-${mm}-01`
    const monthEnd = `${selectedYear}-${mm}-${String(daysInMonth).padStart(2, '0')}`
    const uniqueDays = new Set()
    let hasOutOfMonth = false

    for (const p of periods) {
      sumPeriodDays += daysBetween(p.from_date, p.to_date)

      // Detect periods that extend outside the selected month
      if (p.from_date < monthStart || p.to_date > monthEnd) {
        hasOutOfMonth = true
      }

      // Add every in-month date covered by this period to the unique-days set
      const clampStart = p.from_date < monthStart ? monthStart : p.from_date
      const clampEnd   = p.to_date   > monthEnd   ? monthEnd   : p.to_date
      const cur = new Date(clampStart + 'T00:00:00')
      const end = new Date(clampEnd + 'T00:00:00')
      while (cur <= end) {
        uniqueDays.add(cur.toISOString().slice(0, 10))
        cur.setDate(cur.getDate() + 1)
      }

      // Expenses falling within this period's full date range (not just in-month).
      // Uses invoice_date when set (actual transaction date) instead of the
      // bank settlement date — keeps cross-day card transactions on the
      // correct trip.
      const myExpenses = travelExpenses.filter(e => {
        const matchDate = e.invoice_date || e.date
        return matchDate >= p.from_date && matchDate <= p.to_date
      })
      expensesByPeriod.set(p.id, myExpenses)
      for (const e of myExpenses) expenseToPeriodId.set(e.id, p.id)
      totalCompanyPaid += sumAmounts(myExpenses.filter(e => !e.is_reimbursable))
    }

    // Travel expenses not falling in any period — orphans
    const orphans = travelExpenses.filter(e => !expenseToPeriodId.has(e.id))

    const totalDays = uniqueDays.size
    const hasOverlap = sumPeriodDays > totalDays   // truthy if any double-counted days

    return {
      totalDays, sumPeriodDays,
      hasOverlap, hasOutOfMonth, daysInMonth,
      totalCompanyPaid, expensesByPeriod, orphans,
    }
  }, [periods, travelExpenses, selectedMonth, selectedYear])

  return (
    <div
      className="shareholder-section"
      data-code={code}
      style={{
        marginTop: 20,
        border: `2px solid ${color}`,
        borderRadius: 6,
        padding: 14,
        background: bgLight,
      }}
    >
      <h3 style={{ margin: 0, color, fontSize: 18 }}>
        {code} Travel Log
      </h3>

      {/* Travel Periods & Expenses panel */}
      <div style={{
        marginTop: 12,
        border: `1px solid ${color}`,
        borderRadius: 4,
        background: 'white',
      }}>
        {/* Panel header with Add button */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 14px', background: bgPanel,
          borderBottom: `1px solid ${color}`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color }}>
            Travel Periods & Expenses
          </div>
          <button
            onClick={onAddPeriod}
            className="no-print"
            style={{
              background: color, color: 'white', border: 'none',
              borderRadius: 4, padding: '6px 12px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            + Add Travel Period
          </button>
        </div>

        {/* Periods list */}
        <div style={{ padding: 12 }}>
          {periods.length === 0 ? (
            <div style={{
              padding: 14, color: '#9ca3af', fontSize: 13, fontStyle: 'italic',
              textAlign: 'center',
            }}>
              No travel periods recorded for this month
            </div>
          ) : (
            periods.map(p => (
              <TravelPeriodRow
                key={p.id}
                period={p}
                expenses={totals.expensesByPeriod.get(p.id) || []}
                selectedMonth={selectedMonth}
                selectedYear={selectedYear}
                accentColor={color}
                onUpdate={(patch) => onUpdatePeriod(p.id, patch)}
                onDelete={() => onDeletePeriod(p.id)}
                onUpdateExpense={onUpdateExpense}
              />
            ))
          )}

          {/* Per-shareholder orphan warnings were removed — those expenses now
              appear in the global "Pre-paid / Unassigned Travel" section at
              the bottom of the page, which gives a cleaner unified view. */}
        </div>
      </div>

      {/* Section totals */}
      <div style={{
        marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
      }}>
        <div style={{
          background: 'white', border: `1px solid ${color}`, borderLeft: `4px solid ${color}`,
          padding: '10px 12px', borderRadius: 4,
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          }}>
            <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
              Total Days Traveled
            </span>
            <span style={{ fontSize: 20, fontWeight: 700, color: '#1f2937' }}>
              {totals.totalDays}
              <span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af', marginLeft: 4 }}>
                / {totals.daysInMonth} in month
              </span>
            </span>
          </div>
          {/* Show note when sum != unique so the user understands the math */}
          {(totals.hasOverlap || totals.hasOutOfMonth) && (
            <div style={{
              marginTop: 6, paddingTop: 6, borderTop: '1px dashed #e5e7eb',
              fontSize: 11, color: '#92400e',
            }}>
              {totals.hasOverlap && (
                <div>
                  ⚠ Periods overlap — counted {totals.sumPeriodDays} days across periods, but only {totals.totalDays} are unique days in the month.
                </div>
              )}
              {totals.hasOutOfMonth && (
                <div>
                  ⚠ One or more periods extend beyond this month — only days within the month count toward the total.
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{
          background: 'white', border: `1px solid ${color}`, borderLeft: `4px solid ${color}`,
          padding: '10px 12px', borderRadius: 4,
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        }}>
          <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>
            Total Company-Paid Travel Expenses
          </span>
          <span style={{ fontSize: 20, fontWeight: 700, color }}>
            {fmt(totals.totalCompanyPaid)}
          </span>
        </div>
      </div>
    </div>
  )
}

// =============================================================
// One travel period row (editable inline)
// =============================================================
function TravelPeriodRow({ period, expenses, selectedMonth, selectedYear, accentColor, onUpdate, onDelete, onUpdateExpense }) {
  // Local inputs for inline editing — save on blur
  const [fromDate, setFromDate] = useState(period.from_date || '')
  const [toDate, setToDate] = useState(period.to_date || '')
  const [destination, setDestination] = useState(period.destination || '')
  const [reason, setReason] = useState(period.reason || '')
  const [comments, setComments] = useState(period.comments || '')

  // Sync if external changes
  useEffect(() => { setFromDate(period.from_date || '') }, [period.from_date])
  useEffect(() => { setToDate(period.to_date || '') }, [period.to_date])
  useEffect(() => { setDestination(period.destination || '') }, [period.destination])
  useEffect(() => { setReason(period.reason || '') }, [period.reason])
  useEffect(() => { setComments(period.comments || '') }, [period.comments])

  const days = daysBetween(fromDate, toDate)
  const periodCompanyPaid = sumAmounts(expenses.filter(e => !e.is_reimbursable))

  return (
    <div style={{
      border: `1px solid #e5e7eb`,
      borderLeft: `4px solid ${accentColor}`,
      borderRadius: 4, marginBottom: 12, background: 'white',
    }}>
      {/* Period header row */}
      <div style={{
        padding: 10,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1.5fr 1.5fr auto auto',
        gap: 10, alignItems: 'end',
        background: '#f9fafb',
      }}>
        <div>
          <label style={lblStyle}>From Date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            onBlur={() => fromDate !== period.from_date && onUpdate({ from_date: fromDate })}
            style={inpStyle}
          />
        </div>
        <div>
          <label style={lblStyle}>To Date</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            onBlur={() => toDate !== period.to_date && onUpdate({ to_date: toDate })}
            style={inpStyle}
          />
        </div>
        <div>
          <label style={lblStyle}>Destination</label>
          <input
            type="text"
            placeholder="e.g., Athens"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            onBlur={() => destination !== (period.destination || '') && onUpdate({ destination })}
            style={inpStyle}
          />
        </div>
        <div>
          <label style={lblStyle}>Reason for Travel</label>
          <input
            type="text"
            placeholder="e.g., Client meetings"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => reason !== (period.reason || '') && onUpdate({ reason })}
            style={inpStyle}
          />
        </div>
        <div>
          <label style={lblStyle}>Days</label>
          <div style={{
            padding: '6px 10px', fontSize: 14, fontWeight: 700,
            color: '#1f2937', background: '#f3f4f6', borderRadius: 4,
            textAlign: 'center',
          }}>
            {days}
          </div>
        </div>
        <div className="no-print">
          <label style={lblStyle}>Actions</label>
          <button
            onClick={onDelete}
            style={{
              background: '#dc2626', color: 'white', border: 'none',
              borderRadius: 4, padding: '6px 12px', fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Travel Expenses for this Period */}
      <div style={{ padding: '8px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937', marginBottom: 6 }}>
          Travel Expenses for this Period:
        </div>
        {expenses.length === 0 ? (
          <div style={{
            padding: 10, color: '#9ca3af', fontSize: 12, fontStyle: 'italic',
            background: '#f9fafb', borderRadius: 4,
          }}>
            No travel expenses found in this date range. (They'll auto-group here when added with category = Travel Expenses and the matching shareholder + date.)
          </div>
        ) : (
          expenses.map((e, idx) => (
            <TravelExpenseCard
              key={e.id}
              expense={e}
              index={idx + 1}
              onUpdate={(patch) => onUpdateExpense(e.id, patch)}
            />
          ))
        )}
        {/* Period total (company-paid) */}
        <div style={{
          marginTop: 6, padding: '8px 10px',
          background: '#dbeafe', border: '1px solid #93c5fd',
          borderRadius: 4, color: '#1e40af', fontSize: 13, fontWeight: 600,
        }}>
          Total Company-Paid Travel Expenses (this period): {fmt(periodCompanyPaid)}
        </div>
      </div>

      {/* Comments */}
      <div style={{ padding: '8px 12px 12px' }}>
        <label style={lblStyle}>Travel Period Comments</label>
        <textarea
          rows={2}
          placeholder="Add any notes or comments about this travel period (optional)"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          onBlur={() => comments !== (period.comments || '') && onUpdate({ comments })}
          style={{ ...inpStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>
    </div>
  )
}

// =============================================================
// One travel-expense card with conditional metadata fields
// =============================================================
function TravelExpenseCard({ expense, index, onUpdate }) {
  const subName = (expense.subcategory_name || '').toLowerCase()
  const isAccommodation = subName.includes('accommodation') || subName.includes('hotel') || subName.includes('lodging')
  const isTransportation = subName.includes('transportation') || subName.includes('travel') || subName.includes('flight') || subName.includes('taxi')

  // Labels switch based on subcategory
  const labels = isAccommodation
    ? { where: 'Location', who: 'Participants', why: 'Purpose',
        wherePh: 'e.g., Plaza Hotel in London',
        whoPh: 'e.g., John Smith and Sarah Jones',
        whyPh: 'e.g., Client Meetings' }
    : isTransportation
      ? { where: 'Travel Route (from location → end location)', who: 'Travelers', why: 'Purpose',
          wherePh: 'e.g., Flight from London to New York OR Taxi from Office to Airport',
          whoPh: 'e.g., John Smith and Sarah Jones',
          whyPh: 'e.g., Client meeting and project visit' }
      : { where: 'Where', who: 'Who', why: 'Purpose',
          wherePh: 'Location / route detail',
          whoPh: 'Participants / travelers',
          whyPh: 'Reason for this expense' }

  const [where, setWhere] = useState(expense.travel_where || '')
  const [who, setWho]     = useState(expense.travel_who   || '')
  const [why, setWhy]     = useState(expense.travel_why   || '')

  useEffect(() => { setWhere(expense.travel_where || '') }, [expense.travel_where])
  useEffect(() => { setWho(expense.travel_who || '') },     [expense.travel_who])
  useEffect(() => { setWhy(expense.travel_why || '') },     [expense.travel_why])

  const commit = (field, value, original) => {
    if (value !== (original || '')) onUpdate({ [field]: value })
  }

  return (
    <div className="travel-expense-card" style={{
      background: '#fef3c7', border: '1px solid #fde68a',
      borderLeft: '4px solid #f59e0b',
      borderRadius: 4, padding: 10, marginBottom: 8,
    }}>
      {/* Top row: ref, date, vendor, amount, flags */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12,
        fontSize: 12, color: '#374151', marginBottom: 6,
      }}>
        <span><strong style={{ color: '#92400e' }}>Expense {index}:</strong></span>
        <span>Ref: <span style={{ fontFamily: 'monospace' }}>{expense.reference_number || '—'}</span>
          {expense.sub_ref_series && (
            <span style={{ fontFamily: 'monospace', marginLeft: 4, color: '#0c4a6e' }}>
              {expense.sub_ref_series}{expense.sub_ref_month}/{expense.sub_ref_seq}
            </span>
          )}
        </span>
        <span>Date: {fmtDate(expense.date)}</span>
        <span>Vendor: <strong>{expense.vendor || '—'}</strong></span>
        <span>Amount: <strong>{fmt(expense.amount)}</strong></span>
        {expense.is_reimbursable && (
          <span style={{
            background: '#fed7aa', color: '#7c2d12',
            padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
          }}>
            Client Reimbursable{expense.client_name ? ` · ${expense.client_name}` : ''}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
        Subcategory: <strong>{expense.subcategory_name || '—'}</strong>
      </div>
      {/* Description — the free-text note set when the expense was finalized
          (e.g. "Flight TLV-LCA BK and YK"). Often the single most useful piece
          of context for understanding what this travel expense is for. */}
      {expense.description && (
        <div style={{ fontSize: 12, color: '#4b5563', marginBottom: 8, fontStyle: 'italic' }}>
          {expense.description}
        </div>
      )}

      {/* Metadata fields (white background sub-card) */}
      <div style={{
        background: 'white', border: '1px solid #e5e7eb',
        borderRadius: 4, padding: 10,
      }}>
        <label style={{ ...lblStyle, color: '#374151' }}>{labels.where}:</label>
        <input
          type="text"
          placeholder={labels.wherePh}
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          onBlur={() => commit('travel_where', where, expense.travel_where)}
          style={inpStyle}
        />
        <label style={{ ...lblStyle, color: '#374151', marginTop: 6 }}>{labels.who}:</label>
        <input
          type="text"
          placeholder={labels.whoPh}
          value={who}
          onChange={(e) => setWho(e.target.value)}
          onBlur={() => commit('travel_who', who, expense.travel_who)}
          style={inpStyle}
        />
        <label style={{ ...lblStyle, color: '#374151', marginTop: 6 }}>{labels.why}:</label>
        <input
          type="text"
          placeholder={labels.whyPh}
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          onBlur={() => commit('travel_why', why, expense.travel_why)}
          style={inpStyle}
        />
      </div>
    </div>
  )
}

// =============================================================
// Helpers
// =============================================================
function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return 0
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (isNaN(from) || isNaN(to)) return 0
  const ms = to - from
  if (ms < 0) return 0
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1   // inclusive
}

function sumAmounts(arr) {
  return arr.reduce((s, e) => s + Number(e.amount || 0), 0)
}

const fmt = (n) =>
  `€${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const lblStyle = {
  display: 'block', fontSize: 11, color: '#6b7280',
  fontWeight: 600, marginBottom: 3,
}
const inpStyle = {
  width: '100%', padding: '6px 8px',
  border: '1px solid #d1d5db', borderRadius: 4,
  fontSize: 13, boxSizing: 'border-box',
}
