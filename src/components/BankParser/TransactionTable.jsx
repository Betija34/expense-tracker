import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import './BankParser.css'

export function TransactionTable({ bankImportId, selectedCompany }) {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedTransactions, setSelectedTransactions] = useState(new Set())

  useEffect(() => {
    if (bankImportId) {
      loadTransactions()
    }
  }, [bankImportId])

  const loadTransactions = async () => {
    try {
      setLoading(true)
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('*')
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
      // Update selected transactions status to 'ready_import'
      const transactionsToImport = transactions.filter(t =>
        selectedTransactions.has(t.id)
      )

      for (const transaction of transactionsToImport) {
        await supabase
          .from('bank_transactions')
          .update({ status: 'matched' })
          .eq('id', transaction.id)
      }

      alert(`${transactionsToImport.length} transaction(s) imported`)
      loadTransactions()
      setSelectedTransactions(new Set())
    } catch (err) {
      console.error('Error importing transactions:', err)
      alert('Error importing transactions')
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

  return (
    <div className="transaction-section">
      <div className="transaction-header">
        <h3>Parsed Transactions</h3>
        <div className="transaction-stats">
          <span>Total: {transactions.length}</span>
          <span>Selected: {selectedCount}</span>
          <span>Imported: {importedCount}</span>
        </div>
      </div>

      {selectedCount > 0 && (
        <button
          onClick={handleImportSelected}
          className="button"
        >
          Import {selectedCount} Transaction(s)
        </button>
      )}

      <div className="table-container">
        <table className="bank-transactions-table">
          <thead>
            <tr>
              <th width="40">
                <input
                  type="checkbox"
                  checked={selectedCount === transactions.filter(t => t.status === 'unmatched').length && selectedCount > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      const unmatchedIds = transactions
                        .filter(t => t.status === 'unmatched')
                        .map(t => t.id)
                      setSelectedTransactions(new Set(unmatchedIds))
                    } else {
                      setSelectedTransactions(new Set())
                    }
                  }}
                />
              </th>
              <th>Date</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(transaction => (
              <tr key={transaction.id} className={`status-${transaction.status}`}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedTransactions.has(transaction.id)}
                    onChange={() => toggleTransaction(transaction.id)}
                    disabled={transaction.status !== 'unmatched'}
                  />
                </td>
                <td>{new Date(transaction.transaction_date).toLocaleDateString()}</td>
                <td>{transaction.description}</td>
                <td className={transaction.transaction_type === 'credit' ? 'amount-incoming' : 'amount-outgoing'}>
                  ${Math.abs(transaction.amount).toFixed(2)}
                </td>
                <td>{transaction.transaction_type === 'credit' ? '➕ In' : '➖ Out'}</td>
                <td>
                  {transaction.status === 'matched' ? '✅ Imported' : '⏳ Pending'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
