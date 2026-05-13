import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'

/**
 * EditManualExpenseModal — full-fields edit for a manual (non-bank-imported) expense.
 *
 * Manual expenses are created via Add Expense and have no bank_transaction_id.
 * This modal lets the user update any of the standard fields:
 *   - date, vendor, description, amount
 *   - category + subcategory
 *   - shareholder code (for categories that need shareholder tagging)
 *   - is_reimbursable + client_name
 *
 * Reference number stays the same (changing the date doesn't re-allocate refs).
 * Sub-references are NOT recomputed in v1 (keeps the audit trail stable).
 *
 * If the expense is a portion of a split group, a warning banner explains that
 * edits apply ONLY to this portion — siblings stay unchanged.
 *
 * Props:
 *   expense — the expense row to edit (must include id and all standard fields)
 *   onClose — close without saving
 *   onSaved — saved callback (parent should reload its list)
 */

// Predefined client list — same as AddExpense / FinalizeTransaction
const PREDEFINED_CLIENTS = ['Urban City','Blue Lagoon','Green Field Hotel','Kypseli','BAD City Hall','BAD City SPA Hotel','Evia Mare','Other']

export function EditManualExpenseModal({ expense, onClose, onSaved }) {
  const [categories, setCategories] = useState([])
  const [allSubcategories, setAllSubcategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Pre-fill form from the expense being edited
  const initialClient = expense.client_name && PREDEFINED_CLIENTS.includes(expense.client_name)
    ? expense.client_name
    : (expense.client_name ? 'Other' : '')
  const initialCustomClient = expense.client_name && !PREDEFINED_CLIENTS.includes(expense.client_name)
    ? expense.client_name : ''

  const [form, setForm] = useState({
    date:              expense.date || '',
    vendor:            expense.vendor || '',
    description:       expense.description || '',
    amount:            String(expense.amount || ''),
    category_id:       expense.category_id || '',
    subcategory_id:    expense.subcategory_id || '',
    subcategory_name:  expense.subcategory_name || '',
    shareholder_code:  expense.shareholder_code || '',
    is_reimbursable:   !!expense.is_reimbursable,
    client_name:       initialClient,
    custom_client_name: initialCustomClient,
  })

  // Load categories + subcategories — only direction='out' since manual expenses are outgoing-only
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true); setError(null)
        const { data: cats, error: catErr } = await supabase
          .from('expense_categories')
          .select('id, name, direction, needs_shareholder_tag, sub_ref_series, sub_ref_manual')
          .eq('direction', 'out')
          .order('name')
        if (catErr) throw catErr
        if (cancelled) return
        setCategories(cats || [])

        const { data: subs, error: subErr } = await supabase
          .from('expense_subcategories')
          .select('id, name, category_id')
          .order('name')
        if (subErr) throw subErr
        if (!cancelled) setAllSubcategories(subs || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load categories')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const selectedCategory = useMemo(
    () => categories.find(c => c.id === form.category_id),
    [categories, form.category_id]
  )
  const subcategoriesForCategory = useMemo(
    () => allSubcategories.filter(s => s.category_id === form.category_id),
    [allSubcategories, form.category_id]
  )

  // Format helpers
  const formatDate = (iso) => {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  const handleSubcategoryChange = (newSubcategoryId) => {
    const sub = subcategoriesForCategory.find(s => s.id === newSubcategoryId)
    setForm(f => ({
      ...f,
      subcategory_id: newSubcategoryId,
      subcategory_name: sub ? sub.name : '',
    }))
  }

  const handleSave = async () => {
    try {
      setSaving(true); setError(null)

      // Validation
      if (!form.date) { setError('Date is required'); return }
      if (!form.vendor?.trim()) { setError('Vendor is required'); return }
      const amt = parseFloat(form.amount)
      if (!amt || amt <= 0) { setError('Amount must be greater than 0'); return }
      if (!form.category_id) { setError('Category is required'); return }
      if (subcategoriesForCategory.length > 0 && !form.subcategory_id) {
        setError('Subcategory is required for this category'); return
      }
      if (selectedCategory?.needs_shareholder_tag && !form.shareholder_code) {
        setError('Shareholder is required for this category'); return
      }
      if (form.is_reimbursable) {
        const finalClient = form.client_name === 'Other' ? form.custom_client_name?.trim() : form.client_name
        if (!finalClient) { setError('Client is required when expense is marked reimbursable'); return }
      }

      const resolvedClient = form.is_reimbursable
        ? (form.client_name === 'Other' ? form.custom_client_name?.trim() : form.client_name)
        : null

      // UPDATE — keep the original reference_number and main_ref_seq.
      // We don't re-allocate refs on edit so audit trails stay stable.
      const updateRow = {
        date:               form.date,
        vendor:             form.vendor.trim(),
        description:        form.description?.trim() || null,
        amount:             amt,
        category_id:        form.category_id,
        subcategory_id:     form.subcategory_id || null,
        subcategory_name:   form.subcategory_name || null,
        shareholder_code:   form.shareholder_code || null,
        is_reimbursable:    form.is_reimbursable,
        requires_reimbursement: form.is_reimbursable,
        client_name:        resolvedClient,
        updated_at:         new Date().toISOString(),
      }

      const { error: updErr } = await supabase
        .from('expenses')
        .update(updateRow)
        .eq('id', expense.id)
      if (updErr) throw updErr

      if (onSaved) onSaved()
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  // ----- Render -----
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content edit-manual-expense-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640 }}
      >
        <div className="modal-header">
          <h2>✏️ Edit Expense · {expense.reference_number || '—'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          {/* Split-portion warning */}
          {expense.is_split && expense.split_group_id && (
            <div style={{
              background: '#fef3c7', border: '1px solid #fcd34d',
              borderRadius: 4, padding: 10, marginBottom: 14, fontSize: 13, color: '#92400e',
            }}>
              ⚠ This is one portion of a split group. Edits apply <strong>only to this portion</strong> —
              its siblings stay unchanged.
            </div>
          )}

          {/* Original ref + date context (read-only) */}
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
            Created on {formatDate(expense.date)} as {expense.reference_number}.
            Reference number stays the same after edit.
          </div>

          {error && (
            <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 4, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {loading ? (
            <div style={{ padding: 20, textAlign: 'center' }}>Loading…</div>
          ) : (
            <>
              {/* Date */}
              <div className="form-group">
                <label>Date *</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="form-input"
                />
              </div>

              {/* Vendor */}
              <div className="form-group">
                <label>Vendor *</label>
                <input
                  type="text"
                  value={form.vendor}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                  className="form-input"
                />
              </div>

              {/* Description */}
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="form-input"
                  placeholder="Optional"
                />
              </div>

              {/* Amount */}
              <div className="form-group">
                <label>Amount (€) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="form-input"
                />
              </div>

              {/* Category */}
              <div className="form-group">
                <label>Category *</label>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({
                    ...form,
                    category_id: e.target.value,
                    subcategory_id: '',
                    subcategory_name: '',
                  })}
                  className="form-input"
                >
                  <option value="">— Select category —</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Subcategory (if applicable) */}
              {subcategoriesForCategory.length > 0 && (
                <div className="form-group">
                  <label>Subcategory *</label>
                  <select
                    value={form.subcategory_id}
                    onChange={(e) => handleSubcategoryChange(e.target.value)}
                    className="form-input"
                  >
                    <option value="">— Select subcategory —</option>
                    {subcategoriesForCategory.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Shareholder tag (for categories that need it) */}
              {selectedCategory?.needs_shareholder_tag && (
                <div className="form-group">
                  <label>Shareholder *</label>
                  <select
                    value={form.shareholder_code}
                    onChange={(e) => setForm({ ...form, shareholder_code: e.target.value })}
                    className="form-input"
                  >
                    <option value="">— Select shareholder —</option>
                    <option value="YK">YK</option>
                    <option value="BK">BK</option>
                  </select>
                </div>
              )}

              {/* Reimbursable + Client */}
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={form.is_reimbursable}
                    onChange={(e) => setForm({ ...form, is_reimbursable: e.target.checked })}
                  />
                  Reimbursable (will be billed back to a client)
                </label>
              </div>

              {form.is_reimbursable && (
                <div className="form-group">
                  <label>Client / project *</label>
                  <select
                    value={form.client_name}
                    onChange={(e) => setForm({ ...form, client_name: e.target.value, custom_client_name: '' })}
                    className="form-input"
                  >
                    <option value="">— Select client —</option>
                    {PREDEFINED_CLIENTS.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {form.client_name === 'Other' && (
                    <input
                      type="text"
                      placeholder="Custom client name"
                      value={form.custom_client_name}
                      onChange={(e) => setForm({ ...form, custom_client_name: e.target.value })}
                      className="form-input"
                      style={{ marginTop: 6 }}
                    />
                  )}
                </div>
              )}

              {/* Footer actions */}
              <div style={{
                display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20,
                paddingTop: 16, borderTop: '1px solid #e5e7eb',
              }}>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  style={{
                    padding: '10px 16px', background: 'white', color: '#374151',
                    border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '10px 16px', background: '#2E7D32', color: 'white',
                    border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  {saving ? 'Saving…' : '💾 Save Changes'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
