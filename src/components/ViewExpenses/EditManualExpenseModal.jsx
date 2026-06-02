import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../../supabaseClient'
import { MonthMultiSelect } from '../MonthMultiSelect/MonthMultiSelect'
import { canonicalizeClientName } from '../../lib/clientNameUtils'

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

// Client dropdown options are now loaded dynamically from the clients
// table for the expense's company — single source of truth (the Clients
// tab). "Other" is always appended as the free-text fallback.
// See the useEffect below that populates `dbClients`.

export function EditManualExpenseModal({ expense, onClose, onSaved, selectedCompany }) {
  const [categories, setCategories] = useState([])
  const [allSubcategories, setAllSubcategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // Synchronous re-entry guard (same pattern as FinalizeTransaction +
  // EditTransaction) — prevents double-click from firing two parallel
  // save flows. useRef updates synchronously, before React re-renders
  // the button as disabled.
  const isSavingRef = useRef(false)
  const [error, setError] = useState(null)
  // Client dropdown options for the company that owns this expense.
  // Loaded from the clients table (see useEffect further below).
  const [dbClients, setDbClients] = useState([])
  const PREDEFINED_CLIENTS = useMemo(
    () => [...dbClients, 'Other'],
    [dbClients]
  )

  // Pre-fill form from the expense being edited.
  // Fallbacks: if the FK column is null but the join brought back a parent
  // row, use that. Defensive for old rows that may have inconsistent data.
  const initialCategoryId =
    expense.category_id ||
    expense.expense_categories?.id ||
    ''
  // Initial client UI state: if the existing client_name matches a row in
  // the clients table for this company, pre-select it; otherwise fall back
  // to "Other" + custom text so the existing value isn't lost.
  // (Note: PREDEFINED_CLIENTS may be empty on first render before dbClients
  // loads — that's fine; the existing client_name still renders correctly
  // as "Other" + custom_client_name until the load completes and the
  // useEffect below re-syncs the form.)
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
    category_id:       initialCategoryId,
    subcategory_id:    expense.subcategory_id || '',
    subcategory_name:  expense.subcategory_name || '',
    shareholder_code:  expense.shareholder_code || '',
    is_reimbursable:   !!expense.is_reimbursable,
    client_name:       initialClient,
    custom_client_name: initialCustomClient,
    // Future-trip note — comma-separated list of YYYY-MM tokens.
    // Display-only badge in the Travel Log. Blank = no note.
    expected_travel_month: expense.expected_travel_month || '',
  })

  // Load ALL categories + subcategories.
  // We don't filter by direction here so any expense's saved category is
  // always present in the dropdown (otherwise the select shows blank and
  // the user has to re-pick something that was already correct).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true); setError(null)
        const { data: cats, error: catErr } = await supabase
          .from('expense_categories')
          .select('id, name, direction, needs_shareholder_tag, sub_ref_series, sub_ref_manual, sort_order')
          .order('sort_order')
        if (catErr) throw catErr
        if (cancelled) return
        setCategories(cats || [])

        const { data: subs, error: subErr } = await supabase
          .from('expense_subcategories')
          .select('id, name, category_id, sort_order')
          .order('sort_order')
        if (subErr) throw subErr
        if (!cancelled) setAllSubcategories(subs || [])

        // Load this expense's company-specific client list (V19 clients
        // table). Used to populate the "Client / Project" dropdown when
        // is_reimbursable is on.
        if (expense.company_id) {
          const { data: clientRows, error: clientsErr } = await supabase
            .from('clients')
            .select('trade_name')
            .eq('company_id', expense.company_id)
            .eq('active', true)
            .order('trade_name')
          if (clientsErr) throw clientsErr
          if (!cancelled) {
            setDbClients((clientRows || []).map(r => r.trade_name).filter(Boolean))
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load categories')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Once subcategories are loaded, recover subcategory_id when an older row
  // saved only subcategory_name. This way the dropdown reflects the saved
  // value instead of appearing blank.
  useEffect(() => {
    if (loading) return
    if (form.subcategory_id) return                   // already set — nothing to do
    if (!form.subcategory_name) return                // no name to match
    if (!form.category_id) return                     // need category to scope match
    const match = allSubcategories.find(
      s => s.category_id === form.category_id && s.name === form.subcategory_name
    )
    if (match) {
      setForm(f => ({ ...f, subcategory_id: match.id }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, allSubcategories])

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
    if (isSavingRef.current) return  // re-entry guard
    try {
      isSavingRef.current = true
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

      // Canonicalize the client name (existing client → canonical spelling;
      // new name → confirm-to-create flow). Uses expense.company_id since
      // we're editing a specific expense — guaranteed to be the right
      // company even if the parent's selectedCompany somehow drifted.
      let resolvedClient = null
      if (form.is_reimbursable) {
        if (form.client_name === 'Other') {
          resolvedClient = await canonicalizeClientName(supabase, {
            companyId:   expense.company_id,
            companyName: selectedCompany || 'this company',
            rawName:     form.custom_client_name?.trim(),
          })
        } else {
          resolvedClient = form.client_name
        }
      }

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
        // Future-trip note (comma-separated YYYY-MM list, or null).
        expected_travel_month: form.expected_travel_month || null,
        updated_at:         new Date().toISOString(),
      }

      const { error: updErr } = await supabase
        .from('expenses')
        .update(updateRow)
        .eq('id', expense.id)
      if (updErr) throw updErr

      // Refetch the updated row WITH joins so the parent can swap it
      // into its `expenses` array in place — no full reload, no scroll
      // jump. Falls back to a plain reload signal if the refetch fails.
      let updatedRow = null
      try {
        const { data, error: fetchErr } = await supabase
          .from('expenses')
          .select(`
            *,
            accounts (id, name, account_type),
            expense_categories (id, name, direction)
          `)
          .eq('id', expense.id)
          .single()
        if (!fetchErr) updatedRow = data
      } catch (_e) {
        // Swallow — we'll signal a reload below
      }

      if (onSaved) onSaved(updatedRow)
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to save changes')
    } finally {
      setSaving(false)
      isSavingRef.current = false
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

              {/* Shareholder picker — REQUIRED only for Personal Expenses of
                  Shareholders. Travel Expenses do NOT show a picker here:
                  traveler assignment lives in the Travel Log's inline
                  → YK / → BK / Clear buttons. */}
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

              {/* Expected Travel Month(s) — only for Travel Expenses.
                  Display-only badges; supports multiple months (e.g. a
                  deposit covering Jan + Feb 2027). */}
              {selectedCategory?.sub_ref_series === 'T' && (
                <div className="form-group">
                  <label>
                    Expected Travel Month(s) <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>(optional — pick one or more future months this payment is for; shows as badges on the Travel Log row)</span>
                  </label>
                  <MonthMultiSelect
                    value={form.expected_travel_month}
                    onChange={(v) => setForm({ ...form, expected_travel_month: v })}
                  />
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
