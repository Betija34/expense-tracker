import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { PrintLetterhead } from '../PrintLetterhead/PrintLetterhead'
import './Dashboard.css'

/**
 * Dashboard — top-level financial overview for the selected company / month.
 *
 * Layout (per user spec, May 12 2026):
 *   Row 1 — Bank reconciliation:     Total Inwards   ·   Total Outwards
 *   Row 2 — Company P&L:             Monthly Income  ·   Monthly Expenses
 *   Row 3 — Attention/pending alerts (pending expenses, unfinalized bank txs)
 *   Inwards Breakdown by category
 *   Outwards Breakdown by category (helps explain Income vs. Expenses gap)
 *   Internal Account Movements (MC ↔ Current)
 *   Shareholder Movements (YK / BK)
 *   Reimbursable Tracking (outstanding owed by clients)
 *   Inter-Company Transfers (to/from other company)
 *   Inter-Company Reimbursements (placeholder — needs tagging)
 *
 * Definitions:
 *   Total Inwards   = sum(direction='in')
 *   Total Outwards  = sum(direction='out')
 *   Monthly Income  = sum(direction='in' AND category='Client Payment')
 *   Monthly Expenses= sum(direction='out' AND NOT is_reimbursable AND
 *                         category NOT IN [Movement Between Accounts,
 *                                          Transfers to Connected Accounts,
 *                                          Personal Expenses of Shareholders])
 */

// Categories excluded from "Monthly Expenses" (they're not real costs of the company)
const EXPENSE_EXCLUSIONS = new Set([
  'Movement Between Accounts',
  'Transfers to Connected Accounts',
  'Personal Expenses of Shareholders',
])

export function Dashboard({ selectedCompany, selectedMonth, selectedYear, onSwitchTab }) {
  const [companyId, setCompanyId] = useState(null)
  const [otherCompanyName, setOtherCompanyName] = useState('')
  const [expenses, setExpenses] = useState([])
  const [pendingBankCount, setPendingBankCount] = useState(0)
  const [unlinkedIntercompany, setUnlinkedIntercompany] = useState([]) // recent intercompany transfers awaiting a counterpart pair
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        // Companies
        const { data: companies, error: compErr } = await supabase
          .from('companies')
          .select('id, name')
        if (compErr) throw compErr
        if (cancelled) return

        const currentCompany = (companies || []).find(c => c.name === selectedCompany)
        if (!currentCompany) {
          setError(`Company "${selectedCompany}" not found`)
          setLoading(false)
          return
        }
        const otherCompany = (companies || []).find(c => c.name !== selectedCompany)
        setCompanyId(currentCompany.id)
        setOtherCompanyName(otherCompany?.name || '—')

        // Expenses for the period
        const { data: exps, error: expErr } = await supabase
          .from('expenses')
          .select('*, expense_categories(name), accounts(name)')
          .eq('company_id', currentCompany.id)
          .eq('main_ref_year', selectedYear)
          .eq('main_ref_month', selectedMonth)
        if (expErr) throw expErr
        if (cancelled) return
        setExpenses(exps || [])

        // Unfinalized bank tx count — SCOPED TO THE SELECTED MONTH so the
        // Dashboard reflects only this month's parser state. Previously this
        // counted across all months, which meant an imported-but-unprocessed
        // future month (e.g. May) leaked its 53 unmatched rows onto every
        // other month's dashboard. Matches Bank Parser's per-month behavior.
        const bankMonthStart = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`
        const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1
        const nextYear  = selectedMonth === 12 ? selectedYear + 1 : selectedYear
        const bankMonthEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
        const { count: bankCount, error: bankErr } = await supabase
          .from('bank_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', currentCompany.id)
          .eq('status', 'unmatched')
          .gte('transaction_date', bankMonthStart)
          .lt('transaction_date', bankMonthEnd)
        if (bankErr) throw bankErr
        if (cancelled) return
        setPendingBankCount(bankCount || 0)

        // Transfers awaiting their counterpart pair (last 90 days).
        // Covers BOTH link kinds:
        //   - Inter-company: Transfers to Connected Accounts / Intercompany Funding
        //   - Intra-company: Movement Between Accounts (Current ↔ Mastercard etc.)
        // We always show recent unlinked transfers here as a standing "watch list"
        // regardless of the top-bar month selector — a transfer made on Jan 31 might
        // not have its counterpart entered until Feb 2-3, and we want it surfaced.
        const ninetyDaysAgo = new Date()
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
        const ninetyDaysAgoIso = ninetyDaysAgo.toISOString().slice(0, 10)
        const { data: unlinkedRows, error: unlinkErr } = await supabase
          .from('expenses')
          .select('id, reference_number, vendor, amount, date, direction, accounts(name), expense_categories(name)')
          .eq('company_id', currentCompany.id)
          .is('linked_expense_id', null)
          .gte('date', ninetyDaysAgoIso)
          .order('date', { ascending: false })
        if (unlinkErr) throw unlinkErr
        if (cancelled) return
        // Filter client-side to the linkable categories. Cheap given small row count.
        // Note: intra-company has TWO categories — "Movement Between Accounts" (outgoing
        // leg) and "Movement Between Accounts (in)" (incoming leg). Both need surfacing.
        const LINKABLE = new Set([
          'Transfers to Connected Accounts',
          'Intercompany Funding',
          'Movement Between Accounts',
          'Movement Between Accounts (in)',
        ])
        const unlinkedFiltered = (unlinkedRows || []).filter(r =>
          LINKABLE.has(r.expense_categories?.name)
        )
        setUnlinkedIntercompany(unlinkedFiltered)
      } catch (e) {
        console.error('Dashboard load error:', e)
        if (!cancelled) setError(e.message || 'Failed to load dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedCompany, selectedMonth, selectedYear])

  // -------------------------------------------------------------
  // Aggregations
  // -------------------------------------------------------------
  const stats = useMemo(() => {
    const sum = (arr) => arr.reduce((s, e) => s + Number(e.amount || 0), 0)

    const inwards = expenses.filter(e => e.direction === 'in')
    const outwards = expenses.filter(e => e.direction === 'out')

    // Inwards is bank-only by definition (cash is outgoing-only in this system).
    // Outwards combines bank + cash since that's the user's preferred top-line view.
    const bankInwards = inwards.filter(e => e.account_id)
    const cashOutwards = outwards.filter(e => !e.account_id)

    const totalInwards = sum(bankInwards)
    const totalOutwards = sum(outwards)            // bank + cash combined
    const totalCashOut = sum(cashOutwards)         // kept for the untagged-cash warning + reconciliation footnote
    const cashUntagged = sum(cashOutwards.filter(e => !e.shareholder_code))

    const monthlyIncome = sum(
      inwards.filter(e => e.expense_categories?.name === 'Client Payment')
    )
    const monthlyExpenses = sum(
      outwards.filter(e =>
        !e.is_reimbursable &&
        !EXPENSE_EXCLUSIONS.has(e.expense_categories?.name)
      )
    )

    // Breakdowns sum to the top-row cards.
    //   Inwards   — bank-side only (cash incoming doesn't exist in this system)
    //   Outwards  — bank + cash combined (matches the new combined Total Outwards card)
    const inwardsByCategory = groupByCategory(bankInwards)
    const outwardsByCategory = groupByCategory(outwards)

    // Internal movements (Movement Between Accounts category, outgoing side)
    const internalOut = outwards.filter(e =>
      e.expense_categories?.name === 'Movement Between Accounts'
    )
    const mcToCurrent = sum(internalOut.filter(e => e.accounts?.name?.includes('Mastercard')))
    const currentToMc = sum(internalOut.filter(e => e.accounts?.name?.includes('Current')))

    // Shareholder Movements per code
    const shareholderStats = ['YK', 'BK'].map(code => {
      const from = sum(inwards.filter(e =>
        e.expense_categories?.name === 'Shareholder Funding' &&
        e.shareholder_code === code
      ))
      // "To shareholder" = any outgoing tagged with this shareholder
      // (covers Personal Expenses + cash paid by them + anything else attributed)
      const to = sum(outwards.filter(e => e.shareholder_code === code))
      return { code, from, to, balance: to - from }
    })

    // Reimbursables
    const reimbursableOutstanding = sum(outwards.filter(e => e.is_reimbursable))
    const reimbursementsReceived = sum(
      inwards.filter(e => e.expense_categories?.name === 'Client Reimbursement')
    )

    // Reimbursable by client (outstanding)
    const reimbByClient = {}
    for (const e of outwards.filter(e => e.is_reimbursable)) {
      const c = e.client_name || 'Unassigned'
      reimbByClient[c] = (reimbByClient[c] || 0) + Number(e.amount || 0)
    }
    const reimbByClientList = Object.entries(reimbByClient)
      .sort((a, b) => b[1] - a[1])
      .map(([client, amount]) => ({ client, amount }))

    // Inter-company transfers (all kinds)
    const fromOther = sum(inwards.filter(e =>
      e.expense_categories?.name === 'Intercompany Funding'
    ))
    const toOther = sum(outwards.filter(e =>
      e.expense_categories?.name === 'Transfers to Connected Accounts'
    ))

    // Inter-Company Reimbursements — the SUBSET of inter-company traffic
    // that comes from "Payment Made on Behalf of <Other>" subcategories
    // (bank-paid OR cash-paid, via the V15/V16 + paymentOnBehalf.js auto-
    // create logic). This isolates "I paid for them / they paid for me"
    // from the broader direct-transfer flow.
    const paidOnBehalfOfOther = sum(outwards.filter(e =>
      e.subcategory_name === `Payment Made on Behalf of ${otherCompanyName}`
    ))
    const paidByOtherOnOurBehalf = sum(inwards.filter(e =>
      e.subcategory_name === `From ${otherCompanyName} — Payment on Behalf`
    ))
    // Positive net = OTHER company owes us this much
    // Negative net = WE owe other company
    const reimbOnBehalfNet = paidOnBehalfOfOther - paidByOtherOnOurBehalf

    // Individual rows for the listing in the card
    const paidOnBehalfOfOtherRows = outwards
      .filter(e => e.subcategory_name === `Payment Made on Behalf of ${otherCompanyName}`)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const paidByOtherOnOurBehalfRows = inwards
      .filter(e => e.subcategory_name === `From ${otherCompanyName} — Payment on Behalf`)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

    // Pending count (current month)
    const pendingExpenses = expenses.filter(e => (e.status || 'pending') === 'pending').length

    return {
      totalInwards, totalOutwards,
      totalCashOut, cashUntagged,
      monthlyIncome, monthlyExpenses,
      inwardsByCategory, outwardsByCategory,
      mcToCurrent, currentToMc, netInternal: currentToMc - mcToCurrent,
      shareholderStats,
      reimbursableOutstanding, reimbursementsReceived,
      reimbByClientList,
      fromOther, toOther, netIntercompany: fromOther - toOther,
      paidOnBehalfOfOther, paidByOtherOnOurBehalf, reimbOnBehalfNet,
      paidOnBehalfOfOtherRows, paidByOtherOnOurBehalfRows,
      pendingExpenses,
    }
  }, [expenses, otherCompanyName])

  const fmt = (n) => `€${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const monthLabel = `${String(selectedMonth).padStart(2, '0')}/${selectedYear}`

  if (loading) return <div className="loading">Loading dashboard…</div>
  if (error) return <div className="error">{error}</div>

  // CSS that overrides the global landscape @page (set in App.css) and forces
  // A4 portrait for the duration of the print. Injected before window.print()
  // and removed via the afterprint event. Same pattern as Travel Log + Shareholder Report.
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

  const handlePrint = () => {
    const styleEl = document.createElement('style')
    styleEl.textContent = PORTRAIT_PRINT_CSS
    document.head.appendChild(styleEl)
    const cleanup = () => {
      styleEl.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  return (
    <div className="dashboard" style={{
      background: 'white',
      padding: 20,
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      {/* Toolbar — hidden in print */}
      <div className="action-bar no-print">
        <button onClick={handlePrint} className="toolbar-btn primary">🖨 Print</button>
      </div>

      {/* Unified letterhead — shows on screen AND in print (text left / logo right). */}
      <PrintLetterhead
        companyName={selectedCompany}
        reportTitle="Dashboard Summary"
        periodLabel={`Period: ${monthLabel}`}
      />

      {/* Attention bar — operational call-to-action, hidden in print */}
      {(stats.pendingExpenses > 0 || pendingBankCount > 0) && (
        <div className="no-print" style={{
          background: '#fef3c7', border: '1px solid #fcd34d',
          borderRadius: 4, padding: 12, marginBottom: 16,
          display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        }}>
          <strong style={{ color: '#92400e' }}>⚠ Needs attention:</strong>
          {stats.pendingExpenses > 0 && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onSwitchTab && onSwitchTab('view-expenses') }}
              style={{ color: '#92400e', textDecoration: 'underline' }}
            >
              {stats.pendingExpenses} expense{stats.pendingExpenses === 1 ? '' : 's'} pending review →
            </a>
          )}
          {pendingBankCount > 0 && (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onSwitchTab && onSwitchTab('bank-parser') }}
              style={{ color: '#92400e', textDecoration: 'underline' }}
            >
              {pendingBankCount} bank transaction{pendingBankCount === 1 ? '' : 's'} unfinalized →
            </a>
          )}
        </div>
      )}

      {/* Unlinked transfers (inter-company + intra-company) — last 90 days across all months.
          A transfer often crosses months (sent Jan 31, received Feb 2), so this list
          deliberately ignores the top-bar Month selector and shows everything recent
          that still needs a counterpart link. Includes:
            - Inter-company: Transfers to Connected Accounts / Intercompany Funding
            - Intra-company: Movement Between Accounts (Current ↔ Mastercard, etc.) */}
      {unlinkedIntercompany.length > 0 && (
        <div className="unlinked-intercompany" style={{
          background: '#fff7ed', border: '1px solid #fdba74',
          borderRadius: 4, padding: 12, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong style={{ color: '#9a3412' }}>
              🔗 {unlinkedIntercompany.length} transfer{unlinkedIntercompany.length === 1 ? '' : 's'} awaiting counterpart pair
            </strong>
            <span style={{ fontSize: 12, color: '#9a3412' }}>(last 90 days, all months)</span>
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); onSwitchTab && onSwitchTab('view-expenses') }}
              style={{ marginLeft: 'auto', color: '#9a3412', textDecoration: 'underline', fontSize: 13 }}
            >
              Manage links in View Expenses →
            </a>
          </div>
          <div style={{ fontSize: 13, color: '#9a3412', marginBottom: 8 }}>
            These transfers don't have their counterpart linked yet — either inter-company (to {otherCompanyName}) or intra-company (between your own accounts). Once the matching entry exists, click 🔗 on the row in View Expenses to pair them.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #fdba74' }}>
                <th style={{ padding: '6px 4px' }}>Date</th>
                <th style={{ padding: '6px 4px' }}>Ref</th>
                <th style={{ padding: '6px 4px' }}>Account</th>
                <th style={{ padding: '6px 4px' }}>Direction</th>
                <th style={{ padding: '6px 4px' }}>Kind</th>
                <th style={{ padding: '6px 4px' }}>Vendor / Description</th>
                <th style={{ padding: '6px 4px', textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {unlinkedIntercompany.map(r => {
                const [y, m, d] = r.date.split('-')
                const catName = r.expense_categories?.name
                const kindLabel = (catName === 'Movement Between Accounts' || catName === 'Movement Between Accounts (in)') ? 'Intra' : 'Inter'
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #fed7aa' }}>
                    <td style={{ padding: '5px 4px' }}>{`${d}/${m}/${y}`}</td>
                    <td style={{ padding: '5px 4px', fontFamily: 'monospace' }}>{r.reference_number}</td>
                    <td style={{ padding: '5px 4px' }}>{r.accounts?.name || '—'}</td>
                    <td style={{ padding: '5px 4px' }}>{r.direction === 'in' ? '↓ Incoming' : '↑ Outgoing'}</td>
                    <td style={{ padding: '5px 4px' }}>{kindLabel}</td>
                    <td style={{ padding: '5px 4px' }}>{r.vendor || '—'}</td>
                    <td style={{ padding: '5px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      €{Number(r.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Row 1: Period totals — Inwards (bank) and Outwards (bank + cash combined) */}
      <SectionHeader title="Period totals" subtitle="Total money in and out for the month. Cash is included in Outwards." />
      <div style={twoColumnGrid}>
        <StatCard
          title="Total Inwards Payments"
          value={fmt(stats.totalInwards)}
          accent="#16a34a"
          subtitle="All incoming this month"
        />
        <StatCard
          title="Total Outwards Payments"
          value={fmt(stats.totalOutwards)}
          accent="#dc2626"
          subtitle={`Bank + cash combined · of which cash: ${fmt(stats.totalCashOut)}`}
        />
      </div>
      {stats.cashUntagged > 0 && (
        <div style={{
          marginTop: 8, padding: '6px 10px', fontSize: 12,
          background: '#fef3c7', color: '#92400e',
          border: '1px solid #fcd34d', borderRadius: 4,
        }}>
          ⚠ {fmt(stats.cashUntagged)} of cash this month is not tagged with a shareholder. Edit those rows in Add Expense to attribute properly.
        </div>
      )}

      {/* Row 2: Company P&L */}
      <SectionHeader title="Company P&L" subtitle="Real revenue and real costs, excluding pass-throughs and transfers" />
      <div style={twoColumnGrid}>
        <StatCard
          title="Monthly Income"
          value={fmt(stats.monthlyIncome)}
          accent="#16a34a"
          subtitle="Client Payments only (real revenue)"
        />
        <StatCard
          title="Monthly Expenses"
          value={fmt(stats.monthlyExpenses)}
          accent="#dc2626"
          subtitle="Excludes reimbursable, internal & intercompany transfers, personal shareholder expenses"
        />
      </div>
      <div style={{
        marginTop: 8, padding: '8px 12px', fontSize: 13,
        background: '#f9fafb', borderRadius: 4, color: '#374151',
      }}>
        Net P&L (Income − Expenses): <strong style={{
          color: stats.monthlyIncome - stats.monthlyExpenses >= 0 ? '#16a34a' : '#dc2626',
        }}>
          {fmt(stats.monthlyIncome - stats.monthlyExpenses)}
        </strong>
      </div>

      {/* Inwards Breakdown — matches the top Inwards card (incoming is bank-only by design) */}
      <SectionHeader title="Inwards Breakdown" subtitle="Incoming by category — sums to Total Inwards above" />
      <CategoryBreakdownCard
        rows={stats.inwardsByCategory}
        total={stats.totalInwards}
        accent="#16a34a"
        emptyText="No incoming entries for this month."
      />

      {/* Outwards Breakdown — bank + cash combined, matches top Outwards card */}
      <SectionHeader title="Outwards Breakdown" subtitle="Outgoing by category (bank + cash) — sums to Total Outwards above. Greyed rows are excluded from Monthly Expenses." />
      <CategoryBreakdownCard
        rows={stats.outwardsByCategory}
        total={stats.totalOutwards}
        accent="#dc2626"
        emptyText="No outgoing entries for this month."
        highlightExclusions
      />

      {/* Internal Account Movements — only relevant for companies with multiple
          bank accounts. Espargos has a single account, so we hide this section. */}
      {selectedCompany !== 'Espargos' && (
        <>
          <SectionHeader title="Internal Account Movements" subtitle={`Money moved between ${selectedCompany}'s own accounts (RMC ↔ RCC)`} />
          <div style={threeColumnGrid}>
            <StatCard
              title="Mastercard → Current"
              value={fmt(stats.mcToCurrent)}
              accent="#185FA5"
            />
            <StatCard
              title="Current → Mastercard"
              value={fmt(stats.currentToMc)}
              accent="#993556"
            />
            <StatCard
              title="Net Internal Movement"
              value={fmt(stats.netInternal)}
              accent="#374151"
              subtitle="Positive = more to Mastercard"
            />
          </div>
        </>
      )}

      {/* Shareholder Movements */}
      <SectionHeader title="Shareholder Movements" subtitle="Tracks each shareholder's position with the company this month" />
      {stats.shareholderStats.map(s => (
        <div key={s.code} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#3730a3' }}>
            {s.code}
          </div>
          <div style={threeColumnGrid}>
            <StatCard
              title="Transfers From 🟢"
              value={fmt(s.from)}
              accent="#16a34a"
              subtitle={`Shareholder Funding from ${s.code}`}
            />
            <StatCard
              title="Transfers To 🔴"
              value={fmt(s.to)}
              accent="#dc2626"
              subtitle={`Any outgoing tagged with ${s.code}`}
            />
            <StatCard
              title="Balance"
              value={fmt(s.balance)}
              accent={s.balance >= 0 ? '#dc2626' : '#16a34a'}
              subtitle={s.balance >= 0 ? `Company owes ${s.code}` : `${s.code} owes company`}
            />
          </div>
        </div>
      ))}

      {/* Reimbursable Tracking — only for companies that do client reimbursement.
          Espargos doesn't reimburse client expenses (as of now), so we hide this
          section. Code and data structures stay intact; just remove the conditional
          here later if Espargos starts doing reimbursements. */}
      {selectedCompany !== 'Espargos' && (
        <>
          <SectionHeader title="Reimbursable Tracking" subtitle="Expenses paid for clients — what's owed back" />
          <div style={threeColumnGrid}>
            <StatCard
              title="Reimbursable Expenses (out)"
              value={fmt(stats.reimbursableOutstanding)}
              accent="#7c2d12"
              subtitle="Outgoing payments marked reimbursable"
            />
            <StatCard
              title="Reimbursements Received (in)"
              value={fmt(stats.reimbursementsReceived)}
              accent="#16a34a"
              subtitle="Client Reimbursement incoming"
            />
            <StatCard
              title="Net Owed by Clients"
              value={fmt(stats.reimbursableOutstanding - stats.reimbursementsReceived)}
              accent={stats.reimbursableOutstanding - stats.reimbursementsReceived > 0 ? '#7c2d12' : '#16a34a'}
              subtitle="Reimbursable − received this month"
            />
          </div>
          {stats.reimbByClientList.length > 0 && (
            <div style={{
              marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 4, padding: 12,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
                Reimbursable by client / project (this month):
              </div>
              {stats.reimbByClientList.map(({ client, amount }) => (
                <div key={client} style={{
                  display: 'flex', justifyContent: 'space-between',
                  fontSize: 13, padding: '2px 0', color: '#78350f',
                }}>
                  <span>{client}</span>
                  <strong>{fmt(amount)}</strong>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Inter-Company Transfers */}
      <SectionHeader
        title="Inter-Company Transfers"
        subtitle={`Capital flow between ${selectedCompany} and ${otherCompanyName}`}
      />
      <div style={threeColumnGrid}>
        <StatCard
          title={`${otherCompanyName} → ${selectedCompany} 🟢`}
          value={fmt(stats.fromOther)}
          accent="#16a34a"
          subtitle="Intercompany Funding (incoming)"
        />
        <StatCard
          title={`${selectedCompany} → ${otherCompanyName} 🔴`}
          value={fmt(stats.toOther)}
          accent="#dc2626"
          subtitle="Transfers to Connected Accounts (outgoing)"
        />
        <StatCard
          title="Net Inter-Company Flow"
          value={fmt(stats.netIntercompany)}
          accent="#374151"
          subtitle={stats.netIntercompany >= 0
            ? `Net inflow from ${otherCompanyName}`
            : `Net outflow to ${otherCompanyName}`}
        />
      </div>

      {/* Inter-Company Reimbursements — pulls from the "Payment Made on
          Behalf of X" / "From X — Payment on Behalf" subcategory pair
          (V15/V16 + paymentOnBehalf.js). Both bank-paid and cash-paid
          on-behalf entries are aggregated here. The net is who-owes-who
          this month. */}
      <SectionHeader
        title="Inter-Company Reimbursements"
        subtitle={`Payments made by one company on behalf of the other (bank or cash) · ${monthLabel}`}
      />
      {stats.paidOnBehalfOfOther === 0 && stats.paidByOtherOnOurBehalf === 0 ? (
        <div style={{
          background: '#f9fafb', border: '1px solid #e5e7eb',
          borderRadius: 4, padding: 14, color: '#6b7280', fontSize: 13,
        }}>
          No inter-company on-behalf payments this month.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* 3-card summary: paid by us / paid by them / net */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
          }}>
            <StatCard
              title={`Paid by ${selectedCompany} for ${otherCompanyName}`}
              value={fmt(stats.paidOnBehalfOfOther)}
              subtitle={`${stats.paidOnBehalfOfOtherRows.length} expense${stats.paidOnBehalfOfOtherRows.length === 1 ? '' : 's'}`}
              accent="#dc2626"
            />
            <StatCard
              title={`Paid by ${otherCompanyName} for ${selectedCompany}`}
              value={fmt(stats.paidByOtherOnOurBehalf)}
              subtitle={`${stats.paidByOtherOnOurBehalfRows.length} expense${stats.paidByOtherOnOurBehalfRows.length === 1 ? '' : 's'}`}
              accent="#16a34a"
            />
            <StatCard
              title="Net balance"
              value={stats.reimbOnBehalfNet === 0
                ? fmt(0)
                : (stats.reimbOnBehalfNet > 0
                    ? `+${fmt(stats.reimbOnBehalfNet)}`
                    : `−${fmt(Math.abs(stats.reimbOnBehalfNet))}`)}
              subtitle={
                stats.reimbOnBehalfNet === 0
                  ? 'Even — no balance this month'
                  : stats.reimbOnBehalfNet > 0
                    ? `${otherCompanyName} owes ${selectedCompany}`
                    : `${selectedCompany} owes ${otherCompanyName}`
              }
              accent={stats.reimbOnBehalfNet >= 0 ? '#16a34a' : '#dc2626'}
            />
          </div>

          {/* Detail rows (only show sections that have entries) */}
          {stats.paidOnBehalfOfOtherRows.length > 0 && (
            <OnBehalfDetailList
              title={`${selectedCompany} paid on behalf of ${otherCompanyName}`}
              rows={stats.paidOnBehalfOfOtherRows}
              fmt={fmt}
            />
          )}
          {stats.paidByOtherOnOurBehalfRows.length > 0 && (
            <OnBehalfDetailList
              title={`${otherCompanyName} paid on behalf of ${selectedCompany}`}
              rows={stats.paidByOtherOnOurBehalfRows}
              fmt={fmt}
            />
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================
// Helpers + sub-components
// =============================================================

function groupByCategory(rows) {
  const map = {}
  for (const e of rows) {
    const name = e.expense_categories?.name || 'Uncategorized'
    if (!map[name]) map[name] = { name, total: 0, count: 0 }
    map[name].total += Number(e.amount || 0)
    map[name].count += 1
  }
  return Object.values(map).sort((a, b) => b.total - a.total)
}

const twoColumnGrid = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8,
}
const threeColumnGrid = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 8,
}

function SectionHeader({ title, subtitle }) {
  return (
    <div className="section-header" style={{ marginTop: 20, marginBottom: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1f2937' }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>
      )}
    </div>
  )
}

function StatCard({ title, value, accent = '#16a34a', subtitle }) {
  return (
    <div className="stat-card" style={{
      background: 'white',
      border: '1px solid #e5e7eb',
      borderLeft: `4px solid ${accent}`,
      borderRadius: 4,
      padding: 12,
    }}>
      <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

function CategoryBreakdownCard({ rows, total, accent, emptyText, highlightExclusions }) {
  if (rows.length === 0) {
    return (
      <div style={{
        background: '#f9fafb', border: '1px dashed #d1d5db',
        borderRadius: 4, padding: 14, color: '#9ca3af', fontSize: 13, textAlign: 'center',
      }}>
        {emptyText}
      </div>
    )
  }
  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb',
      borderRadius: 4, padding: 12,
    }}>
      {rows.map(r => {
        const pct = total > 0 ? (r.total / total) * 100 : 0
        const isExcluded = highlightExclusions && (EXPENSE_EXCLUSIONS.has(r.name))
        return (
          <div key={r.name} style={{ marginBottom: 8 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 13, marginBottom: 3,
            }}>
              <span style={{ color: isExcluded ? '#9ca3af' : '#1f2937' }}>
                {r.name}
                {isExcluded && <span style={{ marginLeft: 6, fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>
                  (excluded from Monthly Expenses)
                </span>}
                <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af' }}>· {r.count} {r.count === 1 ? 'entry' : 'entries'}</span>
              </span>
              <strong style={{ color: isExcluded ? '#9ca3af' : accent }}>
                €{Number(r.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
            </div>
            <div style={{
              width: '100%', height: 5, background: '#f3f4f6', borderRadius: 999,
            }}>
              <div style={{
                width: `${Math.min(pct, 100)}%`, height: '100%',
                background: isExcluded ? '#d1d5db' : accent,
                borderRadius: 999,
              }} />
            </div>
          </div>
        )
      })}
      <div style={{
        marginTop: 10, paddingTop: 8, borderTop: '1px solid #e5e7eb',
        display: 'flex', justifyContent: 'space-between',
        fontSize: 13, fontWeight: 700,
      }}>
        <span>Total</span>
        <span style={{ color: accent }}>
          €{Number(total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  )
}

// =============================================================
// OnBehalfDetailList — list of individual on-behalf expense rows
// for the Inter-Company Reimbursements card. Compact table format
// so it fits on a printed dashboard alongside the 3-card summary.
// =============================================================
function OnBehalfDetailList({ title, rows, fmt }) {
  return (
    <div style={{
      background: 'white', border: '1px solid #e5e7eb',
      borderRadius: 4, padding: 10,
    }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: '#374151',
        marginBottom: 8,
      }}>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
            <th style={onBehalfThStyle}>Date</th>
            <th style={onBehalfThStyle}>Ref</th>
            <th style={onBehalfThStyle}>Vendor</th>
            <th style={onBehalfThStyle}>Description</th>
            <th style={{ ...onBehalfThStyle, textAlign: 'right' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={onBehalfTdStyle}>{r.date}</td>
              <td style={{ ...onBehalfTdStyle, fontFamily: 'monospace' }}>{r.reference_number || '—'}</td>
              <td style={onBehalfTdStyle}>{r.vendor || '—'}</td>
              <td style={onBehalfTdStyle}>{r.description || '—'}</td>
              <td style={{ ...onBehalfTdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                {fmt(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const onBehalfThStyle = {
  padding: '5px 6px',
  fontWeight: 600,
  fontSize: 11,
  color: '#6b7280',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
}
const onBehalfTdStyle = {
  padding: '5px 6px',
  color: '#1f2937',
  verticalAlign: 'top',
}
