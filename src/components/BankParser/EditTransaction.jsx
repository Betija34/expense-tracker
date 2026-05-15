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

  // Amount is always displayed/edited as POSITIVE in the form. The SIGN is
  // derived from transaction_type at save time: credit → +amount, debit → -amount.
  const [formData, setFormData] = useState({
    amount:             Math.abs(Number(transaction.amount) || 0),
    transaction_date:   isoToDisplay(transaction.transaction_date),
    description:        transaction.description,
    transaction_type:   transaction.transaction_type || 'debit',  // 'credit' = in, 'debit' = out
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Lock direction editing for already-finalized transactions — flipping the
  // direction would leave the linked expense pointing at the old direction's
  // category, creating inconsistent data. The user should use Re-categorize
  // (or delete the expense first) for matched rows.
  const directionLocked = transaction.status === 'matched'

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

      // Apply the direction's sign convention: credit → positive, debit → negative.
      // Math.abs guards against an already-signed value being entered.
      const positiveAmount = Math.abs(formData.amount)
      const signedAmount = formData.transaction_type === 'credit'
        ? positiveAmount
        : -positiveAmount

      const { error: updateError } = await supabase
        .from('bank_transactions')
        .update({
          amount: signedAmount,
          transaction_date: isoDate,
          description: formData.description,
          transaction_type: formData.transaction_type,
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
            <label>Direction {directionLocked && <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>(locked — already finalized)</span>}</label>
            <select
              name="transaction_type"
              value={formData.transaction_type}
              onChange={handleChange}
              className="form-input"
              disabled={directionLocked}
            >
              <option value="debit">➖ Outgoing (Debit)</option>
              <option value="credit">➕ Incoming (Credit)</option>
            </select>
            {!directionLocked && (
              <small style={{ color: '#6b7280', fontSize: 12, marginTop: 4, display: 'block' }}>
                Flip this if the OCR captured the wrong direction.
              </small>
            )}
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
