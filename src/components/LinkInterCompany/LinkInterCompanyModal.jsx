import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'

/**
 * LinkInterCompanyModal — manage the link between two paired expenses.
 *
 * Handles TWO link modes:
 *
 * 1) INTER-COMPANY (Rabona ↔ Espargos)
 *    - One Rabona "Transfers to Connected Accounts" outgoing pairs with one
 *      Espargos "Intercompany Funding" incoming (or vice versa).
 *    - Match: OTHER company, opposite category, same amount, ±7 days, unlinked.
 *
 * 2) INTRA-COMPANY (Current Account ↔ Mastercard within same company)
 *    - One outgoing "Movement Between Accounts" on Account A pairs with one
 *      incoming "Movement Between Accounts" on Account B in the same company.
 *    - Match: SAME company, SAME category, DIFFERENT account, opposite direction,
 *      same amount, ±7 days, unlinked.
 *
 * Stored bi-directionally in expenses.linked_expense_id on both rows.
 *
 * Cross-month is supported naturally: a Jan 31 outgoing can pair with a Feb 2
 * incoming because the ±7-day window crosses the boundary.
 *
 * Props:
 *   expense        — the expense to link (must include id, amount, date, category,
 *                    company_id, account_id, accounts.name)
 *   currentCompany — the company name currently selected
 *   onClose        — close the modal (no save)
 *   onSaved        — save callback (parent should reload its list)
 */

// Inter-company category pair — outgoing on one side, incoming on the other side
const INTERCOMPANY_OPPOSITE = {
  'Transfers to Connected Accounts': 'Intercompany Funding',
  'Intercompany Funding': 'Transfers to Connected Accounts',
}

// Intra-company link category (same on both sides — just different accounts)
const INTRACOMPANY_CATEGORY = 'Movement Between Accounts'

export function LinkInterCompanyModal({ expense, currentCompany, onClose, onSaved }) {
  const [otherCompany, setOtherCompany] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [currentLink, setCurrentLink] = useState(null) // the already-linked counterpart, if any
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const myCategoryName = expense.expense_categories?.name

  // Detect which link mode this expense uses based on its category.
  //   'inter'  → other company, opposite category
  //   'intra'  → same company, same category, different account, opposite direction
  //   null     → not a linkable category (modal shouldn't have opened)
  const linkMode = myCategoryName === INTRACOMPANY_CATEGORY
    ? 'intra'
    : INTERCOMPANY_OPPOSITE[myCategoryName] ? 'inter' : null

  // For inter-company, the OTHER company's matching category
  const otherCategoryName = INTERCOMPANY_OPPOSITE[myCategoryName]
  // The direction the counterpart must have (always opposite of this expense)
  const oppositeDirection = expense.direction === 'in' ? 'out' : 'in'

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

  // Initial load: branch by link mode, fetch current link OR candidates.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true); setError(null)

        if (!linkMode) {
          setError(`"${myCategoryName}" is not a linkable category. Linking applies to: ` +
            `Transfers to Connected Accounts, Intercompany Funding, or Movement Between Accounts.`)
          setLoading(false)
          return
        }

        // 1. Find the OTHER company (only needed for inter-company mode)
        if (linkMode === 'inter') {
          const { data: companies, error: compErr } = await supabase
            .from('companies').select('id, name')
          if (compErr) throw compErr
          const other = (companies || []).find(c => c.name !== currentCompany)
          if (!other) throw new Error('Could not find the other company. Set up both Rabona and Espargos first.')
          if (cancelled) return
          setOtherCompany(other)
        }

        // 2. If already linked, fetch the counterpart's details for display
        if (expense.linked_expense_id) {
          const { data: linked, error: linkErr } = await supabase
            .from('expenses')
            .select('id, reference_number, vendor, amount, date, company_id, account_id, companies(name), accounts(name)')
            .eq('id', expense.linked_expense_id)
            .maybeSingle()
          if (linkErr) throw linkErr
          if (!cancelled) setCurrentLink(linked)
          return // already linked — no candidate search needed
        }

        // 3. Not yet linked — fetch candidates per link mode
        if (!dateWindow) {
          setError('This expense has no date — cannot compute the ±7 day search window.')
          setLoading(false)
          return
        }

        if (linkMode === 'inter') {
          // Inter-company: search the OTHER company for opposite-category, opposite-direction match
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

          const { data: companies } = await supabase.from('companies').select('id, name')
          const other = (companies || []).find(c => c.name !== currentCompany)
          const { data: cands, error: candErr } = await supabase
            .from('expenses')
            .select('id, reference_number, vendor, description, amount, date, linked_expense_id, accounts(name), expense_categories(name)')
            .eq('company_id', other.id)
            .in('category_id', targetCatIds)
            .eq('amount', expense.amount)
            .gte('date', dateWindow.start)
            .lte('date', dateWindow.end)
            .is('linked_expense_id', null)
            .order('date', { ascending: true })
          if (candErr) throw candErr
          if (!cancelled) setCandidates(cands || [])
        } else if (linkMode === 'intra') {
          // Intra-company: SAME company, SAME category, DIFFERENT account, OPPOSITE direction
          const { data: categories, error: catErr } = await supabase
            .from('expense_categories')
            .select('id, name')
            .eq('name', INTRACOMPANY_CATEGORY)
          if (catErr) throw catErr
          const targetCatIds = (categories || []).map(c => c.id)
          if (targetCatIds.length === 0) {
            setError(`Category "${INTRACOMPANY_CATEGORY}" not found in the system.`)
            setLoading(false)
            return
          }

          let query = supabase
            .from('expenses')
            .select('id, reference_number, vendor, description, amount, date, linked_expense_id, account_id, accounts(name), expense_categories(name)')
            .eq('company_id', expense.company_id)
            .in('category_id', targetCatIds)
            .eq('amount', expense.amount)
            .eq('direction', oppositeDirection)
            .gte('date', dateWindow.start)
            .lte('date', dateWindow.end)
            .is('linked_expense_id', null)
            .order('date', { ascending: true })
          // Different account from this expense
          if (expense.account_id) {
            query = query.neq('account_id', expense.account_id)
          }
          const { data: cands, error: candErr } = await query
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

  // Mode-specific labels (title + subtitles vary between inter- and intra-company)
  const modalTitle = linkMode === 'intra' ? '🔗 Account-to-Account Link' : '🔗 Inter-company Link'
  const thisExpenseSubtitle = linkMode === 'intra'
    ? `This expense (${currentCompany} · ${expense.accounts?.name || 'Account'})`
    : `This expense (${currentCompany})`

  // ----- Render -----
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content link-intercompany-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2>{modalTitle}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ padding: 20 }}>
          {/* This expense — summary */}
          <div style={{ background: '#f9fafb', padding: 12, borderRadius: 6, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{thisExpenseSubtitle}</div>
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
                  {linkMode === 'intra'
                    ? `${currentCompany} · ${currentLink.accounts?.name || 'Other Account'}`
                    : (currentLink.companies?.name || otherCompany?.name)}
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
                  {linkMode === 'intra'
                    ? `Candidates on other accounts in ${currentCompany}:`
                    : `Candidates from ${otherCompany?.name || 'the other company'}:`}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {linkMode === 'intra'
                    ? `Looking for "${INTRACOMPANY_CATEGORY}" expenses with exact amount ${formatAmount(expense.amount)} on a different account, dated between ${formatDate(dateWindow?.start)} and ${formatDate(dateWindow?.end)}.`
                    : `Looking for "${otherCategoryName}" expenses with exact amount ${formatAmount(expense.amount)} dated between ${formatDate(dateWindow?.start)} and ${formatDate(dateWindow?.end)}.`}
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
                      {linkMode === 'intra' && <th style={{ padding: '8px 6px' }}>Account</th>}
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
                        {linkMode === 'intra' && (
                          <td style={{ padding: '8px 6px' }}>{c.accounts?.name || '—'}</td>
                        )}
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
