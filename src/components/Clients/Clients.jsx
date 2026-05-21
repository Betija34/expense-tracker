import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import './Clients.css'

/**
 * Clients — admin page for the per-company client master list.
 *
 * Step 1 of the Phase 2 Clients & Billing module (#28). Reads/writes
 * the `clients` table seeded by V19. Each row carries the contact info,
 * default monthly fee, VAT treatment, and email defaults that future
 * invoicing steps will use.
 *
 * Scoped to the currently selected company (top bar). Switching the
 * top-bar company instantly switches which client list is shown.
 *
 * UI:
 *   - List table: Trade name · Legal name · Contact · Monthly fee · VAT
 *     · Active · Edit · Delete
 *   - Inline "+ Add client" button opens the Edit modal pre-filled blank
 *   - Edit modal — full set of fields with form validation
 *   - Active toggle on each row (soft-archive without deleting history)
 *   - Delete with confirm (no FK to invoices yet — safe to delete now,
 *     but we'll add a guard once Steps 2/3 ship)
 */

function formatEuro(n) {
  return `€${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Cyprus VAT presets the user can pick from. The dropdown writes the
// decimal value to vat_rate; a custom rate is allowed too via the input.
const VAT_PRESETS = [
  { label: '0% (no VAT)', value: 0 },
  { label: '5% (reduced)', value: 0.05 },
  { label: '9% (reduced)', value: 0.09 },
  { label: '19% (standard Cyprus)', value: 0.19 },
]

// Blank form template for "+ Add client".
const BLANK_FORM = {
  legal_name: '',
  trade_name: '',
  contact_name: '',
  monthly_fee_net: '',
  monthly_fixed_expense_net: '',  // fixed expense reimbursement (V20); 0 = none
  vat_rate: '0',          // stored as string in the form; parsed on save
  email_to: '',
  email_cc: '',
  notes: '',
  active: true,
}

export function Clients({ selectedCompany, selectedMonth, selectedYear }) {
  const [companyId, setCompanyId] = useState(null)
  const [clients, setClients]     = useState([])
  // Per-client reimbursable expense total for the selected month, keyed by
  // normalised name (lowercased trimmed). Source = expenses.client_name
  // (free text) summed where requires_reimbursement=true.
  const [reimbursableByClient, setReimbursableByClient] = useState(new Map())
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  // editing = null (closed) | { mode: 'add' | 'edit', client: {...} }
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(BLANK_FORM)
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving]       = useState(false)

  // ---- Loader ----
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true); setError(null)
        const { data: comp, error: compErr } = await supabase
          .from('companies').select('id').eq('name', selectedCompany).maybeSingle()
        if (compErr) throw compErr
        if (!comp) throw new Error(`Company "${selectedCompany}" not found.`)
        if (cancelled) return
        setCompanyId(comp.id)

        const { data: cl, error: clErr } = await supabase
          .from('clients')
          .select('*')
          .eq('company_id', comp.id)
          .order('trade_name', { ascending: true, nullsFirst: false })
          .order('legal_name', { ascending: true })
        if (clErr) throw clErr
        if (!cancelled) setClients(cl || [])

        // Reimbursable expenses for the SELECTED top-bar month, grouped by
        // client_name (free text on expenses). We then match in the render
        // layer against each client's trade_name OR legal_name. Keys are
        // normalised (lowercased, trimmed) so spelling/case variants merge.
        if (selectedMonth && selectedYear) {
          const monthStart = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`
          const monthEnd   = new Date(selectedYear, selectedMonth, 0).toISOString().slice(0, 10)
          const { data: exp, error: expErr } = await supabase
            .from('expenses')
            .select('client_name, amount')
            .eq('company_id', comp.id)
            .eq('requires_reimbursement', true)
            .not('client_name', 'is', null)
            .gte('date', monthStart)
            .lte('date', monthEnd)
          if (expErr) throw expErr
          if (!cancelled) {
            const m = new Map()
            for (const row of (exp || [])) {
              const key = (row.client_name || '').trim().toLowerCase()
              if (!key) continue
              m.set(key, (m.get(key) || 0) + Math.abs(Number(row.amount) || 0))
            }
            setReimbursableByClient(m)
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load clients')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedCompany, selectedMonth, selectedYear])

  // Helper — get the reimbursable total for a client by trying trade_name
  // first, then falling back to legal_name. Returns 0 when no match.
  const reimbursableFor = (client) => {
    const tradeKey = (client.trade_name || '').trim().toLowerCase()
    const legalKey = (client.legal_name || '').trim().toLowerCase()
    return reimbursableByClient.get(tradeKey)
        || reimbursableByClient.get(legalKey)
        || 0
  }

  // Month name for the column header (e.g. "Reimbursable (March 2026)")
  const monthName = (m) =>
    ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1] || ''

  // ---- Open the modal in add / edit mode ----
  const openAdd = () => {
    setForm({ ...BLANK_FORM })
    setSaveError(null)
    setEditing({ mode: 'add', client: null })
  }
  const openEdit = (client) => {
    setForm({
      legal_name:      client.legal_name || '',
      trade_name:      client.trade_name || '',
      contact_name:    client.contact_name || '',
      monthly_fee_net: client.monthly_fee_net != null ? String(client.monthly_fee_net) : '',
      monthly_fixed_expense_net: client.monthly_fixed_expense_net != null ? String(client.monthly_fixed_expense_net) : '',
      vat_rate:        client.vat_rate != null ? String(client.vat_rate) : '0',
      email_to:        client.email_to || '',
      email_cc:        client.email_cc || '',
      notes:           client.notes || '',
      active:          client.active !== false,
    })
    setSaveError(null)
    setEditing({ mode: 'edit', client })
  }
  const closeModal = () => {
    setEditing(null)
    setForm(BLANK_FORM)
    setSaveError(null)
  }

  // ---- Save (insert or update) ----
  const handleSave = async () => {
    setSaveError(null)
    if (!form.legal_name?.trim()) {
      setSaveError('Legal name is required'); return
    }
    const fee = parseFloat(form.monthly_fee_net)
    if (Number.isNaN(fee) || fee < 0) {
      setSaveError('Monthly fee must be a non-negative number'); return
    }
    // Fixed expense reimbursement is optional. Blank → 0. Non-blank must be ≥ 0.
    const fixedExp = form.monthly_fixed_expense_net === '' || form.monthly_fixed_expense_net == null
      ? 0
      : parseFloat(form.monthly_fixed_expense_net)
    if (Number.isNaN(fixedExp) || fixedExp < 0) {
      setSaveError('Fixed monthly expense reimbursement must be a non-negative number (or blank for none)'); return
    }
    const vat = parseFloat(form.vat_rate)
    if (Number.isNaN(vat) || vat < 0 || vat > 1) {
      setSaveError('VAT rate must be a decimal between 0 and 1 (e.g. 0.19 for 19%)'); return
    }

    const row = {
      company_id:      companyId,
      legal_name:      form.legal_name.trim(),
      trade_name:      form.trade_name?.trim() || null,
      contact_name:    form.contact_name?.trim() || null,
      monthly_fee_net: fee,
      monthly_fixed_expense_net: fixedExp,
      vat_rate:        vat,
      email_to:        form.email_to?.trim() || null,
      email_cc:        form.email_cc?.trim() || null,
      notes:           form.notes?.trim() || null,
      active:          !!form.active,
    }

    try {
      setSaving(true)
      if (editing.mode === 'edit') {
        const { data: updated, error: updErr } = await supabase
          .from('clients')
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq('id', editing.client.id)
          .select('*')
          .single()
        if (updErr) throw updErr
        setClients(prev => prev.map(c => c.id === updated.id ? updated : c))
      } else {
        const { data: inserted, error: insErr } = await supabase
          .from('clients')
          .insert([row])
          .select('*')
          .single()
        if (insErr) throw insErr
        setClients(prev => [...prev, inserted].sort((a, b) =>
          (a.trade_name || a.legal_name).localeCompare(b.trade_name || b.legal_name)
        ))
      }
      closeModal()
    } catch (err) {
      setSaveError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ---- Toggle active inline (without opening the modal) ----
  const toggleActive = async (client) => {
    try {
      const { data: updated, error: updErr } = await supabase
        .from('clients')
        .update({ active: !client.active, updated_at: new Date().toISOString() })
        .eq('id', client.id)
        .select('*')
        .single()
      if (updErr) throw updErr
      setClients(prev => prev.map(c => c.id === updated.id ? updated : c))
    } catch (err) {
      alert(`Could not toggle active: ${err.message}`)
    }
  }

  // ---- Delete with confirm ----
  const handleDelete = async (client) => {
    const ok = window.confirm(
      `Delete client "${client.trade_name || client.legal_name}"?\n\n`
      + 'This permanently removes the client record. Past expenses tagged with '
      + 'this name as free text are NOT affected. Cannot be undone.'
    )
    if (!ok) return
    try {
      const { error: delErr } = await supabase
        .from('clients').delete().eq('id', client.id)
      if (delErr) throw delErr
      setClients(prev => prev.filter(c => c.id !== client.id))
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  // ---- Compute total monthly billable across active clients ----
  // = (monthly fee × (1 + VAT))            ← services, VAT applies
  // + fixed monthly expense reimbursement  ← pass-through, NO VAT
  // for each active client, summed across all active clients.
  const totalMonthlyBillable = clients
    .filter(c => c.active)
    .reduce((sum, c) => {
      const feeWithVat   = Number(c.monthly_fee_net || 0) * (1 + Number(c.vat_rate || 0))
      const fixedExpense = Number(c.monthly_fixed_expense_net || 0)
      return sum + feeWithVat + fixedExpense
    }, 0)

  // ---- Total reimbursable across all active clients for the selected month ----
  const totalReimbursable = clients
    .filter(c => c.active)
    .reduce((sum, c) => sum + reimbursableFor(c), 0)

  if (loading) return <div className="loading">Loading clients…</div>
  if (error)   return <div className="error">{error}</div>

  return (
    <div className="clients-page">
      <div className="clients-header">
        <div>
          <h2 style={{ margin: 0 }}>👥 Clients — {selectedCompany}</h2>
          <div style={{ color: '#6b7280', marginTop: 4, fontSize: 13 }}>
            {clients.length} total · {clients.filter(c => c.active).length} active
            {' · '}total monthly billable (active): <strong>{formatEuro(totalMonthlyBillable)}</strong>
            {selectedMonth && selectedYear && (
              <>
                {' · '}reimbursable in {monthName(selectedMonth)} {selectedYear}:{' '}
                <strong>{formatEuro(totalReimbursable)}</strong>
              </>
            )}
          </div>
        </div>
        <button onClick={openAdd} className="button">+ Add client</button>
      </div>

      {clients.length === 0 ? (
        <div className="empty-state">
          <p><strong>No clients yet for {selectedCompany}.</strong></p>
          <p>Click <em>+ Add client</em> above to start building the list.</p>
        </div>
      ) : (
        <>
          {/* =================================================================
              BLOCK 1 — Monthly Fee Invoices
              Master list. All active clients with a non-zero monthly fee.
              This is the only block with Edit / Delete / Active toggle —
              the other blocks are read-only filtered views of the same
              underlying records.
              ================================================================= */}
          {(() => {
            const rows = clients.filter(c => c.active && Number(c.monthly_fee_net || 0) > 0)
            const totalForBlock = rows.reduce((s, c) =>
              s + Number(c.monthly_fee_net || 0) * (1 + Number(c.vat_rate || 0)), 0)
            return (
              <section className="clients-block clients-block-monthly">
                <div className="clients-block-header">
                  <h3>📄 Monthly Fee Invoices</h3>
                  <div className="block-subtitle">
                    {rows.length} active · total <strong>{formatEuro(totalForBlock)}</strong>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                <table className="clients-table">
                  <thead>
                    <tr>
                      <th>Project name</th>
                      <th>Legal name</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Amount (net)</th>
                      <th style={{ textAlign: 'right' }}>VAT</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th>Inv. #</th>
                      <th>Issue Date</th>
                      <th title="Statement of Account updated after invoice issued">SOA ✓</th>
                      <th>Payment Date</th>
                      <th title="Statement of Account updated after payment received">SOA ✓</th>
                      <th>Status</th>
                      <th>Active</th>
                      <th>Edit</th>
                      <th>Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(c => {
                      const total = Number(c.monthly_fee_net || 0) * (1 + Number(c.vat_rate || 0))
                      const periodLabel = selectedMonth && selectedYear
                        ? `${monthName(selectedMonth)} ${selectedYear} fee`
                        : 'Monthly fee'
                      return (
                        <tr key={c.id}>
                          <td><strong>{c.trade_name || '—'}</strong></td>
                          <td style={{ fontSize: 13, color: '#374151' }}>{c.legal_name}</td>
                          <td style={{ fontStyle: 'italic', color: '#374151' }}>{periodLabel}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatEuro(c.monthly_fee_net)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {Number(c.vat_rate) === 0
                              ? <span style={{ color: '#9ca3af' }}>—</span>
                              : `${(Number(c.vat_rate) * 100).toFixed(0)}%`}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                            {formatEuro(total)}
                          </td>
                          {/* Lifecycle cells — Step 2 will wire these to the
                              invoices table so they become real inline inputs.
                              For now they render as placeholders so the user
                              can see the planned layout. */}
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">☐</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">☐</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">
                            <span className="status-pending">Pending</span>
                          </td>
                          <td>
                            <label className="active-toggle">
                              <input
                                type="checkbox"
                                checked={!!c.active}
                                onChange={() => toggleActive(c)}
                              />
                              <span>Active</span>
                            </label>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="row-btn" onClick={() => openEdit(c)}>✏️</button>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="row-btn danger" onClick={() => handleDelete(c)}>🗑️</button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </section>
            )
          })()}

          {/* =================================================================
              BLOCK 2 (was 4) — One-off Invoices (placeholder)
              Moved up to follow Monthly Fees per the user's preferred
              invoicing order: monthly fees → one-off → fixed reimbursement →
              variable reimbursement → credit notes → inactive (last).
              ================================================================= */}
          <section className="clients-block clients-block-oneoff">
            <div className="clients-block-header">
              <h3>
                ⭐ One-off Invoices
                {selectedMonth && selectedYear && (
                  <span style={{ fontWeight: 400, fontSize: 14, color: '#6b7280', marginLeft: 8 }}>
                    — {monthName(selectedMonth)} {selectedYear}
                  </span>
                )}
              </h3>
              <div className="block-subtitle">
                Coming with Step 2 (Invoicing Tracker — task #45). For
                special / ad-hoc invoices on top of recurring monthly fees.
              </div>
            </div>
            <div className="block-placeholder">
              No one-off invoices yet. The "+ Add one-off invoice" button
              will appear here once Step 2 is built.
            </div>
          </section>

          {/* =================================================================
              BLOCK 2 — Fixed Monthly Expense Reimbursement Invoices
              Only active clients where monthly_fixed_expense_net > 0.
              Same column structure as Block 1. Period sits in the
              Description cell ("March 2026 fixed expenses"), not the
              column header — so the same client can appear with two
              rows when two months' fixed reimbursements are invoiced
              in a single month.
              ================================================================= */}
          {(() => {
            const rows = clients.filter(c => c.active && Number(c.monthly_fixed_expense_net || 0) > 0)
            // Expense reimbursements are pass-through costs (the underlying
            // expense already had its own VAT treatment) — VAT is NEVER
            // applied on the reimbursement invoice. So the block total is
            // just the sum of the net amounts; no VAT multiplier.
            const totalForBlock = rows.reduce((s, c) =>
              s + Number(c.monthly_fixed_expense_net || 0), 0)
            const periodLabel = selectedMonth && selectedYear
              ? `${monthName(selectedMonth)} ${selectedYear} fixed expenses`
              : 'Fixed monthly expenses'
            return (
              <section className="clients-block clients-block-fixed">
                <div className="clients-block-header">
                  <h3>🔁 Fixed Monthly Expense Reimbursement Invoices</h3>
                  <div className="block-subtitle">
                    {rows.length === 0
                      ? 'No clients with a fixed monthly expense reimbursement.'
                      : <>
                          {rows.length} active · total <strong>{formatEuro(totalForBlock)}</strong>
                          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>
                            (no VAT — pass-through cost)
                          </span>
                        </>}
                  </div>
                </div>
                {rows.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                  <table className="clients-table">
                    <thead>
                      <tr>
                        <th>Project name</th>
                        <th>Legal name</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th>Inv. #</th>
                        <th>Issue Date</th>
                        <th title="Statement of Account updated after invoice issued">SOA ✓</th>
                        <th>Payment Date</th>
                        <th title="Statement of Account updated after payment received">SOA ✓</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(c => {
                        const fixedExp = Number(c.monthly_fixed_expense_net || 0)
                        return (
                          <tr key={c.id}>
                            <td><strong>{c.trade_name || '—'}</strong></td>
                            <td style={{ fontSize: 13, color: '#374151' }}>{c.legal_name}</td>
                            <td style={{ fontStyle: 'italic', color: '#374151' }}>{periodLabel}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                              {formatEuro(fixedExp)}
                            </td>
                            <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                            <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                            <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">☐</td>
                            <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                            <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">☐</td>
                            <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">
                              <span className="status-pending">Pending</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </section>
            )
          })()}

          {/* =================================================================
              BLOCK 3 — Variable Expense Reimbursement Invoices
              Same column structure as Block 1/2. Each row clearly labels
              which source month the amount came from (e.g. "March 2026
              expenses to be reimbursed"). For now only shows the
              currently selected top-bar month; multi-month bundling
              (Dec + Jan + Feb in one invoice) comes with Step 2 once we
              can track which expenses have already been invoiced.
              ================================================================= */}
          {(() => {
            const rows = clients
              .filter(c => c.active && reimbursableFor(c) > 0)
              .map(c => ({ c, reimbursable: reimbursableFor(c) }))
              .sort((a, b) => b.reimbursable - a.reimbursable)
            const totalForBlock = rows.reduce((s, r) => s + r.reimbursable, 0)
            const periodLabel = selectedMonth && selectedYear
              ? `${monthName(selectedMonth)} ${selectedYear} expenses to be reimbursed`
              : 'Reimbursable expenses'
            return (
              <section className="clients-block clients-block-variable">
                <div className="clients-block-header">
                  <h3>
                    💸 Variable Expense Reimbursement Invoices
                    {selectedMonth && selectedYear && (
                      <span style={{ fontWeight: 400, fontSize: 14, color: '#6b7280', marginLeft: 8 }}>
                        — {monthName(selectedMonth)} {selectedYear}
                      </span>
                    )}
                  </h3>
                  <div className="block-subtitle">
                    {rows.length === 0
                      ? 'No clients with reimbursable expenses for this month.'
                      : <>
                          {rows.length} client{rows.length === 1 ? '' : 's'} · total <strong>{formatEuro(totalForBlock)}</strong>
                          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                            Note: only the selected top-bar month is shown.
                            Bundling multiple months into one invoice (e.g.
                            Jan + Feb + Mar together) comes with Step 2.
                          </div>
                        </>}
                  </div>
                </div>
                {rows.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                  <table className="clients-table">
                    <thead>
                      <tr>
                        <th>Project name</th>
                        <th>Legal name</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th>Inv. #</th>
                        <th>Issue Date</th>
                        <th title="Statement of Account updated after invoice issued">SOA ✓</th>
                        <th>Payment Date</th>
                        <th title="Statement of Account updated after payment received">SOA ✓</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* No VAT applied — expense reimbursements are
                          pass-through costs, not services. The original
                          expense already had its own VAT treatment. */}
                      {rows.map(({ c, reimbursable }) => (
                        <tr key={c.id}>
                          <td><strong>{c.trade_name || '—'}</strong></td>
                          <td style={{ fontSize: 13, color: '#374151' }}>{c.legal_name}</td>
                          <td style={{ fontStyle: 'italic', color: '#374151' }}>{periodLabel}</td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#7c2d12' }}>
                            {formatEuro(reimbursable)}
                          </td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">☐</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">—</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">☐</td>
                          <td className="lifecycle-cell" title="Editable in Step 2 (invoicing tracker)">
                            <span className="status-pending">Pending</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                )}
              </section>
            )
          })()}

          {/* =================================================================
              BLOCK 5 (Credit Notes) — Placeholder, populates with Step 2.
              ================================================================= */}
          <section className="clients-block clients-block-credit">
            <div className="clients-block-header">
              <h3>
                ↩️ Credit Notes
                {selectedMonth && selectedYear && (
                  <span style={{ fontWeight: 400, fontSize: 14, color: '#6b7280', marginLeft: 8 }}>
                    — {monthName(selectedMonth)} {selectedYear}
                  </span>
                )}
              </h3>
              <div className="block-subtitle">
                Coming with Step 2 (Invoicing Tracker — task #45). For
                reversing or correcting previously-issued invoices.
              </div>
            </div>
            <div className="block-placeholder">
              No credit notes yet. The "+ Add credit note" button will
              appear here once Step 2 is built.
            </div>
          </section>

          {/* =================================================================
              EMAIL DELIVERY DIRECTORY — per-project cards
              Compact reference at the bottom of the page showing each
              active client's contact + email chain in one place, with a
              placeholder list of the month's invoices ready to send.
              The "Sent / Not sent" checkbox per invoice will populate
              from the invoices table once Step 2 ships.
              ================================================================= */}
          <section className="clients-block clients-block-email">
            <div className="clients-block-header">
              <h3>📧 Email Delivery — per project</h3>
              <div className="block-subtitle">
                Contact + email reference for sending out the month's
                invoices. The per-project invoice list with Sent/Not sent
                checkboxes will populate from Step 2 (Invoicing Tracker).
              </div>
            </div>
            <div className="email-cards-grid">
              {clients.filter(c => c.active).map(c => (
                <div className="email-card" key={c.id}>
                  <div className="email-card-project">
                    {c.trade_name || c.legal_name}
                  </div>
                  <div className="email-card-legal">{c.legal_name}</div>
                  <div className="email-card-row">
                    <span className="email-card-label">Contact</span>
                    <span>{c.contact_name || '—'}</span>
                  </div>
                  <div className="email-card-row">
                    <span className="email-card-label">TO</span>
                    <span style={{ wordBreak: 'break-all' }}>{c.email_to || '—'}</span>
                  </div>
                  <div className="email-card-row">
                    <span className="email-card-label">CC</span>
                    <span style={{ wordBreak: 'break-all' }}>{c.email_cc || '—'}</span>
                  </div>
                  <div className="email-card-invoices">
                    <div className="email-card-invoices-header">
                      Invoices to send{selectedMonth && selectedYear && ` (${monthName(selectedMonth)} ${selectedYear})`}:
                    </div>
                    <div className="email-card-placeholder">
                      No invoices tracked yet. Step 2 will list each invoice
                      for this project here with a ☐ Sent / ☑ Sent checkbox.
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* =================================================================
              BLOCK 6 (was 1b) — Inactive clients
              Moved to the very bottom — discoverable / restorable but out
              of the way of the active invoice-prep flow above. Only renders
              when at least one inactive client exists.
              ================================================================= */}
          {clients.some(c => !c.active) && (
            <section className="clients-block clients-block-inactive">
              <div className="clients-block-header">
                <h3>💤 Inactive clients ({clients.filter(c => !c.active).length})</h3>
                <div className="block-subtitle">
                  Not billed. Tick Active to bring them back.
                </div>
              </div>
              <table className="clients-table">
                <thead>
                  <tr>
                    <th>Trade name</th>
                    <th>Legal name</th>
                    <th>Contact</th>
                    <th style={{ textAlign: 'right' }}>Fee (net)</th>
                    <th>Active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clients.filter(c => !c.active).map(c => (
                    <tr key={c.id} style={{ opacity: 0.55 }}>
                      <td><strong>{c.trade_name || '—'}</strong></td>
                      <td style={{ fontSize: 13, color: '#374151' }}>{c.legal_name}</td>
                      <td>{c.contact_name || '—'}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatEuro(c.monthly_fee_net)}</td>
                      <td>
                        <label className="active-toggle">
                          <input
                            type="checkbox"
                            checked={!!c.active}
                            onChange={() => toggleActive(c)}
                          />
                          <span>Inactive</span>
                        </label>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="row-btn" onClick={() => openEdit(c)}>✏️ Edit</button>
                        <button className="row-btn danger" onClick={() => handleDelete(c)}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      {/* ===== Edit / Add modal ===== */}
      {editing && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content clients-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing.mode === 'edit' ? `Edit ${editing.client?.trade_name || editing.client?.legal_name}` : 'Add new client'}</h3>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              {saveError && <div className="message error" style={{ marginBottom: 12 }}>{saveError}</div>}

              <div className="form-grid">
                <div className="form-group">
                  <label>Legal name *</label>
                  <input
                    type="text"
                    value={form.legal_name}
                    onChange={(e) => setForm(f => ({ ...f, legal_name: e.target.value }))}
                    className="form-input"
                    placeholder="e.g. BTS Real estate SM SA"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>Trade / project name</label>
                  <input
                    type="text"
                    value={form.trade_name}
                    onChange={(e) => setForm(f => ({ ...f, trade_name: e.target.value }))}
                    className="form-input"
                    placeholder="e.g. Blue Lagoon"
                  />
                </div>
                <div className="form-group">
                  <label>Contact name</label>
                  <input
                    type="text"
                    value={form.contact_name}
                    onChange={(e) => setForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="form-input"
                    placeholder="e.g. Kostas"
                  />
                </div>
                <div className="form-group">
                  <label>Monthly fee (net) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.monthly_fee_net}
                    onChange={(e) => setForm(f => ({ ...f, monthly_fee_net: e.target.value }))}
                    className="form-input"
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group">
                  <label>Fixed monthly expense reimbursement (net)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.monthly_fixed_expense_net}
                    onChange={(e) => setForm(f => ({ ...f, monthly_fixed_expense_net: e.target.value }))}
                    className="form-input"
                    placeholder="0.00 (leave blank for none)"
                  />
                  <small style={{ color: '#6b7280', fontSize: 11 }}>
                    Per-agreement recurring expense reimbursement. If &gt; 0, Step 2 invoicing
                    auto-drafts a second invoice each month for this amount.
                  </small>
                </div>
                <div className="form-group">
                  <label>VAT rate</label>
                  <select
                    value={form.vat_rate}
                    onChange={(e) => setForm(f => ({ ...f, vat_rate: e.target.value }))}
                    className="form-input"
                  >
                    {VAT_PRESETS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                  <small style={{ color: '#6b7280', fontSize: 11 }}>
                    Total invoice = net × (1 + VAT rate)
                  </small>
                </div>
                <div className="form-group">
                  <label>Active</label>
                  <label className="active-toggle" style={{ paddingTop: 8 }}>
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setForm(f => ({ ...f, active: e.target.checked }))}
                    />
                    <span>{form.active ? 'Active (billing every month)' : 'Inactive (archived)'}</span>
                  </label>
                </div>
                <div className="form-group full-row">
                  <label>Email TO (comma-separated)</label>
                  <input
                    type="text"
                    value={form.email_to}
                    onChange={(e) => setForm(f => ({ ...f, email_to: e.target.value }))}
                    className="form-input"
                    placeholder="primary@example.com, second@example.com"
                  />
                </div>
                <div className="form-group full-row">
                  <label>Email CC (comma-separated)</label>
                  <input
                    type="text"
                    value={form.email_cc}
                    onChange={(e) => setForm(f => ({ ...f, email_cc: e.target.value }))}
                    className="form-input"
                    placeholder="cc@example.com, yoram.kedem@rabonaholdings.com"
                  />
                </div>
                <div className="form-group full-row">
                  <label>Notes</label>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                    className="form-input"
                    placeholder="Optional internal notes about this client"
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeModal} className="btn-secondary" disabled={saving}>Cancel</button>
              <button onClick={handleSave} className="button" disabled={saving}>
                {saving ? '💾 Saving…' : (editing.mode === 'edit' ? '💾 Save changes' : '➕ Add client')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
