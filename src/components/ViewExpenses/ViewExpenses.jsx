import { useState, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabaseClient'
import { FinalizeTransaction } from '../BankParser/FinalizeTransaction'
import { LinkInterCompanyModal } from '../LinkInterCompany/LinkInterCompanyModal'
import { EditManualExpenseModal } from './EditManualExpenseModal'
import { PrintLetterhead } from '../PrintLetterhead/PrintLetterhead'
import './ViewExpenses.css'

// Categories that support transfer linking (the 🔗 button appears on these rows).
// LinkInterCompanyModal handles both link modes:
//   - inter-company: Rabona ↔ Espargos pairs (Transfers to Connected Accounts / Intercompany Funding)
//   - intra-company: account-to-account within same company (Movement Between Accounts)
const LINKABLE_CATEGORIES = new Set([
  'Transfers to Connected Accounts',
  'Intercompany Funding',
  'Movement Between Accounts',
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
export function ViewExpenses({ selectedCompany, selectedMonth, selectedYear, onSwitchTab, focusExpenseId, onFocusHandled }) {
  const [expenses, setExpenses] = useState([])
  const [bankStats, setBankStats] = useState({ total: 0, categorized: 0, pending: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all') // 'all' | 'in' | 'out' | 'pending' | 'approved' | 'reimbursable'
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [companyId, setCompanyId] = useState(null)
  const [recategorizing, setRecategorizing] = useState(null) // { transaction, expense }
  const [linkingExpense, setLinkingExpense] = useState(null) // expense being linked / unlinked
  const [editingManual, setEditingManual] = useState(null)   // manual expense being edited
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

  // loadAll
  //   silent: when true, skips the loading-flag toggle so the table doesn't
  //   unmount/remount and the scroll position stays where the user left it.
  //   Use silent: true after any save/approve/delete; use a plain loadAll()
  //   only on first mount / context change (when we want the spinner).
  const loadAll = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true)
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

      // Load counterpart details for any expenses that have a transfer link.
      // We need the linked expense's ref + (company name OR account name) to render
      // a meaningful chip like "🔗 E26/2/3 (Espargos)" for inter-company or
      // "🔗 26/1/52 (Mastercard)" for intra-company account-to-account.
      const linkedIds = (expData || []).map(e => e.linked_expense_id).filter(Boolean)
      if (linkedIds.length > 0) {
        const { data: counterparts, error: cpErr } = await supabase
          .from('expenses')
          .select('id, reference_number, company_id, account_id, companies(name), accounts(name), expense_categories(name)')
          .in('id', linkedIds)
        if (!cpErr) {
          const map = new Map()
          for (const cp of (counterparts || [])) {
            // Distinguish link kind based on counterpart's category:
            // intra-company links sit on "Movement Between Accounts" on both sides;
            // inter-company links sit on Transfers to Connected Accounts / Intercompany Funding.
            const isIntra = cp.expense_categories?.name === 'Movement Between Accounts'
            map.set(cp.id, {
              reference_number: cp.reference_number,
              company_name: cp.companies?.name || '—',
              account_name: cp.accounts?.name || null,
              is_intra: isIntra,
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
      if (!silent) setLoading(false)
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
    // Deep-link highlight: when another tab requested we focus this row,
    // add a 'row-focused' class for the briefly-visible flash effect.
    if (focusExpenseId && e.id === focusExpenseId) {
      cls += ' row-focused'
    }
    return cls.trim()
  }

  // When a focus request comes in (e.g. Travel Log "View →"), scroll the
  // matching row into view + clear the request so the highlight class
  // sticks for a moment then fades. The CSS handles the animation.
  useEffect(() => {
    if (!focusExpenseId) return
    if (expenses.length === 0) return
    // Defer to next tick so the row is in the DOM.
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-expense-id="${focusExpenseId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      // Keep highlight class for ~2s then clear so future renders don't keep it on.
      const clearT = setTimeout(() => {
        if (onFocusHandled) onFocusHandled()
      }, 2200)
      return () => clearTimeout(clearT)
    }, 80)
    return () => clearTimeout(t)
  }, [focusExpenseId, expenses])

  // ----- Print -----
  const handlePrint = () => {
    window.print()
  }

  // ----- Delete an expense (manual OR bank-imported) -----
  // Handles four cases:
  //   1. Bank-imported single → confirm + un-match bank tx + delete
  //   2. Bank-imported split portion → can only delete the WHOLE group (otherwise
  //      the surviving portions wouldn't sum to the bank amount). Prompt 'all'/cancel.
  //   3. Manual split portion → ask 'this' / 'all' / cancel
  //   4. Manual single → simple confirm + delete
  //
  // For any case that involves a bank-imported row we also:
  //   • NULL linked_expense_id on any counterpart pointing at the rows we'll delete
  //   • NULL bank_transactions.matched_expense_id and set status back to 'pending'
  //     (so the bank transaction returns to the Bank Parser for re-Finalize)
  const handleDelete = async (expense) => {
    const isBankImported = !!expense.bank_transaction_id

    // Helper: break FK refs + delete a set of expense IDs + un-match bank tx
    const deleteExpenseSet = async (ids, bankTxIdToUnmatch) => {
      if (!ids || ids.length === 0) return
      // NULL counterpart linked_expense_id pointing at any of these rows
      const { error: unlinkErr } = await supabase
        .from('expenses')
        .update({ linked_expense_id: null, updated_at: new Date().toISOString() })
        .in('linked_expense_id', ids)
      if (unlinkErr) throw unlinkErr
      // Un-match the bank transaction first so its FK to matched_expense_id
      // doesn't block the delete
      if (bankTxIdToUnmatch) {
        const { error: unmatchErr } = await supabase
          .from('bank_transactions')
          .update({
            matched_expense_id: null,
            status: 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', bankTxIdToUnmatch)
        if (unmatchErr) throw unmatchErr
      }
      const { error: delErr } = await supabase.from('expenses').delete().in('id', ids)
      if (delErr) throw delErr
    }

    // Bank-imported split portion → group-only delete
    if (isBankImported && expense.is_split && expense.split_group_id) {
      const siblings = splitGroupMap.get(expense.split_group_id) || []
      const choice = window.prompt(
        `This is part of a BANK-IMPORTED split group with ${siblings.length} portion(s).\n\n` +
        `Bank-imported splits can only be deleted as a whole (otherwise the surviving portions wouldn't sum to the bank amount).\n\n` +
        `Type "all" to delete the entire group AND return the bank transaction to the Bank Parser for re-categorization.\n` +
        `Type anything else (or leave blank) to cancel.`
      )
      if (choice !== 'all') return
      try {
        await deleteExpenseSet(siblings.map(s => s.id), expense.bank_transaction_id)
        loadAll({ silent: true })
      } catch (err) {
        alert('Delete failed: ' + (err.message || err))
      }
      return
    }

    // Bank-imported single → confirm + un-match
    if (isBankImported) {
      if (!window.confirm(
        `Delete BANK-IMPORTED expense ${expense.reference_number || ''}?\n\n` +
        `${expense.vendor || '—'} · €${Number(expense.amount || 0).toFixed(2)}\n\n` +
        `This will also return the bank transaction to the Bank Parser as 'pending' so you can re-categorize it.\n\n` +
        `This cannot be undone.`
      )) return
      try {
        await deleteExpenseSet([expense.id], expense.bank_transaction_id)
        loadAll({ silent: true })
      } catch (err) {
        alert('Delete failed: ' + (err.message || err))
      }
      return
    }

    // Manual split portion case
    if (expense.is_split && expense.split_group_id) {
      const siblings = splitGroupMap.get(expense.split_group_id) || []
      const choice = window.prompt(
        `This is part of a split group with ${siblings.length} portion(s).\n\n` +
        `Type "this" to delete just this portion (refs: ${expense.reference_number}).\n` +
        `Type "all" to delete the entire split group (refs: ${siblings.map(s => s.reference_number).join(', ')}).\n` +
        `Type anything else (or leave blank) to cancel.`
      )
      if (choice === 'this') {
        try {
          await deleteExpenseSet([expense.id], null)
          loadAll({ silent: true })
        } catch (err) {
          alert('Delete failed: ' + (err.message || err))
        }
      } else if (choice === 'all') {
        try {
          await deleteExpenseSet(siblings.map(s => s.id), null)
          loadAll({ silent: true })
        } catch (err) {
          alert('Delete failed: ' + (err.message || err))
        }
      }
      return
    }

    // Manual single-expense case
    if (!window.confirm(`Delete expense ${expense.reference_number || ''}?\n\n${expense.vendor || '—'} · €${Number(expense.amount || 0).toFixed(2)}\n\nThis cannot be undone.`)) {
      return
    }
    try {
      await deleteExpenseSet([expense.id], null)
      loadAll({ silent: true })
    } catch (err) {
      alert('Delete failed: ' + (err.message || err))
    }
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

  // ----- Excel Export -----
  // Builds an .xlsx workbook in the browser with one sheet of expense rows,
  // then triggers a download. The Amount column is a real number (not text)
  // so it can be summed/filtered in Excel/Numbers. Date is ISO format for
  // sortability — Excel auto-detects it as a date when opened.
  const handleExportExcel = () => {
    const headers = [
      'Account', 'In/Out', 'Main Ref', 'Sub Ref', 'Date',
      'Vendor', 'Description', 'Category', 'Subcategory',
      'Amount', 'Status', 'Reimbursable', 'Shareholder', 'Linked', 'Source',
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
        e.date || '',                       // ISO date (Excel detects as date)
        e.vendor || '',
        e.description || '',
        e.expense_categories?.name || '',
        e.subcategory_name || '',
        Number(e.amount || 0),              // real number (not string)
        e.status || 'pending',
        e.is_reimbursable ? 'Yes' : '',
        e.shareholder_code || '',
        e.linked_expense_id ? 'Yes' : '',
        e.bank_transaction_id ? 'Bank' : 'Manual',
      ]
    })

    // Create workbook + sheet, set sensible column widths
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [
      { wch: 10 }, // Account
      { wch: 7 },  // In/Out
      { wch: 11 }, // Main Ref
      { wch: 9 },  // Sub Ref
      { wch: 12 }, // Date
      { wch: 30 }, // Vendor
      { wch: 30 }, // Description
      { wch: 22 }, // Category
      { wch: 22 }, // Subcategory
      { wch: 11 }, // Amount
      { wch: 10 }, // Status
      { wch: 12 }, // Reimbursable
      { wch: 12 }, // Shareholder
      { wch: 8 },  // Linked
      { wch: 8 },  // Source
    ]

    // Format the Amount column as currency (column J = index 9, 1-based row 2+)
    const amountColIdx = 9
    for (let i = 1; i <= rows.length; i++) {
      const cellRef = XLSX.utils.encode_cell({ c: amountColIdx, r: i })
      if (ws[cellRef]) ws[cellRef].z = '#,##0.00'
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Expenses')

    // Filename: e.g. "RabonaHoldings_Expenses_2026-01.xlsx"
    const safeCompany = (selectedCompany || 'Company').replace(/\s+/g, '')
    const periodTag = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
    XLSX.writeFile(wb, `${safeCompany}_Expenses_${periodTag}.xlsx`)
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
    loadAll({ silent: true })
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
    loadAll({ silent: true })
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
      // Show the counterpart's ref so reconciliation is at-a-glance.
      // For inter-company: show counterpart's company name. For intra-company
      // (account-to-account within same company): show counterpart's account name.
      const cp = counterpartMap.get(e.linked_expense_id)
      let label = '🔗 Linked'
      let title = 'Linked to a counterpart expense'
      if (cp) {
        if (cp.is_intra) {
          label = `🔗 ${cp.reference_number} (${cp.account_name || 'Other account'})`
          title = `Account-to-account link to ${cp.account_name || 'another account'} expense ${cp.reference_number}`
        } else {
          label = `🔗 ${cp.reference_number} (${cp.company_name})`
          title = `Inter-company link to ${cp.company_name} expense ${cp.reference_number}`
        }
      }
      chips.push(
        <span key="lk" className="flag-chip linked" title={title}>
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
  // Period label for the print letterhead (e.g. "01/2026")
  const monthLabel = `${String(selectedMonth).padStart(2, '0')}/${selectedYear}`

  return (
    <div className="view-expenses">
      {/* Unified letterhead — shows on screen AND in print (text left / logo right). */}
      <PrintLetterhead
        companyName={selectedCompany}
        reportTitle="Expenses Report"
        periodLabel={`Period: ${monthLabel}`}
      />

      {/* Action Bar: Print + Export */}
      <div className="action-bar">
        <button className="toolbar-btn primary" onClick={handlePrint}>
          🖨️ Print
        </button>
        <button className="toolbar-btn" onClick={handleExportExcel}>
          📊 Export Excel
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
                <tr key={e.id} className={getRowClassName(e)} data-expense-id={e.id}>
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
                            // Bank-imported → open Re-categorize modal (FinalizeTransaction in edit mode)
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
                            // Manual cash expense → open the dedicated edit modal
                            setEditingManual(e)
                          }
                        }}
                      >✏️</button>
                      {/* Transfer-link button — shows on rows in the linkable categories.
                          The modal auto-detects the mode (inter-company vs intra-company)
                          based on the row's category and shows the right candidates:
                            - Transfers to Connected Accounts / Intercompany Funding → other company
                            - Movement Between Accounts → other account in same company */}
                      {LINKABLE_CATEGORIES.has(e.expense_categories?.name) && (
                        <button
                          className="action-btn"
                          title={e.linked_expense_id ? 'Manage transfer link' : 'Link to counterpart'}
                          onClick={() => setLinkingExpense(e)}
                        >🔗</button>
                      )}
                      <button
                        className="action-btn danger"
                        title={e.bank_transaction_id ? 'Bank-imported: delete in Bank Parser' : 'Delete'}
                        disabled={!!e.bank_transaction_id}
                        onClick={() => handleDelete(e)}
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
          onSave={() => loadAll({ silent: true })}
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
          onSaved={() => loadAll({ silent: true })}
        />
      )}

      {/* Edit modal for MANUAL (non-bank-imported) expenses. Opens when ✏️ is
          clicked on a row that has no bank_transaction_id. Bank-imported rows
          go through the Re-categorize / FinalizeTransaction modal instead. */}
      {editingManual && (
        <EditManualExpenseModal
          expense={editingManual}
          onClose={() => setEditingManual(null)}
          onSaved={(updatedRow) => {
            // Update only the edited row in place so the table doesn't
            // re-render from scratch and the scroll position stays put
            // on the row the user just finished editing.
            // If the modal couldn't refetch the row (rare), fall back
            // to a full reload so we don't end up with stale data.
            if (updatedRow) {
              setExpenses(prev => prev.map(e => e.id === updatedRow.id ? updatedRow : e))
            } else {
              loadAll({ silent: true })
            }
          }}
        />
      )}
    </div>
  )
}
