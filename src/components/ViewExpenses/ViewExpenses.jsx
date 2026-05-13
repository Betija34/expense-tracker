import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { FinalizeTransaction } from '../BankParser/FinalizeTransaction'
import { LinkInterCompanyModal } from '../LinkInterCompany/LinkInterCompanyModal'
import './ViewExpenses.css'

// Categories that support inter-company linking. An expense in either of these
// can be paired with one in the other company. See LinkInterCompanyModal.jsx.
const INTERCOMPANY_CATEGORIES = new Set([
  'Transfers to Connected Accounts',
  'Intercompany Funding',
])

/**
 * View Expenses — finalized accounting view of the expenses table.
 *
 * Filters strictly by:
 *   - selectedCompany (top-bar)
 *   - selectedMonth / selectedYear (top-bar)
 *
 * Reads from `expenses` table joined with accounts/categories/subcategories.
 * Read-only in this initial build; row actions (Edit/Delete/Approve/etc.)
 * will be wired up in the next step.
 */
export function ViewExpenses({ selectedCompany, selectedMonth, selectedYear, onSwitchTab }) {
  const [expenses, setExpenses] = useState([])
  const [bankStats, setBankStats] = useState({ total: 0, categorized: 0, pending: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all') // 'all' | 'in' | 'out' | 'pending' | 'approved' | 'reimbursable'
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [companyId, setCompanyId] = useState(null)
  const [recategorizing, setRecategorizing] = useState(null) // { transaction, expense }
  const [linkingExpense, setLinkingExpense] = useState(null) // expense being linked / unlinked
  // Map of expense.linked_expense_id → { reference_number, company_name } for chip display.
  const [counterpartMap, setCounterpartMap] = useState(new Map())
  // Sort state — clickable column headers. Default matches old behavior (date DESC, seq DESC).
  //   sortBy:  'ref' | 'date' | 'amount' | 'vendor'
  //   sortDir: 'asc' | 'desc'
  const [sortBy, setSortBy] = useState('date')
  const [sortDir, setSortDir] = useState('desc')

  // ----- Date range for the selected month -----
  const { startDate, endDate } = useMemo(() => {
    const m = String(selectedMonth).padStart(2, '0')
    const start = `${selectedYear}-${m}-01`
    const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
    const end = `${selectedYear}-${m}-${String(lastDay).padStart(2, '0')}`
    return { startDate: start, endDate: end }
  }, [selectedMonth, selectedYear])

  // ----- Load expenses + bank stats whenever filter context changes -----
  useEffect(() => {
    if (!selectedCompany) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany, selectedMonth, selectedYear])

  const loadAll = async () => {
    try {
      setLoading(true)
      setError(null)

      const { data: company, error: companyErr } = await supabase
        .from('companies')
        .select('id')
        .eq('name', selectedCompany)
        .single()
      if (companyErr) throw companyErr
      if (!company) {
        setExpenses([])
        setBankStats({ total: 0, categorized: 0, pending: 0 })
        setCompanyId(null)
        return
      }
      setCompanyId(company.id)

      // Expenses for this month
      const { data: expData, error: expErr } = await supabase
        .from('expenses')
        .select(`
          *,
          accounts (id, name, account_type),
          expense_categories (id, name, direction)
        `)
        .eq('company_id', company.id)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: false })
        .order('main_ref_seq', { ascending: false })
      if (expErr) throw expErr

      // Bank transactions for the same month (for reconciliation banner)
      const { data: btx, error: btxErr } = await supabase
        .from('bank_transactions')
        .select('id, status')
        .eq('company_id', company.id)
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
      if (btxErr) throw btxErr

      const total = btx?.length || 0
      const categorized = (btx || []).filter(t => t.status === 'matched').length
      const pending = total - categorized

      setExpenses(expData || [])
      setBankStats({ total, categorized, pending })

      // Load counterpart details for any expenses that have an inter-company link.
      // We need the linked expense's ref + company name to render a meaningful chip
      // like "🔗 E26/2/3 (Espargos)" instead of a generic "Linked" badge.
      const linkedIds = (expData || []).map(e => e.linked_expense_id).filter(Boolean)
      if (linkedIds.length > 0) {
        const { data: counterparts, error: cpErr } = await supabase
          .from('expenses')
          .select('id, reference_number, companies(name)')
          .in('id', linkedIds)
        if (!cpErr) {
          const map = new Map()
          for (const cp of (counterparts || [])) {
            map.set(cp.id, {
              reference_number: cp.reference_number,
              company_name: cp.companies?.name || '—',
            })
          }
          setCounterpartMap(map)
        }
      } else {
        setCounterpartMap(new Map())
      }
    } catch (err) {
      console.error('Error loading expenses:', err)
      setError(err.message || 'Failed to load expenses')
    } finally {
      setLoading(false)
    }
  }

  // ----- Split group map: split_group_id → [sorted siblings] -----
  const splitGroupMap = useMemo(() => {
    const map = new Map()
    expenses.forEach(e => {
      if (e.split_group_id) {
        if (!map.has(e.split_group_id)) map.set(e.split_group_id, [])
        map.get(e.split_group_id).push(e)
      }
    })
    // sort siblings by portion index (or main_ref_seq) for consistent N/M numbering
    for (const group of map.values()) {
      group.sort((a, b) => (a.split_portion_index ?? a.main_ref_seq) - (b.split_portion_index ?? b.main_ref_seq))
    }
    return map
  }, [expenses])

  // ----- Stats (computed over ALL expenses for the month, not just filtered view) -----
  const stats = useMemo(() => {
    const init = { count: 0, amountIn: 0, amountOut: 0, countIn: 0, countOut: 0 }
    const rcc  = { ...init }
    const rmc  = { ...init }
    const cash = { ...init }
    let pending = 0, approved = 0, locked = 0

    expenses.forEach(e => {
      const acctName = e.accounts?.name || ''
      const amt = Number(e.amount || 0)
      const bucket =
        !e.accounts ? cash :
        acctName.includes('Mastercard') ? rmc :
        acctName.includes('Current') ? rcc :
        null
      if (bucket) {
        bucket.count += 1
        if (e.direction === 'in') {
          bucket.countIn += 1
          bucket.amountIn += amt
        } else {
          bucket.countOut += 1
          bucket.amountOut += amt
        }
      }
      if (e.status === 'pending')  pending  += 1
      else if (e.status === 'approved') approved += 1
      else if (e.status === 'locked')   locked   += 1
      else pending += 1 // default
    })
    return { rcc, rmc, cash, pending, approved, locked, total: expenses.length }
  }, [expenses])

  // ----- Filtering + sorting -----
  // Filter pill state (in/out/pending/etc) narrows rows; sort state (header click) orders them.
  const filteredExpenses = useMemo(() => {
    const filtered = expenses.filter(e => {
      if (filter === 'in') return e.direction === 'in'
      if (filter === 'out') return e.direction === 'out'
      if (filter === 'pending') return e.status === 'pending'
      if (filter === 'approved') return e.status === 'approved'
      if (filter === 'reimbursable') return e.is_reimbursable === true
      return true
    })

    // Key extractor per sort column. Numeric where possible, lowercased string otherwise.
    const keyFn = {
      ref:    (e) => Number(e.main_ref_seq || 0),
      date:   (e) => e.date || '',                                  // ISO strings sort lexically = chronologically
      amount: (e) => Number(e.amount || 0),
      vendor: (e) => (e.vendor || '').toLowerCase(),
    }[sortBy] || ((e) => e.main_ref_seq || 0)

    const sign = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const ka = keyFn(a), kb = keyFn(b)
      if (ka < kb) return -1 * sign
      if (ka > kb) return  1 * sign
      // Stable tie-breaker: always order by seq desc within ties so split portions
      // stay adjacent and consistent regardless of primary sort column.
      return (b.main_ref_seq || 0) - (a.main_ref_seq || 0)
    })
  }, [expenses, filter, sortBy, sortDir])

  // Click handler: same column toggles direction; different column starts at desc.
  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortDir('desc')
    }
  }

  // Small ↑/↓ arrow next to the active column's label
  const sortArrow = (column) => {
    if (sortBy !== column) return null
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  // ----- Helpers -----
  const accountBadge = (acct) => {
    if (!acct) return <span className="badge badge-acct-cash">Cash</span>
    if (acct.name?.includes('Mastercard')) return <span className="badge badge-acct-rmc">RMC</span>
    if (acct.name?.includes('Current')) return <span className="badge badge-acct-rcc">RCC</span>
    return <span className="badge badge-acct-cash">{acct.name}</span>
  }

  // Row color — matches Bank Parser scheme.
  // Pink = Mastercard, Gray = Current Account, Light blue = Cash (out only).
  // Pending rows additionally get a yellow left-edge accent.
  const getRowClassName = (e) => {
    const isIncoming = e.direction === 'in'
    const acctName = e.accounts?.name || ''
    let cls = ''
    if (!e.accounts) {
      cls = 'row-cash-outgoing'
    } else if (acctName.includes('Mastercard')) {
      cls = isIncoming ? 'row-rmc-incoming' : 'row-rmc-outgoing'
    } else if (acctName.includes('Current')) {
      cls = isIncoming ? 'row-rcc-incoming' : 'row-rcc-outgoing'
    }
    if ((e.status || 'pending') === 'pending') {
      cls += ' row-pending'
    }
    return cls.trim()
  }

  // ----- Print -----
  const handlePrint = () => {
    window.print()
  }

  // ----- CSV Export -----
  const handleExportCSV = () => {
    const headers = [
      'Account', 'In/Out', 'Main Ref', 'Sub Ref', 'Date',
      'Vendor', 'Description', 'Category', 'Subcategory',
      'Amount', 'Status', 'Reimbursable', 'Shareholder', 'Linked', 'Source'
    ]

    const rows = filteredExpenses.map(e => {
      const acct = !e.accounts ? 'Cash'
        : e.accounts.name?.includes('Mastercard') ? 'RMC'
        : e.accounts.name?.includes('Current') ? 'RCC'
        : e.accounts.name || ''
      return [
        acct,
        e.direction === 'in' ? 'IN' : 'OUT',
        renderMainRef(e),
        renderSubRef(e),
        formatDate(e.date),
        e.vendor || '',
        e.description || '',
        e.expense_categories?.name || '',
        e.subcategory_name || '',
        Number(e.amount || 0).toFixed(2),
        e.status || 'pending',
        e.is_reimbursable ? 'Yes' : '',
        e.shareholder_code || '',
        e.linked_expense_id ? 'Yes' : '',
        e.bank_transaction_id ? 'Bank' : 'Manual',
      ]
    })

    const escape = (v) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `expenses_${selectedCompany}_${selectedYear}-${String(selectedMonth).padStart(2, '0')}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const directionBadge = (dir) =>
    dir === 'in'
      ? <span className="badge badge-in">IN</span>
      : <span className="badge badge-out">OUT</span>

  // Status badge — clickable to toggle pending ↔ approved.
  // Locked badges are not clickable.
  const statusBadge = (expense) => {
    const s = expense.status || 'pending'
    const isLocked = s === 'locked'
    return (
      <span
        className={`badge badge-status-${s} ${isLocked ? '' : 'badge-clickable'}`}
        onClick={isLocked ? undefined : () => toggleStatus(expense)}
        title={
          isLocked ? 'Month is locked — cannot change status' :
          s === 'pending' ? 'Click to mark approved' :
          'Click to mark pending'
        }
      >
        {s}
      </span>
    )
  }

  // Toggle pending ↔ approved for a single row
  const toggleStatus = async (expense) => {
    const newStatus = expense.status === 'approved' ? 'pending' : 'approved'
    const { error } = await supabase
      .from('expenses')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', expense.id)
    if (error) {
      console.error(error)
      alert('Failed to update status: ' + error.message)
      return
    }
    loadAll()
  }

  // Bulk approve all selected pending expenses
  const handleBulkApprove = async () => {
    const idsToApprove = filteredExpenses
      .filter(e => selectedIds.has(e.id) && e.status === 'pending')
      .map(e => e.id)
    if (idsToApprove.length === 0) {
      alert('No pending expenses are selected.')
      return
    }
    const { error } = await supabase
      .from('expenses')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .in('id', idsToApprove)
    if (error) {
      console.error(error)
      alert('Bulk approve failed: ' + error.message)
      return
    }
    setSelectedIds(new Set())
    loadAll()
  }

  const formatDate = (iso) => {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  const formatAmount = (amount) => {
    const n = Number(amount || 0)
    return `€${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const renderMainRef = (e) => {
    if (e.reference_number) return e.reference_number
    if (e.main_ref_year && e.main_ref_month && e.main_ref_seq) {
      const yy = String(e.main_ref_year).slice(-2)
      return `${yy}/${e.main_ref_month}/${e.main_ref_seq}`
    }
    return '—'
  }

  const renderSubRef = (e) => {
    if (!e.sub_ref_series) return '—'
    return `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
  }

  const renderFlags = (e) => {
    const chips = []
    if (e.is_split && e.split_group_id) {
      const siblings = splitGroupMap.get(e.split_group_id) || []
      const idx = siblings.findIndex(s => s.id === e.id)
      const positionLabel = idx >= 0 ? `Split ${idx + 1}/${siblings.length}` : 'Split'
      const tooltip = siblings.length > 0
        ? `Linked to: ${siblings.map(renderMainRef).join(', ')}`
        : 'Split portion'
      chips.push(<span key="split" className="flag-chip split" title={tooltip}>{positionLabel}</span>)
    } else if (e.is_split) {
      chips.push(<span key="split" className="flag-chip split">Split</span>)
    }
    if (e.is_reimbursable) {
      const label = e.client_name
        ? `Reimb · ${e.client_name}`
        : '⚠ Reimb (no client)'
      chips.push(
        <span
          key="reimb"
          className="flag-chip reimbursable"
          title={e.client_name ? `Reimbursable from ${e.client_name}` : 'Reimbursable — but no client assigned yet'}
        >
          {label}
        </span>
      )
    }
    if (e.shareholder_code) chips.push(<span key="sh" className="flag-chip shareholder">{e.shareholder_code}</span>)
    if (e.linked_expense_id) {
      // Show the counterpart's ref + company so reconciliation is at-a-glance.
      const cp = counterpartMap.get(e.linked_expense_id)
      const label = cp
        ? `🔗 ${cp.reference_number} (${cp.company_name})`
        : '🔗 Linked'
      chips.push(
        <span
          key="lk"
          className="flag-chip linked"
          title={cp ? `Inter-company link to ${cp.company_name} expense ${cp.reference_number}` : 'Linked to a counterpart expense'}
        >
          {label}
        </span>
      )
    }
    if (e.bank_transaction_id) chips.push(<span key="bk" className="flag-chip bank">Bank</span>)
    if (chips.length === 0) return '—'
    return <span className="flag-chips">{chips}</span>
  }

  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(new Set(filteredExpenses.map(x => x.id)))
    } else {
      setSelectedIds(new Set())
    }
  }

  // ----- Reconciliation banner state -----
  const reconClass =
    bankStats.total === 0 ? 'recon-banner' :
    bankStats.pending === 0 ? 'recon-banner success' : 'recon-banner warning'

  // ----- Render -----
  return (
    <div className="view-expenses">
      <h2>View Expenses — {selectedCompany}</h2>

      {/* Action Bar: Print + Export */}
      <div className="action-bar">
        <button className="toolbar-btn primary" onClick={handlePrint}>
          🖨️ Print
        </button>
        <button className="toolbar-btn" onClick={handleExportCSV}>
          📥 Export CSV
        </button>
      </div>

      {/* Reconciliation Banner */}
      <div className={reconClass}>
        <span className="label">
          {String(selectedMonth).padStart(2, '0')}/{selectedYear} Reconciliation:
        </span>
        <span className="stat"><strong>{bankStats.total}</strong> bank tx imported</span>
        <span className="stat"><strong>{bankStats.categorized}</strong> categorized</span>
        <span className="stat"><strong>{bankStats.pending}</strong> pending</span>
        {bankStats.pending > 0 && (
          <button
            className="review-link"
            onClick={() => onSwitchTab && onSwitchTab('bank-parser')}
          >
            Review pending →
          </button>
        )}
      </div>

      {/* Stats Bar — per-account counts + status breakdown */}
      <div className="stats-bar">
        <div className="stat-card rcc">
          <div className="stat-header">
            <span className="stat-title">RCC (Current Account)</span>
            <span className="stat-count">{stats.rcc.count}</span>
          </div>
          <div className="stat-rows">
            <div className="stat-row">
              <span className="label">In · {stats.rcc.countIn}</span>
              <span className="value in">{formatAmount(stats.rcc.amountIn)}</span>
            </div>
            <div className="stat-row">
              <span className="label">Out · {stats.rcc.countOut}</span>
              <span className="value out">{formatAmount(stats.rcc.amountOut)}</span>
            </div>
          </div>
        </div>

        <div className="stat-card rmc">
          <div className="stat-header">
            <span className="stat-title">RMC (Mastercard)</span>
            <span className="stat-count">{stats.rmc.count}</span>
          </div>
          <div className="stat-rows">
            <div className="stat-row">
              <span className="label">In · {stats.rmc.countIn}</span>
              <span className="value in">{formatAmount(stats.rmc.amountIn)}</span>
            </div>
            <div className="stat-row">
              <span className="label">Out · {stats.rmc.countOut}</span>
              <span className="value out">{formatAmount(stats.rmc.amountOut)}</span>
            </div>
          </div>
        </div>

        <div className="stat-card cash">
          <div className="stat-header">
            <span className="stat-title">Cash (Out only)</span>
            <span className="stat-count">{stats.cash.count}</span>
          </div>
          <div className="stat-rows">
            <div className="stat-row">
              <span className="label">Entries</span>
              <span className="value neutral">{stats.cash.countOut}</span>
            </div>
            <div className="stat-row">
              <span className="label">Total Out</span>
              <span className="value out">{formatAmount(stats.cash.amountOut)}</span>
            </div>
          </div>
        </div>

        <div className="stat-card status">
          <div className="stat-header">
            <span className="stat-title">Status</span>
            <span className="stat-count">{stats.total}</span>
          </div>
          <div className="stat-rows">
            <div
              className="stat-row clickable-stat"
              onClick={() => setFilter('pending')}
              title="Click to filter pending only"
            >
              <span className="label">⏳ Pending</span>
              <span className="value neutral">{stats.pending}</span>
            </div>
            <div
              className="stat-row clickable-stat"
              onClick={() => setFilter('approved')}
              title="Click to filter approved only"
            >
              <span className="label">✓ Approved</span>
              <span className="value neutral">{stats.approved}</span>
            </div>
            <div className="stat-row">
              <span className="label">🔒 Locked</span>
              <span className="value neutral">{stats.locked}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bulk action bar — appears when rows are selected */}
      {selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <span>
            <strong>{selectedIds.size}</strong> selected
          </span>
          <button className="toolbar-btn primary" onClick={handleBulkApprove}>
            ✓ Approve selected
          </button>
          <button className="toolbar-btn" onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="expense-filters">
        <button className={`filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
          All ({expenses.length})
        </button>
        <button className={`filter-btn ${filter === 'out' ? 'active' : ''}`} onClick={() => setFilter('out')}>
          Outgoing
        </button>
        <button className={`filter-btn ${filter === 'in' ? 'active' : ''}`} onClick={() => setFilter('in')}>
          Incoming
        </button>
        <button className={`filter-btn ${filter === 'pending' ? 'active' : ''}`} onClick={() => setFilter('pending')}>
          Pending
        </button>
        <button className={`filter-btn ${filter === 'approved' ? 'active' : ''}`} onClick={() => setFilter('approved')}>
          Approved
        </button>
        <button className={`filter-btn ${filter === 'reimbursable' ? 'active' : ''}`} onClick={() => setFilter('reimbursable')}>
          Reimbursable
        </button>
      </div>

      {/* Loading / Error / Empty / Table */}
      {loading && <div className="loading-state">Loading expenses...</div>}
      {error && !loading && <div className="loading-state" style={{ color: '#dc2626' }}>Error: {error}</div>}

      {!loading && !error && filteredExpenses.length === 0 && (
        <div className="empty-state">
          {expenses.length === 0
            ? `No expenses recorded for ${String(selectedMonth).padStart(2, '0')}/${selectedYear} yet.`
            : 'No expenses match the current filter.'}
        </div>
      )}

      {!loading && !error && filteredExpenses.length > 0 && (
        <div className="expenses-table-wrap">
          <table className="expenses-table">
            <thead>
              <tr>
                <th className="select-cell">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredExpenses.length && filteredExpenses.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Account</th>
                <th>In/Out</th>
                <th
                  onClick={() => handleSort('ref')}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title="Click to sort by reference number"
                >
                  Main Ref{sortArrow('ref')}
                </th>
                <th>Sub Ref</th>
                <th
                  onClick={() => handleSort('date')}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title="Click to sort by date"
                >
                  Date{sortArrow('date')}
                </th>
                <th
                  onClick={() => handleSort('vendor')}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title="Click to sort by vendor"
                >
                  Vendor{sortArrow('vendor')}
                </th>
                <th>Description</th>
                <th>Category</th>
                <th>Subcategory</th>
                <th
                  onClick={() => handleSort('amount')}
                  style={{ cursor: 'pointer', userSelect: 'none' }}
                  title="Click to sort by amount"
                >
                  Amount{sortArrow('amount')}
                </th>
                <th>Status</th>
                <th>Flags</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map(e => (
                <tr key={e.id} className={getRowClassName(e)}>
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(e.id)}
                      onChange={() => toggleSelected(e.id)}
                    />
                  </td>
                  <td>{accountBadge(e.accounts)}</td>
                  <td>{directionBadge(e.direction)}</td>
                  <td className="ref-cell">{renderMainRef(e)}</td>
                  <td className="ref-cell">{renderSubRef(e)}</td>
                  <td>{formatDate(e.date)}</td>
                  <td>{e.vendor || '—'}</td>
                  <td>{e.description || '—'}</td>
                  <td>{e.expense_categories?.name || '—'}</td>
                  <td>{e.subcategory_name || '—'}</td>
                  <td className={`amount-cell ${e.direction === 'in' ? 'amount-in' : 'amount-out'}`}>
                    {e.direction === 'in' ? '+' : '−'} {formatAmount(e.amount)}
                  </td>
                  <td>{statusBadge(e)}</td>
                  <td>{renderFlags(e)}</td>
                  <td>
                    <div className="action-buttons">
                      <button
                        className="action-btn"
                        title={e.bank_transaction_id ? 'Re-categorize this bank-imported expense' : 'Edit'}
                        onClick={async () => {
                          if (e.bank_transaction_id) {
                            // Fetch the source bank transaction, then open Re-categorize modal in place
                            const { data: bankTx, error: btxErr } = await supabase
                              .from('bank_transactions')
                              .select('*, accounts(name)')
                              .eq('id', e.bank_transaction_id)
                              .maybeSingle()
                            if (btxErr || !bankTx) {
                              alert('Could not find the bank transaction linked to this expense.')
                              return
                            }
                            setRecategorizing({ transaction: bankTx, expense: e })
                          } else {
                            alert('Edit action for manual expenses coming in next step.')
                          }
                        }}
                      >✏️</button>
                      {/* Inter-company link button — only shown for the two intercompany
                          categories ("Transfers to Connected Accounts" outgoing or
                          "Intercompany Funding" incoming). Click opens LinkInterCompanyModal
                          which lets the user pair this expense with its counterpart in the
                          OTHER company (or unlink an existing pair). */}
                      {INTERCOMPANY_CATEGORIES.has(e.expense_categories?.name) && (
                        <button
                          className="action-btn"
                          title={e.linked_expense_id ? 'Manage inter-company link' : 'Link to counterpart in the other company'}
                          onClick={() => setLinkingExpense(e)}
                        >🔗</button>
                      )}
                      <button
                        className="action-btn danger"
                        title={e.bank_transaction_id ? 'Bank-imported: delete in Bank Parser' : 'Delete'}
                        disabled={!!e.bank_transaction_id}
                        onClick={() => alert('Delete action coming in next step.')}
                      >🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Re-categorize modal — opens in place when Edit is clicked on a bank-imported expense */}
      {recategorizing && companyId && (
        <FinalizeTransaction
          transaction={recategorizing.transaction}
          companyId={companyId}
          companyName={selectedCompany}
          existingExpense={recategorizing.expense}
          onClose={() => setRecategorizing(null)}
          onSave={() => loadAll()}
        />
      )}

      {/* Inter-company link modal — opens when 🔗 button is clicked on an
          intercompany expense. Handles both initial linking (when unlinked)
          and viewing/unlinking (when already paired). */}
      {linkingExpense && (
        <LinkInterCompanyModal
          expense={linkingExpense}
          currentCompany={selectedCompany}
          onClose={() => setLinkingExpense(null)}
          onSaved={() => loadAll()}
        />
      )}
    </div>
  )
}
