import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { nextMainRefSeq, buildMainRef } from '../../lib/refUtils'
import { EditTransaction } from './EditTransaction'
import { FinalizeTransaction } from './FinalizeTransaction'
import './BankParser.css'

// Helper: build a [start, nextMonthStart) date range so we can filter
// bank_transactions by transaction_date to scope to the selected period.
function monthRange(month, year) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const nextStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  return { start, nextStart }
}

export function TransactionTable({ selectedCompany, selectedMonth, selectedYear, onStatusChange, refreshTrigger }) {
  const [transactions, setTransactions] = useState([])
  const [companyId, setCompanyId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [selectedTransactions, setSelectedTransactions] = useState(new Set())
  const [filterStatus, setFilterStatus] = useState('all') // 'all', 'matched', 'unmatched'
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [finalizingTransaction, setFinalizingTransaction] = useState(null)
  const [recategorizing, setRecategorizing] = useState(null) // { transaction, expense }
  const [expensesMap, setExpensesMap] = useState(new Map()) // bank_tx_id → [linked expenses]
  const [uncategorizedIds, setUncategorizedIds] = useState({ out: null, in: null })
  const [bulkApproving, setBulkApproving] = useState(false)

  // Load the Uncategorized category ids once (for the Bulk Approve workflow)
  useEffect(() => {
    const loadUncategorized = async () => {
      const { data, error } = await supabase
        .from('expense_categories')
        .select('id, name, direction')
        .in('name', ['Uncategorized', 'Uncategorized (in)'])
      if (error) {
        console.error('Failed to load Uncategorized categories:', error)
        return
      }
      const map = { out: null, in: null }
      for (const r of (data || [])) {
        map[r.direction] = r.id
      }
      setUncategorizedIds(map)
    }
    loadUncategorized()
  }, [])

  useEffect(() => {
    if (selectedCompany && selectedMonth && selectedYear) {
      loadTransactions()
    }
  }, [selectedCompany, selectedMonth, selectedYear, refreshTrigger])

  const loadTransactions = async () => {
    try {
      setLoading(true)

      // Get company ID
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('name', selectedCompany)
        .single()

      if (!company) {
        setTransactions([])
        setCompanyId(null)
        setLoading(false)
        return
      }
      setCompanyId(company.id)

      // Query transactions for this company SCOPED TO THE SELECTED MONTH/YEAR.
      // Without this filter, switching the top-bar Month would show transactions
      // from every month (e.g. January transactions visible under May).
      const { start, nextStart } = monthRange(selectedMonth, selectedYear)
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('*, accounts(name)')
        .eq('company_id', company.id)
        .gte('transaction_date', start)
        .lt('transaction_date', nextStart)
        .order('transaction_date', { ascending: false })

      if (error) throw error
      setTransactions(data || [])

      // Also load linked expense refs for finalized transactions
      const finalizedIds = (data || []).filter(t => t.status === 'matched').map(t => t.id)
      if (finalizedIds.length > 0) {
        const { data: expData } = await supabase
          .from('expenses')
          .select(`
            id, bank_transaction_id, reference_number,
            main_ref_seq, sub_ref_series, sub_ref_month, sub_ref_seq,
            split_group_id, category_id,
            expense_categories(name)
          `)
          .in('bank_transaction_id', finalizedIds)
          .order('main_ref_seq')
        const map = new Map()
        for (const e of (expData || [])) {
          if (!map.has(e.bank_transaction_id)) map.set(e.bank_transaction_id, [])
          map.get(e.bank_transaction_id).push(e)
        }
        setExpensesMap(map)
      } else {
        setExpensesMap(new Map())
      }
    } catch (err) {
      console.error('Error loading transactions:', err)
    } finally {
      setLoading(false)
    }
  }

  // Builds a "26/1/4 (T1/2)" style label — sub-ref shown in parens when present
  const formatExpenseRef = (e) => {
    const main = e.reference_number || ''
    if (e.sub_ref_series && e.sub_ref_month && e.sub_ref_seq) {
      return `${main} (${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq})`
    }
    return main
  }

  // True if an expense was bulk-approved with the "Uncategorized" placeholder.
  // Such rows need real categorization (click ↻ to set category).
  const isUncategorized = (e) =>
    e.expense_categories?.name === 'Uncategorized' ||
    e.expense_categories?.name === 'Uncategorized (in)'

  // Renders the status cell for a transaction — for finalized, shows linked expense refs (+ sub-refs if present)
  const renderStatusCell = (transaction) => {
    if (transaction.status !== 'matched') return '⏳ Pending'
    const exps = expensesMap.get(transaction.id) || []
    if (exps.length === 0) return '✅ Finalized'

    const needsCategory = exps.some(isUncategorized)
    const needsCategoryChip = needsCategory && (
      <span style={{
        background: '#fef3c7', color: '#92400e',
        border: '1px solid #fcd34d',
        padding: '1px 6px', borderRadius: 999,
        fontSize: 10, fontWeight: 600,
        marginLeft: 4, whiteSpace: 'nowrap',
      }} title="This expense has a placeholder category — click ↻ to set a real category">
        Needs category
      </span>
    )

    if (exps.length === 1) {
      return (
        <span>
          {needsCategory ? '🟡' : '✅'} Finalized ·{' '}
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#374151' }}>
            {formatExpenseRef(exps[0])}
          </span>
          {needsCategoryChip}
        </span>
      )
    }
    const refs = exps.map(formatExpenseRef).join(', ')
    return (
      <span title={`Linked to: ${refs}`}>
        {needsCategory ? '🟡' : '✅'} Split into {exps.length} ·{' '}
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#374151' }}>
          {refs}
        </span>
        {needsCategoryChip}
      </span>
    )
  }

  const getAccountAbbreviation = (accountName) => {
    if (!accountName) return '—'
    if (accountName.includes('Mastercard')) return 'RMC'
    if (accountName.includes('Current')) return 'RCC'
    return '—'
  }

  const getRowClassName = (transaction) => {
    const isIncoming = transaction.transaction_type === 'credit'
    const accountName = transaction.accounts?.name || ''
    const isMastercard = accountName.includes('Mastercard')

    if (isMastercard) {
      return isIncoming ? 'row-rmc-incoming' : 'row-rmc-outgoing'
    } else {
      return isIncoming ? 'row-rcc-incoming' : 'row-rcc-outgoing'
    }
  }

  const toggleTransaction = (id) => {
    const newSelected = new Set(selectedTransactions)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedTransactions(newSelected)
  }

  // Bulk Approve — verifies imported data is correct and creates expense rows
  // with category = "Uncategorized" for each selected unmatched bank tx.
  // The user then categorizes each one later via the ↻ Re-categorize button.
  const handleBulkApprove = async () => {
    const selected = transactions.filter(
      t => selectedTransactions.has(t.id) && t.status === 'unmatched'
    )
    if (selected.length === 0) {
      alert('No unmatched transactions selected.')
      return
    }
    if (!uncategorizedIds.out || !uncategorizedIds.in) {
      alert('"Uncategorized" categories not found. Did you run the V7 migration?')
      return
    }
    if (!window.confirm(
      `Approve ${selected.length} bank transaction${selected.length === 1 ? '' : 's'}?\n\n` +
      `Each will be marked Uncategorized (data verified). You can categorize them later ` +
      `using the ↻ Re-categorize button on each row.`
    )) return

    setBulkApproving(true)
    let okCount = 0, errCount = 0

    try {
      for (const tx of selected) {
        try {
          const direction = tx.transaction_type === 'credit' ? 'in' : 'out'
          const categoryId = uncategorizedIds[direction]
          const [y, m] = tx.transaction_date.split('-').map(Number)
          const mainSeq = await nextMainRefSeq(companyId, y, m)
          // Company-aware reference: "26/1/4" for Rabona, "E26/1/4" for Espargos.
          const referenceNumber = buildMainRef(y, m, mainSeq, selectedCompany)

          const { data: inserted, error: insertErr } = await supabase
            .from('expenses')
            .insert([{
              company_id:        companyId,
              category_id:       categoryId,
              account_id:        tx.account_id,
              date:              tx.transaction_date,
              amount:            Math.abs(Number(tx.amount || 0)),
              currency:          'EUR',
              description:       null,
              vendor:            tx.description,
              reference_number:  referenceNumber,
              expense_type:      direction === 'out' ? 'regular' : 'income',
              direction,
              main_ref_year:     y,
              main_ref_month:    m,
              main_ref_seq:      mainSeq,
              bank_transaction_id: tx.id,
              status:            'pending',
            }])
            .select('id')
            .single()
          if (insertErr) throw insertErr

          const { error: updErr } = await supabase
            .from('bank_transactions')
            .update({
              status: 'matched',
              matched_expense_id: inserted.id,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.id)
          if (updErr) throw updErr

          okCount++
        } catch (e) {
          console.error('Bulk approve row error for tx', tx.id, e)
          errCount++
        }
      }

      if (errCount === 0) {
        alert(`✓ Approved ${okCount} transaction${okCount === 1 ? '' : 's'}. Click ↻ on each row to set the category.`)
      } else {
        alert(`Approved ${okCount} of ${selected.length}. ${errCount} failed — check console for details.`)
      }

      setSelectedTransactions(new Set())
      loadTransactions()
      if (onStatusChange) onStatusChange()
    } finally {
      setBulkApproving(false)
    }
  }

  const handleImportSelected = async () => {
    if (selectedTransactions.size === 0) {
      alert('Please select at least one transaction')
      return
    }

    try {
      // Update selected transactions status to 'matched'
      const transactionsToImport = transactions.filter(t =>
        selectedTransactions.has(t.id)
      )

      for (const transaction of transactionsToImport) {
        await supabase
          .from('bank_transactions')
          .update({ status: 'matched' })
          .eq('id', transaction.id)
      }

      alert(`${transactionsToImport.length} transaction(s) finalized`)
      loadTransactions()
      setSelectedTransactions(new Set())

      // Trigger parent callback to refresh stats
      if (onStatusChange) {
        onStatusChange()
      }
    } catch (err) {
      console.error('Error finalizing transactions:', err)
      alert('Error finalizing transactions')
    }
  }

  if (loading) {
    return <div className="loading">Loading transactions...</div>
  }

  if (transactions.length === 0) {
    return (
      <div className="empty-state">
        <p>No transactions imported yet</p>
      </div>
    )
  }

  const selectedCount = selectedTransactions.size
  const importedCount = transactions.filter(t => t.status === 'matched').length
  const unmatchedCount = transactions.filter(t => t.status === 'unmatched').length

  // Count of finalized transactions whose linked expense is still "Uncategorized"
  const needsCategoryCount = transactions.filter(t => {
    if (t.status !== 'matched') return false
    const exps = expensesMap.get(t.id) || []
    return exps.some(isUncategorized)
  }).length

  // Filter transactions based on selected filter
  const filteredTransactions = transactions.filter(t => {
    if (filterStatus === 'matched') return t.status === 'matched'
    if (filterStatus === 'unmatched') return t.status === 'unmatched'
    if (filterStatus === 'needs-category') {
      if (t.status !== 'matched') return false
      const exps = expensesMap.get(t.id) || []
      return exps.some(isUncategorized)
    }
    return true
  })

  return (
    <div className="transaction-section">
      <div className="transaction-header">
        <h3>Parsed Transactions</h3>
        <div className="transaction-stats">
          <span>Total: {transactions.length}</span>
          <span>Selected: {selectedCount}</span>
          <span>Finalized: {importedCount}</span>
          {needsCategoryCount > 0 && (
            <span style={{ color: '#92400e', fontWeight: 600 }}>
              Needs category: {needsCategoryCount}
            </span>
          )}
        </div>
      </div>

      {/* Filter buttons */}
      <div className="filter-group">
        <button
          className={`filter-btn ${filterStatus === 'all' ? 'active' : ''}`}
          onClick={() => setFilterStatus('all')}
        >
          All ({transactions.length})
        </button>
        <button
          className={`filter-btn ${filterStatus === 'unmatched' ? 'active' : ''}`}
          onClick={() => setFilterStatus('unmatched')}
        >
          Pending ({unmatchedCount})
        </button>
        <button
          className={`filter-btn ${filterStatus === 'matched' ? 'active' : ''}`}
          onClick={() => setFilterStatus('matched')}
        >
          Finalized ({importedCount})
        </button>
        {needsCategoryCount > 0 && (
          <button
            className={`filter-btn ${filterStatus === 'needs-category' ? 'active' : ''}`}
            onClick={() => setFilterStatus('needs-category')}
            style={{
              background: filterStatus === 'needs-category' ? '#f59e0b' : '#fef3c7',
              color: filterStatus === 'needs-category' ? 'white' : '#92400e',
              borderColor: '#fcd34d',
              fontWeight: 600,
            }}
            title="Show only finalized rows that still have the Uncategorized placeholder"
          >
            🟡 Needs category ({needsCategoryCount})
          </button>
        )}
      </div>

      {/* Bulk action bar — appears when rows are selected */}
      {selectedCount > 0 && (
        <div className="action-buttons" style={{
          background: '#fef3c7', border: '1px solid #fde68a',
          borderRadius: 4, padding: 10, fontSize: 13, color: '#92400e',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          flexWrap: 'wrap',
        }}>
          <div>
            <strong>{selectedCount} selected.</strong> You can:
            <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
              <li>
                <strong>Bulk Approve</strong> — verify data, create Uncategorized expenses. Categorize each later via ↻.
              </li>
              <li>
                <strong>Finalize per-row</strong> — use the ✓ button on each row to set category at the same time.
              </li>
            </ul>
          </div>
          <button
            onClick={handleBulkApprove}
            disabled={bulkApproving}
            style={{
              background: '#16a34a', color: 'white', border: 'none',
              borderRadius: 4, padding: '8px 16px', fontSize: 13,
              fontWeight: 600, cursor: bulkApproving ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {bulkApproving
              ? '⏳ Approving…'
              : `✓ Bulk Approve ${selectedCount} (Uncategorized)`}
          </button>
        </div>
      )}

      <div className="table-container">
        {filteredTransactions.length === 0 ? (
          <div className="empty-state">
            <p>No transactions match the current filter</p>
          </div>
        ) : (
          <table className="bank-transactions-table">
            <thead>
              <tr>
                <th width="40">
                  <input
                    type="checkbox"
                    checked={selectedCount === filteredTransactions.filter(t => t.status === 'unmatched').length && selectedCount > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const unmatchedIds = filteredTransactions
                          .filter(t => t.status === 'unmatched')
                          .map(t => t.id)
                        setSelectedTransactions(new Set(unmatchedIds))
                      } else {
                        setSelectedTransactions(new Set())
                      }
                    }}
                  />
                </th>
                <th>Account</th>
                <th>Date</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Type</th>
                <th>Status</th>
                <th width="120">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map(transaction => (
                <tr key={transaction.id} className={getRowClassName(transaction)}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedTransactions.has(transaction.id)}
                      onChange={() => toggleTransaction(transaction.id)}
                      disabled={transaction.status !== 'unmatched'}
                    />
                  </td>
                  <td className="account-badge">
                    {getAccountAbbreviation(transaction.accounts?.name)}
                  </td>
                  <td>
                    {(() => {
                      const [year, month, day] = transaction.transaction_date.split('-')
                      return `${day}/${month}/${year}`
                    })()}
                  </td>
                  <td>{transaction.description}</td>
                  <td className={transaction.transaction_type === 'credit' ? 'amount-incoming' : 'amount-outgoing'}>
                    ${Math.abs(transaction.amount).toFixed(2)}
                  </td>
                  <td>{transaction.transaction_type === 'credit' ? '➕ In' : '➖ Out'}</td>
                  <td>{renderStatusCell(transaction)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => setEditingTransaction(transaction)}
                        className="btn-edit"
                        title="Edit transaction details (date / vendor / amount)"
                      >
                        ✎
                      </button>
                      {transaction.status !== 'matched' && (
                        <button
                          onClick={() => setFinalizingTransaction(transaction)}
                          className="btn-edit"
                          title="Finalize & categorize — creates an expense row"
                          style={{ background: '#16a34a', color: 'white', borderColor: '#16a34a' }}
                        >
                          ✓
                        </button>
                      )}
                      {transaction.status === 'matched' && (() => {
                        const exps = expensesMap.get(transaction.id) || []
                        const needsCat = exps.some(isUncategorized)
                        return (
                          <button
                            onClick={async () => {
                              // Fetch the existing expense linked to this transaction
                              const { data: exp, error: expErr } = await supabase
                                .from('expenses')
                                .select('*')
                                .eq('bank_transaction_id', transaction.id)
                                .maybeSingle()
                              if (expErr || !exp) {
                                alert('Could not find the expense linked to this transaction.')
                                return
                              }
                              setRecategorizing({ transaction, expense: exp })
                            }}
                            className="btn-edit"
                            title={needsCat
                              ? '⚠ This expense still has placeholder category — click to set a real one'
                              : 'Re-categorize — edit category, subcategory, reimbursable, etc.'}
                            style={needsCat
                              ? {
                                  background: '#dc2626', color: 'white', borderColor: '#dc2626',
                                  boxShadow: '0 0 0 3px rgba(220, 38, 38, 0.2)',
                                }
                              : { background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }
                            }
                          >
                            ↻
                          </button>
                        )
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingTransaction && (
        <EditTransaction
          transaction={editingTransaction}
          onClose={() => setEditingTransaction(null)}
          onSave={loadTransactions}
        />
      )}

      {finalizingTransaction && companyId && (
        <FinalizeTransaction
          transaction={finalizingTransaction}
          companyId={companyId}
          companyName={selectedCompany}
          onClose={() => setFinalizingTransaction(null)}
          onSave={() => {
            loadTransactions()
            if (onStatusChange) onStatusChange()
          }}
        />
      )}

      {recategorizing && companyId && (
        <FinalizeTransaction
          transaction={recategorizing.transaction}
          companyId={companyId}
          companyName={selectedCompany}
          existingExpense={recategorizing.expense}
          onClose={() => setRecategorizing(null)}
          onSave={() => {
            loadTransactions()
            if (onStatusChange) onStatusChange()
          }}
        />
      )}
    </div>
  )
}
