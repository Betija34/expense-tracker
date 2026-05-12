import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'

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

        // Unfinalized bank tx count (across all months — these need attention regardless)
        const { count: bankCount, error: bankErr } = await supabase
          .from('bank_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', currentCompany.id)
          .eq('status', 'unmatched')
        if (bankErr) throw bankErr
        if (cancelled) return
        setPendingBankCount(bankCount || 0)
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

    // Inter-company transfers
    const fromOther = sum(inwards.filter(e =>
      e.expense_categories?.name === 'Intercompany Funding'
    ))
    const toOther = sum(outwards.filter(e =>
      e.expense_categories?.name === 'Transfers to Connected Accounts'
    ))

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
      pendingExpenses,
    }
  }, [expenses])

  const fmt = (n) => `€${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const monthLabel = `${String(selectedMonth).padStart(2, '0')}/${selectedYear}`

  if (loading) return <div className="loading">Loading dashboard…</div>
  if (error) return <div className="error">{error}</div>

  return (
    <div style={{
      background: 'white',
      padding: 20,
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: '#2E7D32' }}>
          Dashboard · {selectedCompany}
        </h2>
        <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
          {monthLabel} · Use the month/year selector at the top of the page to view a different period.
        </p>
      </div>

      {/* Attention bar */}
      {(stats.pendingExpenses > 0 || pendingBankCount > 0) && (
        <div style={{
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

      {/* Internal Account Movements */}
      <SectionHeader title="Internal Account Movements" subtitle="Money moved between Rabona's own accounts (RMC ↔ RCC)" />
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

      {/* Reimbursable Tracking */}
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

      {/* Inter-Company Reimbursements — placeholder */}
      <SectionHeader title="Inter-Company Reimbursements" subtitle="Expenses one company paid on behalf of the other — needs tagging" />
      <div style={{
        background: '#f9fafb', border: '1px dashed #d1d5db',
        borderRadius: 4, padding: 14, color: '#6b7280', fontSize: 13,
      }}>
        Not yet implemented — we need a way to tag a specific expense as
        "paid on behalf of {otherCompanyName}" (e.g., a new flag on the expense row
        or a dedicated subcategory). Once that exists, this card will show:
        <ul style={{ margin: '6px 0 0 18px' }}>
          <li>Expenses paid on behalf of {otherCompanyName}</li>
          <li>Expenses {otherCompanyName} paid on behalf of {selectedCompany}</li>
          <li>Balance — who owes who</li>
        </ul>
      </div>
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
    <div style={{ marginTop: 20, marginBottom: 8 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#1f2937' }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{subtitle}</div>
      )}
    </div>
  )
}

function StatCard({ title, value, accent = '#16a34a', subtitle }) {
  return (
    <div style={{
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
