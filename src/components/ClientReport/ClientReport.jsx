import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { RabonaLogo } from '../../assets/RabonaLogo'
import './ClientReport.css'

/**
 * Client Report — per-client view of reimbursable activity for the
 * selected company / month.
 *
 * Data shape:
 *   Reimbursable expenses (outgoing) — is_reimbursable = true; client name is
 *     stored on the expense row's `client_name` field (set via the
 *     reimbursable client picker)
 *   Client Reimbursements (incoming) — category = "Client Reimbursement";
 *     client name is stored as the `subcategory_name` field (each subcategory
 *     of "Client Reimbursement" represents a client)
 *
 * Sections:
 *   1. Summary table — all clients with any historical activity (one row
 *      per client; this month's reimbursable / received / net per client +
 *      grand totals at the bottom)
 *   2. Per-client detail sections (stacked, only for clients with this-month
 *      activity) — each shows two tables (reimbursable expenses, reimbursements
 *      received) and a net for the client
 *
 * Net per client (this month):
 *   = sum(reimbursable expenses this month) − sum(reimbursements received this month)
 *   Positive = client owes us this month
 *   Negative = client paid back more than they incurred this month
 */

export function ClientReport({ selectedCompany, selectedMonth, selectedYear, onSwitchTab }) {
  const [companyId, setCompanyId] = useState(null)
  const [allClients, setAllClients] = useState([])           // historical client list
  const [monthExpenses, setMonthExpenses] = useState([])     // reimbursable outgoing this month
  const [monthReceived, setMonthReceived] = useState([])     // Client Reimbursement incoming this month
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        // Company id
        const { data: comp, error: compErr } = await supabase
          .from('companies')
          .select('id')
          .eq('name', selectedCompany)
          .single()
        if (compErr) throw compErr
        if (cancelled) return
        setCompanyId(comp.id)

        // Client Reimbursement category id (used to identify incoming reimbursements)
        const { data: reimbCat, error: catErr } = await supabase
          .from('expense_categories')
          .select('id')
          .eq('name', 'Client Reimbursement')
          .single()
        if (catErr) throw catErr
        if (cancelled) return
        const reimbCatId = reimbCat.id

        // Historical client list (any all-time activity)
        const [{ data: histOut }, { data: histIn }] = await Promise.all([
          supabase
            .from('expenses')
            .select('client_name')
            .eq('company_id', comp.id)
            .eq('is_reimbursable', true)
            .not('client_name', 'is', null),
          supabase
            .from('expenses')
            .select('subcategory_name')
            .eq('company_id', comp.id)
            .eq('category_id', reimbCatId)
            .not('subcategory_name', 'is', null),
        ])
        if (cancelled) return
        const set = new Set()
        for (const e of (histOut || [])) {
          if (e.client_name?.trim()) set.add(e.client_name.trim())
        }
        for (const e of (histIn || [])) {
          if (e.subcategory_name?.trim()) set.add(e.subcategory_name.trim())
        }
        setAllClients([...set].sort((a, b) => a.localeCompare(b)))

        // This month's reimbursable expenses
        const { data: monthOut, error: outErr } = await supabase
          .from('expenses')
          .select('*, expense_categories(name), accounts(name)')
          .eq('company_id', comp.id)
          .eq('main_ref_year', selectedYear)
          .eq('main_ref_month', selectedMonth)
          .eq('is_reimbursable', true)
          .not('client_name', 'is', null)
          .order('date')
        if (outErr) throw outErr
        if (cancelled) return
        setMonthExpenses(monthOut || [])

        // This month's Client Reimbursement incoming
        const { data: monthIn, error: inErr } = await supabase
          .from('expenses')
          .select('*, expense_categories(name), accounts(name)')
          .eq('company_id', comp.id)
          .eq('main_ref_year', selectedYear)
          .eq('main_ref_month', selectedMonth)
          .eq('category_id', reimbCatId)
          .order('date')
        if (inErr) throw inErr
        if (cancelled) return
        setMonthReceived(monthIn || [])
      } catch (e) {
        console.error('ClientReport load error:', e)
        if (!cancelled) setError(e.message || 'Failed to load client report')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedCompany, selectedMonth, selectedYear])

  // -------------------------------------------------------------
  // Per-client stats + the union list of all clients
  // (historical clients plus any new this-month clients not in historical)
  // -------------------------------------------------------------
  const { perClientStats, totals } = useMemo(() => {
    // Make sure any client appearing this month is in the list, even if not historical yet
    const set = new Set(allClients)
    for (const e of monthExpenses) {
      if (e.client_name?.trim()) set.add(e.client_name.trim())
    }
    for (const e of monthReceived) {
      if (e.subcategory_name?.trim()) set.add(e.subcategory_name.trim())
    }
    const clientList = [...set].sort((a, b) => a.localeCompare(b))

    const sum = (arr) => arr.reduce((s, e) => s + Number(e.amount || 0), 0)

    const perClient = clientList.map(name => {
      const expenses = monthExpenses.filter(e => (e.client_name || '').trim() === name)
      const received = monthReceived.filter(e => (e.subcategory_name || '').trim() === name)
      const expensesTotal = sum(expenses)
      const receivedTotal = sum(received)
      return {
        name,
        expenses, received,
        expensesTotal, receivedTotal,
        net: expensesTotal - receivedTotal,
        hasActivity: expenses.length > 0 || received.length > 0,
      }
    })

    const totals = {
      expensesTotal: sum(monthExpenses),
      receivedTotal: sum(monthReceived),
      net: sum(monthExpenses) - sum(monthReceived),
    }

    return { perClientStats: perClient, totals }
  }, [allClients, monthExpenses, monthReceived])

  if (loading) return <div className="loading">Loading client report…</div>
  if (error) return <div className="error">{error}</div>

  const monthLabel = `${String(selectedMonth).padStart(2, '0')}/${selectedYear}`
  // Long-form "January 2026" — used in the printable expense-report headings
  const monthYearLabel = new Date(selectedYear, selectedMonth - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const activeClients = perClientStats.filter(c => c.hasActivity)

  // CSS that overrides the global @page (set in App.css) and forces A4
  // landscape for the duration of the print. Injected before window.print()
  // and removed via the afterprint event. Same robust pattern as Travel Log,
  // Shareholder Report, and Dashboard (but landscape instead of portrait).
  //
  // Landscape is required here because Client Report tables have 6 columns
  // (Date, Reference, Sub-Ref, Vendor, Category, Amount) and need horizontal
  // room to avoid the columns squeezing or the last column getting clipped.
  const LANDSCAPE_PRINT_CSS = `
    @media print {
      @page {
        size: A4 landscape;
        margin: 1cm 1cm 1.5cm 1cm;
        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
          font-size: 10px;
          color: #6b7280;
        }
      }
    }
  `

  const handlePrint = () => {
    const styleEl = document.createElement('style')
    styleEl.textContent = LANDSCAPE_PRINT_CSS
    document.head.appendChild(styleEl)
    const cleanup = () => {
      styleEl.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  return (
    <div className="client-report" style={{
      background: 'white', padding: 20,
      borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      {/* Toolbar — hidden in print */}
      <div className="action-bar no-print">
        <button onClick={handlePrint} className="toolbar-btn primary">🖨 Print</button>
      </div>

      {/* Screen header — hidden in print (replaced by .print-header letterhead) */}
      <div style={{ marginBottom: 16 }} className="report-page-header no-print">
        <h2 style={{ margin: 0, color: '#2E7D32' }}>
          Client Report · {selectedCompany}
        </h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
          Period: {monthLabel} · Reimbursable activity per client (strict month scope).
        </p>
      </div>

      {/* Print-only letterhead — appears only in printed/PDF output */}
      <div className="print-only print-header">
        <div className="company-name">{selectedCompany}</div>
        <div className="report-title">Client Report</div>
        <div className="period-label">Period: {monthLabel}</div>
      </div>

      {/* Summary table — appears on page 1 of the printout */}
      <div className="summary-section">
      <SectionHeader title="Summary (this month)" subtitle="All clients with historical activity. Rows with €0 across all columns are inactive this month." />
      {perClientStats.length === 0 ? (
        <div style={{
          padding: 20, color: '#9ca3af', fontSize: 13, fontStyle: 'italic',
          background: '#f9fafb', borderRadius: 4, textAlign: 'center',
        }}>
          No clients found. Mark expenses as Reimbursable with a client, and they'll appear here.
        </div>
      ) : (
        <div>
          {/* Summary table. Uses table-layout: auto (default) — see note on
              the per-client expense table for the Firefox print bug rationale.
              No overflowX:auto wrapper either — that was causing Firefox print
              to clip the rightmost column. */}
          <table style={tableStyle}>
            <thead>
              <tr style={thRow}>
                <th style={th}>Client</th>
                <th style={{ ...th, textAlign: 'right' }}>Reimbursable Expenses (Out)</th>
                <th style={{ ...th, textAlign: 'right' }}>Reimbursements Received (In)</th>
                <th style={{ ...th, textAlign: 'right' }}>Net (This Month)</th>
              </tr>
            </thead>
            <tbody>
              {perClientStats.map(c => {
                const isInactive = !c.hasActivity
                const netStyle = isInactive
                  ? { color: '#9ca3af' }
                  : c.net > 0
                    ? { color: '#7c2d12', fontWeight: 700 }   // client owes us
                    : c.net < 0
                      ? { color: '#15803d', fontWeight: 700 } // they paid back more than incurred
                      : { color: '#374151' }
                return (
                  <tr key={c.name} style={{
                    borderBottom: '1px solid #f3f4f6',
                    opacity: isInactive ? 0.55 : 1,
                  }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {isInactive
                        ? <a href={`#client-${c.name}`} onClick={(e) => e.preventDefault()} style={{ color: '#6b7280' }}>{c.name}</a>
                        : <a href={`#client-${c.name}`} style={anchorStyle}>{c.name} ↓</a>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: c.expensesTotal > 0 ? '#dc2626' : '#9ca3af' }}>
                      {fmt(c.expensesTotal)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', color: c.receivedTotal > 0 ? '#16a34a' : '#9ca3af' }}>
                      {fmt(c.receivedTotal)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', ...netStyle }}>
                      {fmt(c.net)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                <td style={{ ...td, fontWeight: 700 }}>TOTAL</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>
                  {fmt(totals.expensesTotal)}
                </td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>
                  {fmt(totals.receivedTotal)}
                </td>
                <td style={{
                  ...td, textAlign: 'right', fontWeight: 700,
                  color: totals.net > 0 ? '#7c2d12' : totals.net < 0 ? '#15803d' : '#374151',
                }}>
                  {fmt(totals.net)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      </div>{/* /summary-section */}

      {/* Per-client expense reports — each on its own page when printed */}
      {activeClients.length > 0 && (
        <>
          <div className="print-hide">
            <SectionHeader
              title={`Per-client expense reports · ${activeClients.length} ${activeClients.length === 1 ? 'client' : 'clients'}`}
              subtitle="When you print (⌘+P), each client appears on its own page. Page 1 will be the Summary above."
            />
          </div>
          {activeClients.map(c => (
            <ClientExpenseReport
              key={c.name}
              client={c}
              monthYearLabel={monthYearLabel}
              companyName={selectedCompany}
            />
          ))}
        </>
      )}
    </div>
  )
}

// =============================================================
// Per-client printable Expense Report
// Single table, no account column, client-facing.
// Each instance starts on its own page in print (via CSS page-break-before).
// =============================================================
function ClientExpenseReport({ client, monthYearLabel, companyName }) {
  return (
    <div
      id={`client-${client.name}`}
      className="client-expense-report"
      style={{
        marginTop: 18, paddingTop: 14, borderTop: '2px solid #e5e7eb',
      }}
    >
      {/* Report header — logo top-right, title + meta on the left. Visible on screen + in print. */}
      <div className="client-expense-report-header" style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', gap: 16,
        marginBottom: 12,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, color: '#1f2937', fontSize: 18, fontWeight: 700 }}>
            {monthYearLabel} Expense Report — {client.name}
          </h3>
          <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
            From: <strong>{companyName}</strong>
          </div>
        </div>
        {/* Company logo / mark in top-right.
            Rabona Holdings = inlined SVG logo.
            Espargos = styled text placeholder until an Espargos SVG is provided. */}
        {companyName === 'Rabona Holdings' && (
          <div style={{ flexShrink: 0 }}>
            <RabonaLogo height={56} className="rabona-logo" />
          </div>
        )}
        {companyName === 'Espargos' && (
          <div style={{
            flexShrink: 0,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '0.18em',
            color: '#1d1d1b',
            textAlign: 'right',
            lineHeight: 1.1,
          }} className="espargos-logo">
            ESPARGOS
            <div style={{ fontSize: 9, fontWeight: 400, letterSpacing: '0.15em', color: '#6b7280', marginTop: 4 }}>
              HOLDINGS
            </div>
          </div>
        )}
      </div>

      {/* Single expense table. Uses table-layout: auto (default) — Firefox
          has a print bug where table-layout:fixed + colgroup percentages can
          cause the last column to be omitted entirely from the printout. */}
      <div>
        <table style={tableStyle}>
          <thead>
            <tr style={thRow}>
              <th style={th}>Date</th>
              <th style={th}>Reference Number</th>
              <th style={th}>Sub-Reference</th>
              <th style={th}>Vendor</th>
              <th style={th}>Category</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {client.expenses.map(r => (
              <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={tdWrap}>{fmtDate(r.date)}</td>
                <td style={{ ...tdWrap, fontFamily: 'monospace', fontSize: 12 }}>{r.reference_number || '—'}</td>
                <td style={{ ...tdWrap, fontFamily: 'monospace', fontSize: 12 }}>
                  {r.sub_ref_series ? `${r.sub_ref_series}${r.sub_ref_month}/${r.sub_ref_seq}` : '—'}
                </td>
                <td style={tdWrap}>
                  <div>{r.vendor || '—'}</div>
                  {r.description && (
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{r.description}</div>
                  )}
                </td>
                <td style={tdWrap}>
                  <div>{r.expense_categories?.name || '—'}</div>
                  {r.subcategory_name && (
                    <div style={{ fontSize: 11, color: '#6b7280' }}>→ {r.subcategory_name}</div>
                  )}
                </td>
                <td style={{ ...tdWrap, textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {fmt(r.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
              <td style={td}></td>
              <td style={td}></td>
              <td style={td}></td>
              <td style={td}></td>
              <td style={{ ...td, fontWeight: 700, textAlign: 'right' }}>TOTAL</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontSize: 15 }}>
                {fmt(client.expensesTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// =============================================================
// Helpers
// =============================================================
const fmt = (n) => {
  const sign = Number(n) < 0 ? '−' : ''
  const abs = Math.abs(Number(n || 0))
  return `${sign}€${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const fmtDate = (iso) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
const accountLabel = (n) => {
  if (!n) return 'Cash'
  if (n.includes('Mastercard')) return 'RMC'
  if (n.includes('Current')) return 'RCC'
  return n
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginTop: 16, marginBottom: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1f2937' }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>
      )}
    </div>
  )
}

const tableStyle = {
  width: '100%', borderCollapse: 'collapse', fontSize: 13,
  background: 'white', border: '1px solid #e5e7eb', borderRadius: 4,
}
const thRow = { background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }
const th = {
  textAlign: 'left', padding: '8px 10px', fontSize: 12,
  color: '#374151', fontWeight: 600,
}
const td = {
  padding: '8px 10px', verticalAlign: 'top',
}
// Same as td, but lets long content wrap inside its cell instead of pushing
// the table wider than its container. Used in the printable expense table.
const tdWrap = {
  padding: '8px 10px', verticalAlign: 'top',
  wordWrap: 'break-word', overflowWrap: 'anywhere',
}
const chip = (bg, fg) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 999,
  background: bg, color: fg, fontSize: 11, fontWeight: 500,
  whiteSpace: 'nowrap',
})
const anchorStyle = {
  color: '#185FA5', textDecoration: 'underline',
}
