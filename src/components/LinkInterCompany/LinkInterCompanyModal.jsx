import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'

/**
 * LinkInterCompanyModal — manage the inter-company link between two expenses.
 *
 * One Rabona "Transfers to Connected Accounts" outgoing expense pairs with one
 * Espargos "Intercompany Funding" incoming expense (or vice versa). The link is
 * stored bi-directionally in expenses.linked_expense_id on both rows.
 *
 * Matching rules (per Betija's spec):
 *   - Exact amount match (no tolerance — bank fees don't apply between her accounts)
 *   - Date within ±7 days (covers settlement delays + weekends + bank holidays)
 *   - Currently unlinked (linked_expense_id IS NULL on the candidate)
 *   - Opposite-direction category in the OTHER company
 *
 * Cross-month is supported naturally: a Jan 31 outgoing on Rabona can pair with
 * a Feb 2 incoming on Espargos because the ±7-day window crosses the boundary.
 *
 * Props:
 *   expense        — the expense to link (must include id, amount, date, category)
 *   currentCompany — the company name currently selected ("Rabona Holdings" or "Espargos")
 *   onClose        — close the modal (no save)
 *   onSaved        — save callback (parent should reload its list)
 */

// Map: when looking at one side, what's the opposite category on the other side?
const OPPOSITE_CATEGORY = {
  'Transfers to Connected Accounts': 'Intercompany Funding',
  'Intercompany Funding': 'Transfers to Connected Accounts',
}

export function LinkInterCompanyModal({ expense, currentCompany, onClose, onSaved }) {
  const [otherCompany, setOtherCompany] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [currentLink, setCurrentLink] = useState(null) // the already-linked counterpart, if any
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const myCategoryName = expense.expense_categories?.name
  const otherCategoryName = OPPOSITE_CATEGORY[myCategoryName]

  // Format helpers (local copies to keep component self-contained)
  const formatDate = (iso) => {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  const formatAmount = (n) =>
    `€${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  // Build the ±7-day search window around this expense's date
  const dateWindow = useMemo(() => {
    if (!expense?.date) return null
    const d = new Date(expense.date + 'T00:00:00')
    const start = new Date(d); start.setDate(d.getDate() - 7)
    const end = new Date(d); end.setDate(d.getDate() + 7)
    const fmt = (dt) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    return { start: fmt(start), end: fmt(end) }
  }, [expense?.date])

  // Initial load: find the other company, then either fetch the current link OR fetch candidates.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true); setError(null)

        // 1. Find the OTHER company (anything other than currentCompany)
        const { data: companies, error: compErr } = await supabase
          .from('companies').select('id, name')
        if (compErr) throw compErr
        const other = (companies || []).find(c => c.name !== currentCompany)
        if (!other) throw new Error('Could not find the other company. Set up both Rabona and Espargos first.')
        if (cancelled) return
        setOtherCompany(other)

        // 2. If already linked, fetch the counterpart's details for display
        if (expense.linked_expense_id) {
          const { data: linked, error: linkErr } = await supabase
            .from('expenses')
            .select('id, reference_number, vendor, amount, date, company_id, companies(name)')
            .eq('id', expense.linked_expense_id)
            .maybeSingle()
          if (linkErr) throw linkErr
          if (!cancelled) setCurrentLink(linked)
        } else {
          // 3. Not yet linked — fetch candidates from the other company
          if (!otherCategoryName) {
            setError(`No opposite-category match for "${myCategoryName}". Inter-company link only applies to "Transfers to Connected Accounts" or "Intercompany Funding".`)
            setLoading(false)
            return
          }
          if (!dateWindow) {
            setError('This expense has no date — cannot compute the ±7 day search window.')
            setLoading(false)
            return
          }

          // Find the opposite-category id (the one on the OTHER company's side)
          const { data: categories, error: catErr } = await supabase
            .from('expense_categories')
            .select('id, name')
            .eq('name', otherCategoryName)
          if (catErr) throw catErr
          const targetCatIds = (categories || []).map(c => c.id)
          if (targetCatIds.length === 0) {
            setError(`Category "${otherCategoryName}" not found in the system.`)
            setLoading(false)
            return
          }

          // Find unlinked candidates on the OTHER company within the date+amount window
          const { data: cands, error: candErr } = await supabase
            .from('expenses')
            .select('id, reference_number, vendor, description, amount, date, linked_expense_id, expense_categories(name)')
            .eq('company_id', other.id)
            .in('category_id', targetCatIds)
            .eq('amount', expense.amount)
            .gte('date', dateWindow.start)
            .lte('date', dateWindow.end)
            .is('linked_expense_id', null)
            .order('date', { ascending: true })
          if (candErr) throw candErr
          if (!cancelled) setCandidates(cands || [])
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load link data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [expense?.id, expense?.linked_expense_id, currentCompany])

  // Bi-directionally link this expense ↔ candidate
  const handleLink = async (candidate) => {
    try {
      setSaving(true); setError(null)
      // Update side A (this expense)
      const { error: errA } = await supabase
        .from('expenses')
        .update({ linked_expense_id: candidate.id })
        .eq('id', expense.id)
      if (errA) throw errA
      // Update side B (the candidate)
      const { error: errB } = await supabase
        .from('expenses')
        .update({ linked_expense_id: expense.id })
        .eq('id', candidate.id)
      if (errB) {
        // Rollback side A so we don't leave a half-link
        await supabase.from('expenses').update({ linked_expense_id: null }).eq('id', expense.id)
        throw errB
      }
      if (onSaved) onSaved()
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to create link')
    } finally {
      setSaving(false)
    }
  }

  // Bi-directionally unlink
  const handleUnlink = async () => {
    if (!currentLink) return
    if (!window.confirm(`Unlink this expense from ${currentLink.reference_number}?`)) return
    try {
      setSaving(true); setError(null)
      // Clear both sides (order doesn't matter for unlink)
      const [resA, resB] = await Promise.all([
        supabase.from('expenses').update({ linked_expense_id: null }).eq('id', expense.id),
        supabase.from('expenses').update({ linked_expense_id: null }).eq('id', currentLink.id),
      ])
      if (resA.error) throw resA.error
      if (resB.error) throw resB.error
      if (onSaved) onSaved()
      onClose()
    } catch (err) {
      setError(err.message || 'Failed to unlink')
    } finally {
      setSaving(false)
    }
  }

  // ----- Render -----
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content link-intercompany-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2>🔗 Inter-company Link</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          {/* This expense — summary */}
          <div style={{ background: '#f9fafb', padding: 12, borderRadius: 6, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>This expense ({currentCompany})</div>
            <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
              {expense.reference_number} · {formatDate(expense.date)} · {formatAmount(expense.amount)}
            </div>
            <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>
              {expense.vendor || '—'} · <em>{myCategoryName || 'No category'}</em>
            </div>
          </div>

          {error && (
            <div style={{ background: '#fef2f2', color: '#b91c1c', padding: 10, borderRadius: 4, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {loading && <div style={{ padding: 20, textAlign: 'center' }}>Loading…</div>}

          {/* Already-linked branch */}
          {!loading && currentLink && (
            <div>
              <div style={{ marginBottom: 12, fontWeight: 600 }}>Currently linked to:</div>
              <div style={{ background: '#ecfdf5', border: '1px solid #6ee7b7', padding: 12, borderRadius: 6 }}>
                <div style={{ fontSize: 12, color: '#065f46', marginBottom: 4 }}>
                  {currentLink.companies?.name || otherCompany?.name}
                </div>
                <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {currentLink.reference_number} · {formatDate(currentLink.date)} · {formatAmount(currentLink.amount)}
                </div>
                <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>
                  {currentLink.vendor || '—'}
                </div>
              </div>
              <button
                onClick={handleUnlink}
                disabled={saving}
                style={{
                  marginTop: 16, padding: '10px 16px', background: '#dc2626', color: 'white',
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
                }}
              >
                {saving ? 'Unlinking…' : '🔓 Unlink'}
              </button>
            </div>
          )}

          {/* Not-yet-linked branch */}
          {!loading && !currentLink && (
            <div>
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Candidates from {otherCompany?.name || 'the other company'}:
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Looking for "{otherCategoryName}" expenses with exact amount {formatAmount(expense.amount)} dated between {formatDate(dateWindow?.start)} and {formatDate(dateWindow?.end)}.
                </div>
              </div>

              {candidates.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', background: '#fef3c7', borderRadius: 6, color: '#92400e' }}>
                  ⚠️ No matching counterparts found.<br />
                  <span style={{ fontSize: 13 }}>
                    The counterpart may not be entered yet, may be more than 7 days away, or may already be linked to a different expense.
                  </span>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={{ padding: '8px 6px' }}>Date</th>
                      <th style={{ padding: '8px 6px' }}>Ref</th>
                      <th style={{ padding: '8px 6px' }}>Vendor</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '8px 6px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map(c => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '8px 6px' }}>{formatDate(c.date)}</td>
                        <td style={{ padding: '8px 6px', fontFamily: 'monospace' }}>{c.reference_number}</td>
                        <td style={{ padding: '8px 6px' }}>{c.vendor || c.description || '—'}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatAmount(c.amount)}</td>
                        <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleLink(c)}
                            disabled={saving}
                            style={{
                              padding: '6px 12px', background: '#2E7D32', color: 'white',
                              border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
                            }}
                          >
                            {saving ? '…' : '🔗 Link'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
