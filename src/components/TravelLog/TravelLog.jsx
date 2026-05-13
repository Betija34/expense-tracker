import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
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

export function TravelLog({ selectedCompany, selectedMonth, selectedYear, onSwitchTab }) {
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

        // All Travel Expenses for this month (we'll filter to those falling in a period at render)
        const { data: expData, error: expErr } = await supabase
          .from('expenses')
          .select('*, expense_categories(name)')
          .eq('company_id', comp.id)
          .eq('main_ref_year', selectedYear)
          .eq('main_ref_month', selectedMonth)
        if (expErr) throw expErr
        if (cancelled) return

        const travel = (expData || []).filter(e =>
          e.expense_categories?.name === 'Travel Expenses' || e.sub_ref_series === 'T'
        )
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
            - Print BK: only BK section (YK hidden via body class) */}
      <div className="action-bar no-print">
        <button onClick={handlePrint} className="toolbar-btn primary">🖨 Print All</button>
        <button onClick={() => handlePrintShareholder('YK')} className="toolbar-btn">🖨 Print YK</button>
        <button onClick={() => handlePrintShareholder('BK')} className="toolbar-btn">🖨 Print BK</button>
      </div>

      {/* Screen header — hidden in print (replaced by .print-header letterhead below) */}
      <div className="no-print" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: '#1f2937' }}>Travel Log Management</h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
          Track and document all travel periods and expenses for each shareholder · {monthLabel} · {selectedCompany}
        </p>
      </div>

      {/* Print-only letterhead — only appears in printed/PDF output */}
      <div className="print-only print-header">
        <div className="company-name">{selectedCompany}</div>
        <div className="report-title">Travel Log Report</div>
        <div className="period-label">Period: {monthLabel}</div>
      </div>

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

      // Expenses falling within this period's full date range (not just in-month)
      const myExpenses = travelExpenses.filter(e =>
        e.date >= p.from_date && e.date <= p.to_date
      )
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

          {/* Orphan travel expenses (tagged with this shareholder but not in any period) */}
          {totals.orphans.length > 0 && (
            <div style={{
              marginTop: 12, padding: 10,
              background: '#fef3c7', border: '1px solid #fcd34d',
              borderRadius: 4, fontSize: 12,
            }}>
              <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                ⚠ {totals.orphans.length} travel expense{totals.orphans.length === 1 ? '' : 's'} not in any period
              </div>
              <div style={{ color: '#78350f', marginBottom: 6 }}>
                These travel expenses are tagged with {code} but don't fall within any defined travel period.
                Add a period covering their dates so they're grouped properly.
              </div>
              {totals.orphans.map(e => (
                <div key={e.id} style={{ fontSize: 12, color: '#78350f' }}>
                  · {fmtDate(e.date)} · {e.vendor} · {fmt(e.amount)}
                  {e.reference_number && <span style={{ fontFamily: 'monospace', marginLeft: 4 }}>({e.reference_number})</span>}
                </div>
              ))}
            </div>
          )}
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
      <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>
        Subcategory: <strong>{expense.subcategory_name || '—'}</strong>
      </div>

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
