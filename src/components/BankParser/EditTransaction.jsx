import { useState, useEffect, useRef } from 'react'
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

  // Original status, used to detect a Finalized → Pending transition on save.
  // bank_transactions.status values: 'unmatched', 'matched', 'pending_review'.
  // We treat 'matched' as "Finalized" and anything else as "Pending".
  const wasMatched = transaction.status === 'matched'

  // Amount is always displayed/edited as POSITIVE in the form. The SIGN is
  // derived from transaction_type at save time: credit → +amount, debit → -amount.
  const [formData, setFormData] = useState({
    amount:             Math.abs(Number(transaction.amount) || 0),
    transaction_date:   isoToDisplay(transaction.transaction_date),
    description:        transaction.description,
    transaction_type:   transaction.transaction_type || 'debit',  // 'credit' = in, 'debit' = out
    // Status dropdown — only relevant when the row is currently Finalized.
    // Picking 'pending' here means "un-finalize this row" (deletes linked
    // expense rows on save). For currently-pending rows the field is
    // read-only and the dropdown isn't shown.
    status:             wasMatched ? 'matched' : 'pending',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Synchronous re-entry guard for handleSave — prevents double-click from
  // firing two parallel save flows (which could collide on the un-finalize
  // DELETE). useRef updates synchronously, unlike setState.
  const isSavingRef = useRef(false)

  // Defensive reset whenever the modal opens for a new transaction. Prevents
  // a previous failed save from leaving loading=true forever, which is what
  // happened on 2026-05-27 (Save Changes button was stuck disabled and
  // Betija had to fall back to SQL to un-finalize a triple-saved bank tx).
  useEffect(() => {
    setLoading(false)
    setError(null)
    isSavingRef.current = false
  }, [transaction?.id])

  // Convenience flags driven by current form state vs the persisted state.
  const directionChanged = formData.transaction_type !== transaction.transaction_type
  const willUnfinalize   = wasMatched && formData.status === 'pending'

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: name === 'amount' ? parseFloat(value) || 0 : value
    }))
  }

  const handleSave = async () => {
    // Re-entry guard — drop the second click silently. Combined with the
    // useEffect reset on transaction.id change above, this makes the stuck-
    // disabled-button scenario impossible.
    if (isSavingRef.current) return
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

    // Confirm destructive un-finalize before touching the DB.
    if (willUnfinalize) {
      const ok = window.confirm(
        'Set status to Pending?\n\n'
        + 'This will DELETE the linked expense entry (and any split portions) '
        + 'tied to this bank transaction. The transaction itself stays imported '
        + "but goes back to the Pending list so you can Finalize it again.\n\n"
        + 'Continue?'
      )
      if (!ok) return
    }

    try {
      isSavingRef.current = true
      setLoading(true)
      setError(null)

      const isoDate = displayToIso(formData.transaction_date)

      // Apply the direction's sign convention: credit → positive, debit → negative.
      // Math.abs guards against an already-signed value being entered.
      const positiveAmount = Math.abs(formData.amount)
      const signedAmount = formData.transaction_type === 'credit'
        ? positiveAmount
        : -positiveAmount

      // -----------------------------------------------------------------
      // 1) Un-finalize path: delete linked expense rows + counterpart links
      // -----------------------------------------------------------------
      // ORDER MATTERS:
      //   a. Find all expenses tied to this bank_tx
      //   b. NULL bank_transactions.matched_expense_id (else the FK
      //      blocks the delete in step (d)). Same step also flips
      //      status to 'unmatched' so the row goes back to Pending.
      //   c. NULL counterpart linked_expense_id on inter-company pairs
      //   d. DELETE the expense rows
      // Without (b) running BEFORE (d), Postgres rejects the delete
      // when matched_expense_id is RESTRICT-ed — which is exactly the
      // case that's been blocking the save when there are 3 duplicate
      // expenses linked to one bank tx (the matched_expense_id points
      // at one of them).
      if (willUnfinalize) {
        // (a) Find every expense tied to this bank transaction. Single-line
        // saves produce one row; split saves produce N rows that all share
        // bank_transaction_id. Both cases are handled here.
        const { data: linkedExpenses, error: lookupErr } = await supabase
          .from('expenses')
          .select('id, linked_expense_id')
          .eq('bank_transaction_id', transaction.id)
        if (lookupErr) throw lookupErr

        if (linkedExpenses && linkedExpenses.length > 0) {
          // (b) Clear matched_expense_id + flip status FIRST so the FK
          // doesn't block the expense DELETE below. The full bank_tx
          // update (amount/date/description) still runs at step 3, but
          // doing the status + matched_expense_id reset here is the
          // unblock that makes the delete legal.
          const { error: preErr } = await supabase
            .from('bank_transactions')
            .update({
              matched_expense_id: null,
              status:             'unmatched',
              updated_at:         new Date().toISOString(),
            })
            .eq('id', transaction.id)
          if (preErr) throw preErr

          const expIds = linkedExpenses.map(e => e.id)

          // (c1) Break BIDIRECTIONAL inter-company links — null linked_expense_id
          // on counterparts the OUR rows point to, AND on rows that point AT ours.
          const counterpartIds = linkedExpenses
            .map(e => e.linked_expense_id)
            .filter(Boolean)
          if (counterpartIds.length > 0) {
            const { error: unlinkErr } = await supabase
              .from('expenses')
              .update({ linked_expense_id: null, updated_at: new Date().toISOString() })
              .in('id', counterpartIds)
            if (unlinkErr) throw unlinkErr
          }
          // Reverse direction — other expenses (in either company) whose
          // linked_expense_id points at one of OUR rows. Common case if the
          // duplicates auto-created Espargos legs (V16 symmetric on-behalf).
          const { error: revUnlinkErr } = await supabase
            .from('expenses')
            .update({ linked_expense_id: null, updated_at: new Date().toISOString() })
            .in('linked_expense_id', expIds)
          if (revUnlinkErr) throw revUnlinkErr

          // (c2) Clear any invoice rows that auto-linked to one of these
          // expenses on finalize (task #50 — Bank Parser auto-marks invoice
          // paid). If invoices.matched_expense_id has a RESTRICT FK, the
          // delete below would block without this. We swallow the error if
          // the column doesn't exist on this DB.
          const { error: invClearErr } = await supabase
            .from('invoices')
            .update({ matched_expense_id: null, date_paid: null, status: 'pending', updated_at: new Date().toISOString() })
            .in('matched_expense_id', expIds)
          if (invClearErr && invClearErr.code !== 'PGRST204') {
            // PGRST204 = column not found — fine, skip. Anything else, surface it.
            console.warn('Invoice unlink:', invClearErr)
          }

          // (c3) Clear any expense_deferrals rows pointing at our expenses.
          // Same swallow-on-missing-table pattern.
          const { error: defErr } = await supabase
            .from('expense_deferrals')
            .delete()
            .in('expense_id', expIds)
          if (defErr && defErr.code !== '42P01') {
            // 42P01 = relation does not exist; skip.
            console.warn('Deferrals clear:', defErr)
          }

          // (d) Delete the expense rows.
          const { error: delErr } = await supabase
            .from('expenses')
            .delete()
            .in('id', expIds)
          if (delErr) throw delErr
        }
      }

      // -----------------------------------------------------------------
      // 2) Direction-change mirror: keep linked expense(s) in sync
      // -----------------------------------------------------------------
      // Only runs if we're NOT un-finalizing (in that case the expense rows
      // are already gone) AND the user actually flipped the direction.
      if (!willUnfinalize && wasMatched && directionChanged) {
        const newDirection = formData.transaction_type === 'credit' ? 'in' : 'out'
        const newExpenseType = newDirection === 'in' ? 'income' : 'regular'
        const { error: mirrorErr } = await supabase
          .from('expenses')
          .update({
            direction:    newDirection,
            expense_type: newExpenseType,
            updated_at:   new Date().toISOString(),
          })
          .eq('bank_transaction_id', transaction.id)
        if (mirrorErr) throw mirrorErr
      }

      // -----------------------------------------------------------------
      // 3) Update the bank_transaction row itself
      // -----------------------------------------------------------------
      const nextStatus           = willUnfinalize ? 'unmatched'   : transaction.status
      const nextMatchedExpenseId = willUnfinalize ? null          : transaction.matched_expense_id
      const { error: updateError } = await supabase
        .from('bank_transactions')
        .update({
          amount:              signedAmount,
          transaction_date:    isoDate,
          description:         formData.description,
          transaction_type:    formData.transaction_type,
          status:              nextStatus,
          matched_expense_id:  nextMatchedExpenseId,
          updated_at:          new Date().toISOString(),
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
      isSavingRef.current = false
    }
  }

  // Shared inline styles for the small warning notes under the editable
  // Direction / Status fields. Keeps the JSX scannable.
  const warnStyle = {
    marginTop: 6, padding: '6px 8px',
    background: '#fef3c7', border: '1px solid #fcd34d',
    borderRadius: 4, fontSize: 12, color: '#92400e',
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

          {/* Direction — always editable now. If the row is already finalized
              and direction is flipped, the linked expense(s) get their
              direction + expense_type updated to match on save. The picked
              category may no longer make sense, so a warning is shown. */}
          <div className="form-group">
            <label>Direction</label>
            <select
              name="transaction_type"
              value={formData.transaction_type}
              onChange={handleChange}
              className="form-input"
            >
              <option value="debit">➖ Outgoing (Debit)</option>
              <option value="credit">➕ Incoming (Credit)</option>
            </select>
            {!wasMatched && (
              <small style={{ color: '#6b7280', fontSize: 12, marginTop: 4, display: 'block' }}>
                Flip this if the OCR captured the wrong direction.
              </small>
            )}
            {wasMatched && directionChanged && !willUnfinalize && (
              <div style={warnStyle}>
                ⚠️ The linked expense entry will also flip to{' '}
                <strong>{formData.transaction_type === 'credit' ? 'Incoming' : 'Outgoing'}</strong>{' '}
                on save. The current category may no longer apply — re-check it
                via the Re-categorize (✏️) modal afterwards.
              </div>
            )}
          </div>

          {/* Status — editable when currently Finalized (lets the user
              un-finalize without going to View Expenses + delete). When
              currently Pending the field is read-only and the dropdown is
              hidden; use the main "Finalize" button to create the expense. */}
          <div className="form-group">
            <label>Status</label>
            {wasMatched ? (
              <>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="form-input"
                >
                  <option value="matched">Finalized</option>
                  <option value="pending">Pending (un-finalize)</option>
                </select>
                {willUnfinalize && (
                  <div style={warnStyle}>
                    ⚠️ Setting status to Pending will <strong>delete the linked
                    expense entry</strong> (and any split portions). The bank
                    transaction stays imported and goes back to the Pending list.
                  </div>
                )}
              </>
            ) : (
              <input
                type="text"
                value="Pending"
                className="form-input"
                disabled
                readOnly
              />
            )}
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
