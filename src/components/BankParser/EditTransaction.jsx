import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import './BankParser.css'

export function EditTransaction({ transaction, onClose, onSave }) {
  // Convert ISO date (YYYY-MM-DD) to DD/MM/YYYY for display
  const isoToDisplay = (isoDate) => {
    if (!isoDate) return ''
    const [year, month, day] = isoDate.split('-')
    return `${day}/${month}/${year}`
  }

  // Convert DD/MM/YYYY to ISO (YYYY-MM-DD) for storage
  // Handles both 1/1/2026 and 01/01/2026 formats
  const displayToIso = (displayDate) => {
    if (!displayDate) return ''
    const [day, month, year] = displayDate.split('/')
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  const [formData, setFormData] = useState({
    amount: transaction.amount,
    transaction_date: isoToDisplay(transaction.transaction_date),
    description: transaction.description
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'amount' ? parseFloat(value) || 0 : value
    }))
  }

  const handleSave = async () => {
    if (!formData.amount || !formData.transaction_date || !formData.description.trim()) {
      setError('All fields are required')
      return
    }

    // Validate date format is DD/MM/YYYY or D/M/YYYY
    const dateRegex = /^\d{1,2}\/\d{1,2}\/\d{4}$/
    if (!dateRegex.test(formData.transaction_date)) {
      setError('Date must be in DD/MM/YYYY format (e.g., 25/01/2026 or 1/1/2026)')
      return
    }

    try {
      setLoading(true)
      setError(null)

      // Convert DD/MM/YYYY to ISO format for storage
      const isoDate = displayToIso(formData.transaction_date)

      const { error: updateError } = await supabase
        .from('bank_transactions')
        .update({
          amount: formData.amount,
          transaction_date: isoDate,
          description: formData.description,
          updated_at: new Date().toISOString()
        })
        .eq('id', transaction.id)

      if (updateError) throw updateError

      onSave()
      onClose()
    } catch (err) {
      console.error('Error saving transaction:', err)
      setError(err.message || 'Failed to save transaction')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content edit-transaction-modal">
        <div className="modal-header">
          <h3>Edit Transaction</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="message error">{error}</div>}

          <div className="form-group">
            <label>Date (DD/MM/YYYY)</label>
            <input
              type="text"
              name="transaction_date"
              value={formData.transaction_date}
              onChange={handleChange}
              className="form-input"
              placeholder="DD/MM/YYYY"
            />
          </div>

          <div className="form-group">
            <label>Vendor / Description</label>
            <input
              type="text"
              name="description"
              value={formData.description}
              onChange={handleChange}
              className="form-input"
              placeholder="Enter vendor name or description"
            />
          </div>

          <div className="form-group">
            <label>Amount</label>
            <input
              type="number"
              name="amount"
              value={formData.amount}
              onChange={handleChange}
              className="form-input"
              step="0.01"
              min="0"
              placeholder="0.00"
            />
          </div>

          <div className="form-group">
            <label>Transaction Type</label>
            <input
              type="text"
              value={transaction.transaction_type === 'credit' ? 'Incoming (Credit)' : 'Outgoing (Debit)'}
              className="form-input"
              disabled
              readOnly
            />
          </div>

          <div className="form-group">
            <label>Status</label>
            <input
              type="text"
              value={transaction.status === 'matched' ? 'Finalized' : 'Pending'}
              className="form-input"
              disabled
              readOnly
            />
          </div>
        </div>

        <div className="modal-footer">
          <button
            onClick={onClose}
            className="btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="button"
            disabled={loading}
          >
            {loading ? '💾 Saving...' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
