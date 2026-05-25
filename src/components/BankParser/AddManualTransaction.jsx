import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import './BankParser.css'

// =====================================================================
// AddManualTransaction modal
// ---------------------------------------------------------------------
// Lets the user manually add a single bank_transactions row to a
// specific bank_imports file. Use when the PDF parser missed a line
// from the bank statement — the user can spot it (totals don't match,
// or a known transfer is absent) and add it by hand.
//
// The new row inherits company_id, account_id, and bank_import_id from
// the chosen file, so:
//   • it appears in the Parsed Transactions table indistinguishable
//     from auto-parsed rows
//   • deleting the parent file via the existing file-delete flow
//     cascades and removes this manual row too (FK ON DELETE CASCADE
//     already in place on bank_transactions.bank_import_id)
//   • the live transaction count on the file row updates automatically
//     (UploadedFiles reads the count via a bank_transactions(count) join)
//
// Props:
//   importRow       — the bank_imports row this transaction belongs to
//                     (must have id, company_id, account_id, file_name)
//   onClose         — called when modal should close (cancel or success)
//   onSave          — called after a successful INSERT so the parent
//                     can bump its refreshTrigger
// =====================================================================
export function AddManualTransaction({ importRow, onClose, onSave }) {
  const [form, setForm] = useState({
    transaction_date: '',
    description:      '',
    amount:           '',
    transaction_type: 'debit',   // default to outgoing — matches the
                                 // typical "missing expense" case more
                                 // often than a missing income.
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState(null)

  const handleSave = async () => {
    setError(null)

    // ---- Validation ----
    if (!form.transaction_date) { setError('Date is required'); return }
    if (!form.description.trim()) { setError('Description is required'); return }
    const amt = parseFloat(form.amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Amount must be a positive number (sign is set by Type below)')
      return
    }
    if (!['debit', 'credit'].includes(form.transaction_type)) {
      setError('Type must be Debit (out) or Credit (in)'); return
    }
    if (!importRow?.id || !importRow?.company_id || !importRow?.account_id) {
      setError('Internal error: missing import row context'); return
    }

    try {
      setSaving(true)

      // Amount sign convention: bank_transactions stores POSITIVE amounts
      // and uses transaction_type to indicate direction. This matches the
      // existing parser's convention; FinalizeTransaction reads abs(amount)
      // and looks at transaction_type to decide direction.
      const { error: insertErr } = await supabase
        .from('bank_transactions')
        .insert([{
          bank_import_id:   importRow.id,
          company_id:       importRow.company_id,
          account_id:       importRow.account_id,
          transaction_date: form.transaction_date,
          description:      form.description.trim(),
          amount:           Math.abs(amt),
          transaction_type: form.transaction_type,
          status:           'unmatched',
        }])
      if (insertErr) throw insertErr

      // Bump the file's stored transaction_count snapshot too, so the
      // value stays accurate if anything ever reads it directly instead
      // of via the live count join. Best-effort: don't fail the whole
      // save if this errors.
      try {
        const nextCount = (importRow.live_transaction_count || 0) + 1
        await supabase
          .from('bank_imports')
          .update({
            transaction_count: nextCount,
            updated_at:        new Date().toISOString(),
          })
          .eq('id', importRow.id)
      } catch (e) {
        console.warn('Could not bump bank_imports.transaction_count:', e)
      }

      onSave && onSave()
      onClose && onClose()
    } catch (e) {
      console.error('Manual add error:', e)
      setError(e.message || 'Failed to add manual transaction')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content edit-transaction-modal" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <h3>Add Missing Transaction</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {error && <div className="message error">{error}</div>}

          {/* Read-only file context — reassures the user which import
              this row will be attached to, and that the account is
              inherited (not picked here). */}
          <div className="form-group">
            <label>Adding to file</label>
            <div style={{
              background: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: 4, padding: 8, fontSize: 13, color: '#374151'
            }}>
              <strong>📄 {importRow.file_name || 'Unnamed import'}</strong>
              <div style={{ marginTop: 4, color: '#6b7280', fontSize: 12 }}>
                Account is inherited from this file. This new row will appear
                in the Parsed Transactions list as <strong>Pending</strong> —
                you'll approve / finalize it the same way as any auto-parsed row.
              </div>
            </div>
          </div>

          <div className="form-group">
            <label>Date *</label>
            <input
              type="date"
              value={form.transaction_date}
              onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>Description / Vendor *</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. SEPA TRANSFER ACME LTD INV 2026-04-012"
              className="form-input"
            />
            <small style={{ color: '#6b7280', fontSize: 12, marginTop: 2, display: 'block' }}>
              Copy the line text from the bank statement so it's easy to spot.
            </small>
          </div>

          <div className="form-group">
            <label>Amount * <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>(positive; direction set below)</span></label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="0.00"
              className="form-input"
            />
          </div>

          <div className="form-group">
            <label>Type *</label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                <input
                  type="radio"
                  name="transaction_type"
                  value="debit"
                  checked={form.transaction_type === 'debit'}
                  onChange={() => setForm({ ...form, transaction_type: 'debit' })}
                />
                <span>➖ Debit (outgoing)</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                <input
                  type="radio"
                  name="transaction_type"
                  value="credit"
                  checked={form.transaction_type === 'credit'}
                  onChange={() => setForm({ ...form, transaction_type: 'credit' })}
                />
                <span>➕ Credit (incoming)</span>
              </label>
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 12 }}>
          <button onClick={onClose} disabled={saving} className="btn-cancel">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-save"
            style={{ background: '#16a34a', color: 'white', borderColor: '#16a34a' }}>
            {saving ? '⏳ Adding…' : '✓ Add Transaction'}
          </button>
        </div>
      </div>
    </div>
  )
}
