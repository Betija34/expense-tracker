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
        // Pull accounts(name) too — the new compact identity line on each
        // travel-expense card displays which account paid (Current /
        // Mastercard / Cash). expense_categories(name) is still needed for
        // the T-series filter + the displayed Category label.
        const { data: expData, error: expErr } = await supabase
          .from('expenses')
          .select('*, expense_categories(name), accounts(name)')
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
    // Optimistic: update local state and re-sort by from_date ascending so
    // editing a period's date immediately reorders it within the list
    // (without waiting for a full reload). The initial load already sorts
    // via .order('from_date'), but a from_date change here would leave the
    // row in its old slot until next reload otherwise.
    setPeriods(prev =>
      prev
        .map(p => p.id === periodId ? { ...p, ...patch } : p)
        .sort(byFromDateAsc)
    )
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

  // -------------------------------------------------------------
  // Manual trip assignment for an expense (V29).
  // When periodId is non-null we also auto-set shareholder_code to
  // match the period's owner — so an expense pre-paid for a YK trip
  // but currently tagged BK (or untagged) lands in the right card.
  // Passing periodId=null clears the manual link and reverts to
  // date-based auto-grouping (shareholder_code is left alone).
  // -------------------------------------------------------------
  const assignExpenseToPeriod = async (expenseId, periodId) => {
    const patch = { assigned_period_id: periodId }
    if (periodId) {
      const p = periods.find(pp => pp.id === periodId)
      if (p?.shareholder_code) patch.shareholder_code = p.shareholder_code
    }
    const { error } = await supabase
      .from('expenses')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', expenseId)
    if (error) {
      alert('Failed to assign trip: ' + error.message)
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
      rows.push(['From', 'To', 'Days', 'Destination', 'Reason', 'Flights', 'Comments'])
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
          p.flights || '',
          p.comments || '',
        ])
      }
      rows.push([])
      rows.push([`${s.code} TRAVEL EXPENSES`])
      // Columns mirror the new on-screen identity line + the single Notes
      // box: Account · Ref · Sub-Ref · Invoice Date · Date Paid · Vendor ·
      // Description · Category · Subcategory · Amount · Reimbursable ·
      // Client · Notes. The Notes column carries the merged value so the
      // export reflects what the user actually sees on the page.
      rows.push([
        'Account', 'Reference', 'Sub-Ref', 'Invoice Date', 'Date Paid',
        'Vendor', 'Description', 'Category', 'Subcategory', 'Amount',
        'Reimbursable', 'Client', 'Notes',
      ])
      for (const e of myExpenses) {
        const subRef = e.sub_ref_series
          ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
          : ''
        const notes = [
          (e.travel_why   || '').trim(),
          (e.travel_where || '').trim() ? `Where: ${e.travel_where.trim()}` : '',
          (e.travel_who   || '').trim() ? `Who: ${e.travel_who.trim()}` : '',
        ].filter(Boolean).join('\n')
        rows.push([
          e.accounts?.name || '',
          e.reference_number || '',
          subRef,
          e.invoice_date || '',
          e.date || '',
          e.vendor || '',
          e.description || '',
          e.expense_categories?.name || '',
          e.subcategory_name || '',
          Number(e.amount || 0),
          e.is_reimbursable ? 'Yes' : '',
          e.client_name || '',
          notes,
        ])
      }

      const ws = XLSX.utils.aoa_to_sheet(rows)
      ws['!cols'] = [
        { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
        { wch: 22 }, { wch: 26 }, { wch: 18 }, { wch: 18 }, { wch: 11 },
        { wch: 12 }, { wch: 18 }, { wch: 40 },
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
          // Same column shape as the per-shareholder sheets, with an
          // extra Shareholder column up front.
          [
            'Shareholder', 'Account', 'Reference', 'Sub-Ref',
            'Invoice Date', 'Date Paid', 'Vendor', 'Description',
            'Category', 'Subcategory', 'Amount', 'Reimbursable',
            'Client', 'Notes',
          ],
        ]
        for (const e of looseExpenses) {
          const subRef = e.sub_ref_series
            ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
            : ''
          const notes = [
            (e.travel_why   || '').trim(),
            (e.travel_where || '').trim() ? `Where: ${e.travel_where.trim()}` : '',
            (e.travel_who   || '').trim() ? `Who: ${e.travel_who.trim()}` : '',
          ].filter(Boolean).join('\n')
          rows.push([
            e.shareholder_code || '(none)',
            e.accounts?.name || '',
            e.reference_number || '',
            subRef,
            e.invoice_date || '',
            e.date || '',
            e.vendor || '',
            e.description || '',
            e.expense_categories?.name || '',
            e.subcategory_name || '',
            Number(e.amount || 0),
            e.is_reimbursable ? 'Yes' : '',
            e.client_name || '',
            notes,
          ])
        }
        const ws = XLSX.utils.aoa_to_sheet(rows)
        ws['!cols'] = [
          { wch: 11 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
          { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 26 },
          { wch: 18 }, { wch: 18 }, { wch: 11 }, { wch: 12 },
          { wch: 18 }, { wch: 40 },
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
      {SHAREHOLDERS.map(s => {
        // For each shareholder section we include:
        //   • Periods belonging to that shareholder, AND
        //   • Expenses whose shareholder_code matches OR whose
        //     assigned_period_id points at one of this shareholder's
        //     periods (manual assignment cascades the shareholder
        //     automatically, but we belt-and-suspenders here in case
        //     the cascade missed for some legacy row).
        const myPeriodIds = new Set(
          periods.filter(p => p.shareholder_code === s.code).map(p => p.id)
        )
        const myExpenses = travelExpenses.filter(e =>
          e.shareholder_code === s.code ||
          (e.assigned_period_id && myPeriodIds.has(e.assigned_period_id))
        )
        return (
          <ShareholderTravelSection
            key={s.code}
            shareholder={s}
            periods={periods.filter(p => p.shareholder_code === s.code)}
            allPeriods={periods}
            travelExpenses={myExpenses}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            onAddPeriod={() => addPeriod(s.code)}
            onUpdatePeriod={updatePeriod}
            onDeletePeriod={deletePeriod}
            onUpdateExpense={updateExpenseDetails}
            onAssignExpenseToPeriod={assignExpenseToPeriod}
            onSwitchTab={onSwitchTab}
            onViewExpense={onViewExpense}
          />
        )
      })}

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
        onAssignExpenseToPeriod={assignExpenseToPeriod}
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
      // Manual assignment wins. The expense matches whichever
      // shareholder owns the assigned period.
      if (e.assigned_period_id) {
        const ap = periods.find(p => p.id === e.assigned_period_id)
        return ap?.shareholder_code === shareholder
      }
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
function PrepaidExpenseRow({ expense: e, fmt, fmtDate, AssignButtons, allPeriods = [], onUpdateExpense, onAssignExpenseToPeriod, onViewExpense }) {
  // Same single-textarea pattern as TravelExpenseCard above. Merge any
  // legacy where/who content into the displayed note, save back to
  // travel_why on blur. See the long comment over TravelExpenseCard
  // for the full rationale.
  const mergedNote = useMemo(() => {
    const why   = (e.travel_why   || '').trim()
    const where = (e.travel_where || '').trim()
    const who   = (e.travel_who   || '').trim()
    if (why && !where && !who) return why
    const parts = []
    if (why)   parts.push(why)
    if (where && !why.includes(where)) parts.push(`Where: ${where}`)
    if (who   && !why.includes(who))   parts.push(`Who: ${who}`)
    return parts.join('\n')
  }, [e.travel_why, e.travel_where, e.travel_who])

  const [note, setNote] = useState(mergedNote)
  useEffect(() => { setNote(mergedNote) }, [mergedNote])

  const commitNote = () => {
    if (note === mergedNote) return
    onUpdateExpense && onUpdateExpense(e.id, { travel_why: note || null })
  }

  const accountName = e.accounts?.name || '—'
  const categoryName = e.expense_categories?.name || '—'
  const subRef = e.sub_ref_series
    ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
    : ''

  const Cell = ({ label, children, mono = false, align = 'left', minWidth }) => (
    <div style={{ minWidth, textAlign: align }}>
      <div style={{
        fontSize: 9, color: '#6b7280', textTransform: 'uppercase',
        letterSpacing: 0.4, fontWeight: 600, marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 12, color: '#1f2937', fontWeight: 500,
        fontFamily: mono ? 'monospace' : 'inherit',
        whiteSpace: 'normal', wordBreak: 'break-word',
      }}>
        {children}
      </div>
    </div>
  )

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid #f3f4f6',
    }}>
      {/* Identity strip — same column layout as TravelExpenseCard so the
          two render visually consistent. We add a "future trip" badge
          inline with the Vendor cell when expected_travel_month is set. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns:
          '90px 80px 70px 85px 85px 1.2fr 1.5fr 1.4fr 90px',
        gap: 8,
        alignItems: 'flex-start',
        paddingBottom: 8,
        borderBottom: '1px dashed #e5e7eb',
      }}>
        <Cell label="Account">{accountName}</Cell>
        <Cell label="Ref No" mono>
          {e.reference_number && onViewExpense ? (
            <button
              type="button"
              onClick={() => onViewExpense(e.id)}
              title="Open in View Expenses for editing"
              style={{
                background: 'none', border: 'none', padding: 0,
                color: '#1d4ed8', textDecoration: 'underline',
                fontFamily: 'inherit', fontSize: 'inherit',
                cursor: 'pointer',
              }}
            >
              {e.reference_number}
            </button>
          ) : (e.reference_number || '—')}
        </Cell>
        <Cell label="Sub Ref" mono>{subRef || '—'}</Cell>
        <Cell label="Invoice Date" mono>{fmtDate(e.invoice_date)}</Cell>
        <Cell label="Date Paid" mono>{fmtDate(e.date)}</Cell>
        <Cell label="Vendor">
          <strong>{e.vendor || '—'}</strong>
          {e.expected_travel_month && (e.expected_travel_month.split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .map(token => (
              <span
                key={token}
                style={{
                  display: 'inline-block', marginLeft: 4, marginTop: 2,
                  padding: '1px 6px', background: '#ede9fe', color: '#6d28d9',
                  fontSize: 10, borderRadius: 999, fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                🔜 {formatMonthYear(token)}
              </span>
            ))
          )}
        </Cell>
        <Cell label="Description">
          {e.description
            ? <span style={{ fontStyle: 'italic', color: '#4b5563' }}>{e.description}</span>
            : '—'}
        </Cell>
        <Cell label="Category · Subcategory">
          {categoryName}
          {e.subcategory_name && (
            <span style={{ color: '#9ca3af' }}> · {e.subcategory_name}</span>
          )}
        </Cell>
        <Cell label="Amount" align="right">
          <strong>{fmt(e.amount)}</strong>
          {e.is_reimbursable && (
            <div style={{
              display: 'inline-block', marginTop: 2,
              background: '#fed7aa', color: '#7c2d12',
              padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600,
            }}>
              Reimbursable
            </div>
          )}
        </Cell>
      </div>

      {/* One freestyle Notes textarea — same data model as the main
          TravelExpenseCard so notes entered here flow straight into
          reports once a trip is assigned. */}
      <div style={{ marginTop: 8 }}>
        <label style={{
          display: 'block', fontSize: 11, color: '#3730a3',
          fontWeight: 600, marginBottom: 4,
        }}>
          Notes
        </label>
        <textarea
          rows={2}
          placeholder="e.g. Flight booked in advance for July sales conference in Athens. BK + YK."
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          onBlur={commitNote}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #c7d2fe',
            borderRadius: 4,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
            background: '#f5f7ff',
          }}
        />
      </div>

      {/* "Assign to trip" dropdown — the primary tool for moving a
          pre-paid / off-window expense into a specific trip card.
          Independent of the YK/BK quick buttons below: picking a trip
          here also auto-sets shareholder_code, so the expense lands in
          the right card no matter what its previous tag was. */}
      {onAssignExpenseToPeriod && allPeriods.length > 0 && (
        <div className="no-print" style={{
          marginTop: 8, padding: '6px 8px',
          background: 'white',
          border: '1px dashed #c7d2fe',
          borderRadius: 4,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          fontSize: 11, color: '#3730a3',
        }}>
          <span style={{ fontWeight: 600 }}>Assign to trip:</span>
          <select
            value={e.assigned_period_id || ''}
            onChange={(ev) => {
              const v = ev.target.value || null
              if (v === (e.assigned_period_id || null)) return
              onAssignExpenseToPeriod(e.id, v)
            }}
            style={{
              padding: '3px 6px', fontSize: 11,
              border: '1px solid #c7d2fe', borderRadius: 4,
              background: 'white', maxWidth: '100%',
            }}
          >
            <option value="">— Auto (match by date) —</option>
            {[...allPeriods].sort(byFromDateAsc).map(p => {
              const f = (p.from_date || '').slice(8) + '/' + (p.from_date || '').slice(5, 7)
              const t = (p.to_date   || '').slice(8) + '/' + (p.to_date   || '').slice(5, 7)
              return (
                <option key={p.id} value={p.id}>
                  {p.shareholder_code} · {f}–{t}
                  {p.destination ? ` · ${p.destination}` : ''}
                </option>
              )
            })}
          </select>
          <span style={{ color: '#6b7280' }}>
            (For trips with both travelers, assign to YK.)
          </span>
        </div>
      )}

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
function UnassignedTravelSection({ periods, travelExpenses, onSwitchTab, onUpdateExpense, onAssignExpenseToPeriod, onViewExpense }) {
  // Build the same expense→period match as ShareholderTravelSection, but
  // across both shareholders. Anything that doesn't match a period this
  // month is "loose" and shows up here.
  const buckets = useMemo(() => {
    const matched = new Set()
    for (const p of periods) {
      for (const e of travelExpenses) {
        // Manual assignment wins over everything — if assigned_period_id
        // is set, the expense matches that period (regardless of dates
        // or shareholder_code) and nothing else.
        if (e.assigned_period_id) {
          if (e.assigned_period_id === p.id) matched.add(e.id)
          continue
        }
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
              allPeriods={periods}
              onUpdateExpense={onUpdateExpense}
              onAssignExpenseToPeriod={onAssignExpenseToPeriod}
              onViewExpense={onViewExpense}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      // shareholder-section keeps shared print styles (color preservation,
      // base layout); unassigned-section is the marker class used to
      //   • force a page break before this block in full prints, and
      //   • hide it entirely in single-shareholder (YK-only / BK-only) prints.
      // See the corresponding rules in TravelLog.css.
      className="shareholder-section unassigned-section"
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
  shareholder, periods, allPeriods, travelExpenses,
  selectedMonth, selectedYear,
  onAddPeriod, onUpdatePeriod, onDeletePeriod, onUpdateExpense,
  onAssignExpenseToPeriod, onViewExpense,
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
      // Order of precedence:
      //   1. Manual assignment (assigned_period_id) — set by the user via
      //      the "Assign to trip" dropdown; takes priority over dates.
      //      An expense manually assigned to a DIFFERENT period is
      //      explicitly excluded from this one even if its date would
      //      match (otherwise we'd double-count it).
      //   2. invoice_date when present (actual transaction date) —
      //      keeps cross-day card transactions on the correct trip.
      //   3. date (bank settlement date) as the fallback.
      const myExpenses = travelExpenses.filter(e => {
        if (e.assigned_period_id) {
          return e.assigned_period_id === p.id
        }
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

      {/* Section totals — moved to the TOP of each shareholder section
          (above the periods panel) so the headline numbers are the
          first thing the reader sees, both on screen and on the first
          printed page of each section. */}
      <div style={{
        marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
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
                allPeriods={allPeriods}
                selectedMonth={selectedMonth}
                selectedYear={selectedYear}
                accentColor={color}
                onUpdate={(patch) => onUpdatePeriod(p.id, patch)}
                onDelete={() => onDeletePeriod(p.id)}
                onUpdateExpense={onUpdateExpense}
                onAssignExpenseToPeriod={onAssignExpenseToPeriod}
                onViewExpense={onViewExpense}
              />
            ))
          )}

          {/* Per-shareholder orphan warnings were removed — those expenses now
              appear in the global "Pre-paid / Unassigned Travel" section at
              the bottom of the page, which gives a cleaner unified view. */}
        </div>
      </div>
    </div>
  )
}

// =============================================================
// One travel period row (editable inline)
// =============================================================
function TravelPeriodRow({ period, expenses, allPeriods, selectedMonth, selectedYear, accentColor, onUpdate, onDelete, onUpdateExpense, onAssignExpenseToPeriod, onViewExpense }) {
  // Local inputs for inline editing — save on blur
  const [fromDate, setFromDate] = useState(period.from_date || '')
  const [toDate, setToDate] = useState(period.to_date || '')
  const [destination, setDestination] = useState(period.destination || '')
  const [reason, setReason] = useState(period.reason || '')
  const [flights, setFlights] = useState(period.flights || '')
  const [comments, setComments] = useState(period.comments || '')

  // Sync if external changes
  useEffect(() => { setFromDate(period.from_date || '') }, [period.from_date])
  useEffect(() => { setToDate(period.to_date || '') }, [period.to_date])
  useEffect(() => { setDestination(period.destination || '') }, [period.destination])
  useEffect(() => { setReason(period.reason || '') }, [period.reason])
  useEffect(() => { setFlights(period.flights || '') }, [period.flights])
  useEffect(() => { setComments(period.comments || '') }, [period.comments])

  const days = daysBetween(fromDate, toDate)
  const periodCompanyPaid = sumAmounts(expenses.filter(e => !e.is_reimbursable))

  // ---------- Header dirty state + validation + save/cancel ----------
  // The 4 header fields (From, To, Destination, Reason) save TOGETHER
  // via an explicit Save button when any are dirty + the combination
  // is valid. This avoids the broken intermediate state where saving
  // From in isolation on blur could leave the row with From > To and
  // trigger the DB CHECK constraint warning.
  //
  // Mandatory: From, To, Destination. Reason is optional but goes
  // through the same save so all four commit atomically.
  const isHeaderDirty =
    fromDate    !== (period.from_date    || '') ||
    toDate      !== (period.to_date      || '') ||
    destination !== (period.destination  || '') ||
    reason      !== (period.reason       || '')

  const headerErrors = []
  if (!fromDate)            headerErrors.push('From Date is required')
  if (!toDate)              headerErrors.push('To Date is required')
  if (!destination.trim())  headerErrors.push('Destination is required')
  if (fromDate && toDate && fromDate > toDate) {
    headerErrors.push('From Date must be on or before To Date')
  }
  const canSaveHeader = isHeaderDirty && headerErrors.length === 0

  const saveHeader = () => {
    if (!canSaveHeader) return
    onUpdate({
      from_date:   fromDate,
      to_date:     toDate,
      destination: destination.trim(),
      reason:      reason.trim() || null,
    })
  }

  const cancelHeader = () => {
    setFromDate(period.from_date    || '')
    setToDate(period.to_date        || '')
    setDestination(period.destination || '')
    setReason(period.reason         || '')
  }

  return (
    <div
      className="travel-period-row"
      style={{
        border: `1px solid #e5e7eb`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 4, marginBottom: 12, background: 'white',
      }}
    >
      {/* Period header row */}
      <div style={{
        padding: 10,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1.5fr 1.5fr auto auto',
        gap: 10, alignItems: 'end',
        background: '#f9fafb',
      }}>
        {/* The four header fields below NO LONGER save on blur — they
            commit together via the Save Changes button rendered below
            this row when any of them is dirty + the combination is
            valid. This avoids the broken intermediate state where
            saving From in isolation could land a From > To row. */}
        <div>
          <label style={lblStyle}>From Date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={inpStyle}
          />
        </div>
        <div>
          <label style={lblStyle}>To Date</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
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

      {/* Save bar — only appears when one of the 4 header fields has
          unsaved local edits. Green strip + Save button when the
          combination is valid; orange strip + bullet list of errors
          when not. Cancel reverts the four inputs to their last-saved
          values. Pristine state renders nothing. */}
      {isHeaderDirty && (
        <div
          className="no-print"
          style={{
            padding: '8px 12px',
            background: canSaveHeader ? '#ecfdf5' : '#fff7ed',
            borderTop: `1px solid ${canSaveHeader ? '#a7f3d0' : '#fed7aa'}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            fontSize: 12,
          }}
        >
          <div style={{
            color: canSaveHeader ? '#065f46' : '#9a3412',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            {canSaveHeader ? (
              <span>✓ Unsaved changes — click Save to commit</span>
            ) : (
              headerErrors.map((msg, i) => (
                <span key={i}>⚠ {msg}</span>
              ))
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={cancelHeader}
              style={{
                padding: '5px 12px',
                fontSize: 12,
                border: '1px solid #d1d5db',
                background: 'white',
                color: '#374151',
                borderRadius: 4,
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveHeader}
              disabled={!canSaveHeader}
              style={{
                padding: '5px 14px',
                fontSize: 12,
                border: 'none',
                background: canSaveHeader ? '#16a34a' : '#d1d5db',
                color: 'white',
                borderRadius: 4,
                cursor: canSaveHeader ? 'pointer' : 'not-allowed',
                fontWeight: 600,
              }}
            >
              💾 Save changes
            </button>
          </div>
        </div>
      )}

      {/* Flights field — full-width freestyle line directly under the
          From / To / Destination / Reason row. Holds the actual flight
          legs taken for this trip (e.g.
          "TLV→LCA→ATH 01/03 · ATH→LCA→TLV 12/03"). Stored in the new
          travel_periods.flights column added in V28. */}
      <div style={{
        padding: '0 10px 10px',
        background: '#f9fafb',
        borderTop: '1px dashed #e5e7eb',
      }}>
        <label style={{ ...lblStyle, paddingTop: 8 }}>Flights</label>
        <input
          type="text"
          placeholder="e.g. TLV → LCA → ATH on 01/03 · ATH → LCA → TLV on 12/03"
          value={flights}
          onChange={(e) => setFlights(e.target.value)}
          onBlur={() => flights !== (period.flights || '') && onUpdate({ flights })}
          style={{ ...inpStyle, width: '100%' }}
        />
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
              currentPeriodId={period.id}
              allPeriods={allPeriods}
              onUpdate={(patch) => onUpdateExpense(e.id, patch)}
              onAssignToPeriod={(periodId) => onAssignExpenseToPeriod(e.id, periodId)}
              onViewExpense={onViewExpense}
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
// One travel-expense card — new design (Day 14 redesign)
// -------------------------------------------------------------
// Layout:
//   • Top: a single identity line mirroring the View Expenses row —
//       Account · Main Ref · Sub Ref · Invoice Date · Date Paid ·
//       Vendor · Description · Category / Subcategory · Amount ·
//       Reimbursable badge (when applicable).
//   • Bottom: ONE freestyle Notes textarea (replaces the previous
//     three Where/Who/Why inputs). Existing data in travel_where /
//     travel_who / travel_why is auto-merged into the displayed
//     value on first render so nothing is lost. On save we write
//     only to travel_why — the most generic of the three. The old
//     where/who columns remain in the DB (unchanged) but are no
//     longer surfaced in the Travel Log UI.
// =============================================================
function TravelExpenseCard({ expense, index, currentPeriodId, allPeriods = [], onUpdate, onAssignToPeriod, onViewExpense }) {
  // Merge any pre-existing where/who/why content into one note string.
  // Order: why first (it's the field we'll save to going forward), then
  // where and who if present and not already substrings of why. We don't
  // try to be too clever — the user can clean it up once and re-save.
  const mergedNote = useMemo(() => {
    const why   = (expense.travel_why   || '').trim()
    const where = (expense.travel_where || '').trim()
    const who   = (expense.travel_who   || '').trim()
    if (why && !where && !who) return why
    const parts = []
    if (why)   parts.push(why)
    if (where && !why.includes(where)) parts.push(`Where: ${where}`)
    if (who   && !why.includes(who))   parts.push(`Who: ${who}`)
    return parts.join('\n')
  }, [expense.travel_why, expense.travel_where, expense.travel_who])

  const [note, setNote] = useState(mergedNote)
  // Re-sync when the underlying expense changes (e.g. optimistic save
  // bubbles back through props, or month switches).
  useEffect(() => { setNote(mergedNote) }, [mergedNote])

  const commitNote = () => {
    if (note === mergedNote) return
    onUpdate({ travel_why: note || null })
  }

  const accountName = expense.accounts?.name || '—'
  const categoryName = expense.expense_categories?.name || '—'
  const subRef = expense.sub_ref_series
    ? `${expense.sub_ref_series}${expense.sub_ref_month}/${expense.sub_ref_seq}`
    : ''

  // Identity-line cells. Each one renders label-on-top, value-below so
  // the row keeps its grid alignment on screen and in print, even when
  // some values are missing (— for nulls keeps the layout stable).
  const Cell = ({ label, children, mono = false, align = 'left', minWidth }) => (
    <div style={{ minWidth, textAlign: align }}>
      <div style={{
        fontSize: 9, color: '#6b7280', textTransform: 'uppercase',
        letterSpacing: 0.4, fontWeight: 600, marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 12, color: '#1f2937', fontWeight: 500,
        fontFamily: mono ? 'monospace' : 'inherit',
        whiteSpace: 'normal', wordBreak: 'break-word',
      }}>
        {children}
      </div>
    </div>
  )

  return (
    <div className="travel-expense-card" style={{
      background: 'white', border: '1px solid #e5e7eb',
      borderLeft: '4px solid #f59e0b',
      borderRadius: 4, padding: 10, marginBottom: 8,
    }}>
      {/* Identity strip — View Expenses-style row. Grid columns sized to
          match the data shapes; the wider ones (Vendor, Description,
          Category/Subcategory) get more room. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns:
          // Account | Ref | SubRef | InvDate | PaidDate | Vendor | Desc | Cat/Sub | Amount
          '90px 80px 70px 85px 85px 1.2fr 1.5fr 1.4fr 90px',
        gap: 8,
        alignItems: 'flex-start',
        paddingBottom: 8,
        borderBottom: '1px dashed #e5e7eb',
      }}>
        <Cell label={`Expense ${index}`}>{accountName}</Cell>
        <Cell label="Ref No" mono>
          {expense.reference_number && onViewExpense ? (
            <button
              type="button"
              onClick={() => onViewExpense(expense.id)}
              title="Open in View Expenses for editing"
              style={{
                background: 'none', border: 'none', padding: 0,
                color: '#1d4ed8', textDecoration: 'underline',
                fontFamily: 'inherit', fontSize: 'inherit',
                cursor: 'pointer',
              }}
            >
              {expense.reference_number}
            </button>
          ) : (expense.reference_number || '—')}
        </Cell>
        <Cell label="Sub Ref" mono>{subRef || '—'}</Cell>
        <Cell label="Invoice Date" mono>{fmtDate(expense.invoice_date)}</Cell>
        <Cell label="Date Paid" mono>{fmtDate(expense.date)}</Cell>
        <Cell label="Vendor">
          <strong>{expense.vendor || '—'}</strong>
        </Cell>
        <Cell label="Description">
          {expense.description
            ? <span style={{ fontStyle: 'italic', color: '#4b5563' }}>{expense.description}</span>
            : '—'}
        </Cell>
        <Cell label="Category · Subcategory">
          {categoryName}
          {expense.subcategory_name && (
            <span style={{ color: '#9ca3af' }}> · {expense.subcategory_name}</span>
          )}
        </Cell>
        <Cell label="Amount" align="right">
          <strong>{fmt(expense.amount)}</strong>
          {expense.is_reimbursable && (
            <div style={{
              display: 'inline-block', marginTop: 2,
              background: '#fed7aa', color: '#7c2d12',
              padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600,
            }}>
              Reimbursable
            </div>
          )}
        </Cell>
      </div>

      {/* One freestyle Notes textarea — replaces the previous three
          Where/Who/Why inputs. Pre-populated with merged content from
          the legacy three fields the first time it's opened, so the
          user simply edits + blurs to save into travel_why. */}
      <div style={{ marginTop: 8 }}>
        <label style={{
          display: 'block', fontSize: 11, color: '#92400e',
          fontWeight: 600, marginBottom: 4,
        }}>
          Notes
        </label>
        <textarea
          rows={3}
          placeholder="e.g. Dinner with prospective client ABC Ltd. Attended by BK and YK. Discussed Q2 renewal."
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          onBlur={commitNote}
          style={{
            width: '100%',
            padding: '6px 8px',
            border: '1px solid #fde68a',
            borderRadius: 4,
            fontSize: 13,
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
            background: '#fffbeb',
          }}
        />
      </div>

      {/* Trip assignment footer — lets the user move this expense to a
          different trip, or un-pin it back to date-based auto-grouping.
          The 📌 prefix is shown when the expense is currently held
          here by an explicit manual assignment (so the user knows the
          date-match would otherwise place it elsewhere). The same row
          also carries the "View / Edit →" jump-out to View Expenses. */}
      {(onAssignToPeriod || onViewExpense) && (
        <TripAssignmentRow
          expense={expense}
          currentPeriodId={currentPeriodId}
          allPeriods={allPeriods}
          onAssignToPeriod={onAssignToPeriod}
          onViewExpense={onViewExpense}
        />
      )}
    </div>
  )
}

// =============================================================
// Tiny dropdown footer used inside both TravelExpenseCard and
// PrepaidExpenseRow. Shows "Trip:" + a <select> listing all
// periods this month (labeled with shareholder + dates +
// destination), plus an "(auto — by date)" option that clears
// assigned_period_id.
// =============================================================
function TripAssignmentRow({ expense, currentPeriodId, allPeriods = [], onAssignToPeriod, onViewExpense }) {
  const isManual = !!expense.assigned_period_id
  const fmtShort = (iso) => {
    if (!iso) return ''
    const [, m, d] = iso.split('-')
    return `${d}/${m}`
  }
  const sorted = [...allPeriods].sort(byFromDateAsc)

  return (
    <div className="no-print" style={{
      marginTop: 8, paddingTop: 8,
      borderTop: '1px dashed #fde68a',
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      justifyContent: 'space-between',
      fontSize: 11, color: '#374151',
    }}>
      {/* Left side — Trip dropdown + clear-manual button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {onAssignToPeriod && (
          <>
            <span style={{ fontWeight: 600, color: '#92400e' }}>
              {isManual ? '📌 Trip (manual):' : 'Trip:'}
            </span>
            <select
              value={expense.assigned_period_id || ''}
              onChange={(ev) => {
                const v = ev.target.value || null
                if (v === (expense.assigned_period_id || null)) return
                onAssignToPeriod(v)
              }}
              style={{
                padding: '3px 6px',
                fontSize: 11,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                background: 'white',
                maxWidth: '100%',
              }}
            >
              <option value="">— Auto (match by date) —</option>
              {sorted.map(p => {
                const lbl =
                  `${p.shareholder_code} · ${fmtShort(p.from_date)}–${fmtShort(p.to_date)}` +
                  (p.destination ? ` · ${p.destination}` : '')
                const isCurrent = p.id === currentPeriodId
                return (
                  <option key={p.id} value={p.id}>
                    {isCurrent ? '✓ ' : ''}{lbl}
                  </option>
                )
              })}
            </select>
            {isManual && (
              <button
                type="button"
                onClick={() => onAssignToPeriod(null)}
                style={{
                  padding: '2px 8px', fontSize: 11,
                  border: '1px solid #d1d5db', background: 'white',
                  color: '#6b7280', borderRadius: 4, cursor: 'pointer',
                  fontWeight: 500,
                }}
                title="Clear manual assignment and revert to date-based auto-grouping"
              >
                Clear manual link
              </button>
            )}
          </>
        )}
      </div>

      {/* Right side — jump to View Expenses for editing */}
      {onViewExpense && (
        <button
          type="button"
          onClick={() => onViewExpense(expense.id)}
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
          ✏ View / Edit →
        </button>
      )}
    </div>
  )
}

// =============================================================
// Helpers
// =============================================================
// Sort comparator used after optimistic period updates so editing a
// period's From Date immediately reorders it within the list. ISO date
// strings (YYYY-MM-DD) sort correctly with plain string comparison.
// Periods without a from_date sink to the bottom.
function byFromDateAsc(a, b) {
  const af = a.from_date || '9999-12-31'
  const bf = b.from_date || '9999-12-31'
  if (af !== bf) return af < bf ? -1 : 1
  // Tie-breaker: to_date ASC, so shorter trips appear before longer ones
  // that start on the same day.
  const at = a.to_date || '9999-12-31'
  const bt = b.to_date || '9999-12-31'
  return at < bt ? -1 : at > bt ? 1 : 0
}

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
