import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { EditTransaction } from './EditTransaction'
import './BankParser.css'

export function TransactionTable({ bankImportId, selectedCompany, onStatusChange, refreshTrigger }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedTransactions, setSelectedTransactions] = useState(new Set())
  const [filterStatus, setFilterStatus] = useState('all') // 'all', 'matched', 'unmatched'
  const [editingTransaction, setEditingTransaction] = useState(null)

  useEffect(() => {
    if (bankImportId) {
      loadTransactions()
    }
  }, [bankImportId, refreshTrigger])

  const loadTransactions = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('*, accounts(name)')
        .eq('bank_import_id', bankImportId)
        .order('transaction_date', { ascending: false })

      if (error) throw error
      setTransactions(data || [])
    } catch (err) {
      console.error('Error loading transactions:', err)
    } finally {
      setLoading(false)
    }
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

  // Filter transactions based on selected filter
  const filteredTransactions = transactions.filter(t => {
    if (filterStatus === 'matched') return t.status === 'matched'
    if (filterStatus === 'unmatched') return t.status === 'unmatched'
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
      </div>

      {selectedCount > 0 && (
        <div className="action-buttons">
          <button
            onClick={handleImportSelected}
            className="button"
          >
            ✓ Finalize {selectedCount} Transaction(s)
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
                <th width="60">Edit</th>
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
                  <td>
                    {transaction.status === 'matched' ? '✅ Finalized' : '⏳ Pending'}
                  </td>
                  <td>
                    <button
                      onClick={() => setEditingTransaction(transaction)}
                      className="btn-edit"
                      title="Edit transaction"
                    >
                      ✎
                    </button>
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
    </div>
  )
}
