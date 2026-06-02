import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { PrintLetterhead } from '../PrintLetterhead/PrintLetterhead'
import { useLock } from '../../lib/LockContext'
import { useConfirm } from '../../lib/useConfirm'
import './MonthlyChecklist.css'

/**
 * MonthlyChecklist — recurring per-company task tracker.
 *
 * For each row in `checklist_items` (per company), the user marks the task
 * Done / Skipped (only for tasks where allows_skip=TRUE) / or leaves it
 * Pending each month. Completion creates a row in `checklist_completions`
 * with the timestamp and an optional note.
 *
 * Two task types:
 *   - 'static'                          → a single checkbox
 *   - 'dynamic_clients_with_expenses'   → expands to one sub-row per client
 *                                         that had reimbursable expenses in
 *                                         the selected month. Each sub-row
 *                                         shows "Client X Expense Report
 *                                         MMM YYYY — €amount" and has its
 *                                         own checkbox (sub_key = client name).
 *
 * Layout: 5 collapsible-feeling sections (Data Entry, Reporting & Analysis,
 * Client Invoicing & Receivables, Statutory & Periodic, Month-End Closing).
 * Each section header shows progress for that section. The page header
 * shows aggregate progress for the whole month.
 */

// Category code → display label + accent color. Used to render the section
// headers and the small left-border indicator on each section.
const CATEGORY_META = {
  data_entry:        { label: 'Data Entry',                  accent: '#3b82f6', subtitle: 'Gathering accounting information and supporting documents' },
  reports_analysis:  { label: 'Reporting & Analysis',        accent: '#8b5cf6', subtitle: 'Generate reports from the captured data' },
  reports_invoicing: { label: 'Client Invoicing & Receivables', accent: '#f59e0b', subtitle: 'Issue, deliver, and reconcile invoices' },
  reports_statutory: { label: 'Statutory & Periodic',        accent: '#ef4444', subtitle: 'Quarterly / conditional filings (VAT, depreciation)' },
  reports_closing:   { label: 'Month-End Closing',           accent: '#10b981', subtitle: 'Reconcile, lock, done' },
}
const CATEGORY_ORDER = [
  'data_entry',
  'reports_analysis',
  'reports_invoicing',
  'reports_statutory',
  'reports_closing',
]

// Sentinel used for the unique constraint on (item_id, year, month, sub_key)
// when sub_key is conceptually NULL. Postgres treats NULLs as distinct in
// unique constraints, so use this string for static (non-sub-keyed) tasks.
const NO_SUB_KEY = ''

function formatDateTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`
}

function monthName(m) {
  return ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1] || ''
}

function formatEuro(n) {
  return `€${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function MonthlyChecklist({ selectedCompany, selectedMonth, selectedYear, onSwitchTab }) {
  const [companyId, setCompanyId]     = useState(null)
  const [items, setItems]             = useState([])           // all checklist_items for this company (active + hidden)
  const [completions, setCompletions] = useState([])           // checklist_completions for the selected month
  const [clientExp, setClientExp]     = useState([])           // [{ client_name, total }] for dynamic Client expense reports
  const [invoicesIssued, setInvoicesIssued] = useState([])     // invoices.date_issued IS NOT NULL for this period — drives the cover page "Invoices Issued" section
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  // Track which note inputs are currently expanded (key = item_id + '|' + sub_key).
  const [noteOpen, setNoteOpen]       = useState({})
  // Inline "Add task" form per category: { [category]: { open, name, allows_skip } }.
  const [addForm, setAddForm]         = useState({})
  // Per-category toggle: when true, hidden (active=false) tasks are revealed
  // with an "Unhide" button so the user can bring them back. Key = category.
  const [showHidden, setShowHidden]   = useState({})
  // Collapse / expand the Folder Cover Page block on screen. Defaults to
  // collapsed so the cover page doesn't dominate the page when the user is
  // just working through the daily task list — they expand it at end of
  // month when preparing the physical folder. Print mode always shows the
  // expanded contents regardless of this state (handled in CSS).
  const [coverExpanded, setCoverExpanded] = useState(false)
  // ---- Month locking ----
  // Pulls from LockContext (loaded by App). isLocked checks the
  // closed_periods table; lockPeriod/unlockPeriod mutate it.
  const lock = useLock()
  const { confirm, confirmModal } = useConfirm()
  // Unlock requires the user to type "UNLOCK <MONTH> <YEAR>" verbatim.
  const [unlockingOpen, setUnlockingOpen] = useState(false)
  const [unlockingTyped, setUnlockingTyped] = useState('')
  const [lockBusy, setLockBusy] = useState(false)
  // ---- Folder Cover Page tick state ----
  // Persisted in localStorage, keyed per (company, year, month). Each value
  // is { [itemKey: string]: boolean }. This drives the cover page checkboxes
  // and the printed cover sheet — completely independent of the task list.
  const COVER_STORAGE_KEY = `coverPage:${selectedCompany}:${selectedYear}:${selectedMonth}`
  const [coverChecks, setCoverChecks] = useState({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COVER_STORAGE_KEY)
      setCoverChecks(raw ? JSON.parse(raw) : {})
    } catch {
      setCoverChecks({})
    }
  }, [COVER_STORAGE_KEY])
  const toggleCoverCheck = (key) => {
    setCoverChecks(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem(COVER_STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // ---- Loader ----
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setLoading(true); setError(null)

        // 1) Resolve company id from the selected company name (top bar).
        const { data: comp, error: compErr } = await supabase
          .from('companies').select('id').eq('name', selectedCompany).maybeSingle()
        if (compErr) throw compErr
        if (!comp) throw new Error(`Company "${selectedCompany}" not found.`)
        if (cancelled) return
        setCompanyId(comp.id)

        // 2) Load this company's checklist items — BOTH active and hidden.
        //    We filter client-side based on the per-category "Show hidden" toggle
        //    so the user can unhide tasks without re-querying.
        const { data: itemsData, error: itemsErr } = await supabase
          .from('checklist_items')
          .select('*')
          .eq('company_id', comp.id)
          .order('category', { ascending: true })
          .order('sort_order', { ascending: true })
        if (itemsErr) throw itemsErr
        if (cancelled) return
        setItems(itemsData || [])

        // 3) Load this month's completions for those items.
        const itemIds = (itemsData || []).map(i => i.id)
        if (itemIds.length === 0) {
          setCompletions([])
        } else {
          const { data: comps, error: compsErr } = await supabase
            .from('checklist_completions')
            .select('*')
            .in('item_id', itemIds)
            .eq('year', selectedYear)
            .eq('month', selectedMonth)
          if (compsErr) throw compsErr
          if (cancelled) return
          setCompletions(comps || [])
        }

        // 4) For dynamic Client-expense-reports task: pull clients with
        //    reimbursable expenses this month + their totals.
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
        if (cancelled) return
        // Group by client_name, sum amounts.
        const grouped = new Map()
        for (const row of (exp || [])) {
          const key = (row.client_name || '').trim()
          if (!key) continue
          grouped.set(key, (grouped.get(key) || 0) + Math.abs(Number(row.amount) || 0))
        }
        const clientList = Array.from(grouped.entries())
          .map(([client_name, total]) => ({ client_name, total }))
          .sort((a, b) => a.client_name.localeCompare(b.client_name))
        setClientExp(clientList)

        // 5) Invoices issued this month — drives the cover page "Invoices
        //    Issued" section. Only invoices that have actually been issued
        //    (date_issued IS NOT NULL) count — drafts are excluded since
        //    they're not yet physical paperwork in the folder. Joined with
        //    clients(trade_name) so the cover page row can label each
        //    invoice with its client.
        const { data: invs, error: invErr } = await supabase
          .from('invoices')
          .select('id, invoice_number, amount_net, amount_total, invoice_type, date_issued, clients(trade_name)')
          .eq('company_id', comp.id)
          .eq('period_year', selectedYear)
          .eq('period_month', selectedMonth)
          .not('date_issued', 'is', null)
          .order('invoice_number', { ascending: true })
        if (invErr) throw invErr
        if (cancelled) return
        setInvoicesIssued(invs || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load checklist')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedCompany, selectedMonth, selectedYear])

  // ---- Quick-lookup map of completions by (item_id, sub_key) ----
  const completionMap = useMemo(() => {
    const m = new Map()
    for (const c of completions) {
      m.set(`${c.item_id}|${c.sub_key || NO_SUB_KEY}`, c)
    }
    return m
  }, [completions])

  // ---- Helpers ----
  const getCompletion = (itemId, subKey = NO_SUB_KEY) =>
    completionMap.get(`${itemId}|${subKey || NO_SUB_KEY}`)

  // Set or clear a completion. Pass null for status to clear (delete).
  const setStatus = async (itemId, subKey, status, note = null) => {
    try {
      const key = subKey || NO_SUB_KEY
      const existing = getCompletion(itemId, key)
      if (status === null) {
        // Clear → delete row if it exists.
        if (!existing) return
        const { error: delErr } = await supabase
          .from('checklist_completions')
          .delete()
          .eq('id', existing.id)
        if (delErr) throw delErr
        setCompletions(prev => prev.filter(c => c.id !== existing.id))
        return
      }
      if (existing) {
        // Update the existing row's status (keep its note unless one is provided).
        const patch = {
          status,
          completed_at: new Date().toISOString(),
        }
        if (note !== null) patch.note = note
        const { data: updated, error: updErr } = await supabase
          .from('checklist_completions')
          .update(patch)
          .eq('id', existing.id)
          .select('*')
          .single()
        if (updErr) throw updErr
        setCompletions(prev => prev.map(c => c.id === existing.id ? updated : c))
      } else {
        // Insert a new completion row.
        const insertRow = {
          item_id: itemId,
          year: selectedYear,
          month: selectedMonth,
          sub_key: subKey || null,
          status,
          completed_at: new Date().toISOString(),
          note: note || null,
        }
        const { data: inserted, error: insErr } = await supabase
          .from('checklist_completions')
          .insert([insertRow])
          .select('*')
          .single()
        if (insErr) throw insErr
        setCompletions(prev => [...prev, inserted])
      }
    } catch (err) {
      alert(`Could not update task: ${err.message}`)
    }
  }

  // Save the note on an existing completion (or create one with status='done' if missing).
  const saveNote = async (itemId, subKey, noteText) => {
    const trimmed = (noteText || '').trim()
    const existing = getCompletion(itemId, subKey)
    if (existing) {
      try {
        const { data: updated, error: updErr } = await supabase
          .from('checklist_completions')
          .update({ note: trimmed || null })
          .eq('id', existing.id)
          .select('*')
          .single()
        if (updErr) throw updErr
        setCompletions(prev => prev.map(c => c.id === existing.id ? updated : c))
      } catch (err) {
        alert(`Could not save note: ${err.message}`)
      }
    } else if (trimmed) {
      // No completion yet but the user wrote a note — implicitly mark Done.
      await setStatus(itemId, subKey, 'done', trimmed)
    }
  }

  // Toggle a task's `active` flag (hide if currently shown, unhide if hidden).
  // Hiding is non-destructive — past completions are preserved, the task just
  // doesn't appear in the daily checklist until the user unhides it.
  const toggleHidden = async (item) => {
    try {
      const nextActive = !item.active
      const { data: updated, error: updErr } = await supabase
        .from('checklist_items')
        .update({ active: nextActive, updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .select('*')
        .single()
      if (updErr) throw updErr
      setItems(prev => prev.map(i => i.id === item.id ? updated : i))
    } catch (err) {
      alert(`Could not ${item.active ? 'hide' : 'unhide'} task: ${err.message}`)
    }
  }

  // Add a brand-new task to a category (used to populate Espargos, or to
  // extend Rabona's list without a migration).
  const addTask = async (category) => {
    const f = addForm[category] || {}
    const name = (f.name || '').trim()
    if (!name) return
    try {
      // Place new task at the end of its category (sort_order = current max + 10).
      const existingInCat = items.filter(i => i.category === category)
      const nextSort = existingInCat.length === 0
        ? 10
        : Math.max(...existingInCat.map(i => i.sort_order)) + 10
      const { data: inserted, error: insErr } = await supabase
        .from('checklist_items')
        .insert([{
          company_id: companyId,
          category,
          name,
          allows_skip: !!f.allows_skip,
          sort_order: nextSort,
        }])
        .select('*')
        .single()
      if (insErr) throw insErr
      setItems(prev => [...prev, inserted])
      setAddForm(prev => ({ ...prev, [category]: { open: false, name: '', allows_skip: false } }))
    } catch (err) {
      alert(`Could not add task: ${err.message}`)
    }
  }

  // ---- Group items by category for rendering ----
  const itemsByCategory = useMemo(() => {
    const g = new Map()
    for (const it of items) {
      if (!g.has(it.category)) g.set(it.category, [])
      g.get(it.category).push(it)
    }
    return g
  }, [items])

  // ---- Aggregate progress (count completed sub-rows for dynamic tasks too) ----
  // Hidden tasks (active=false) are ignored — they don't apply to this company
  // and so don't affect the "done / total" counts.
  const progress = useMemo(() => {
    // Total potential rows = static items + dynamic sub-rows
    let total = 0, done = 0, skipped = 0
    for (const it of items) {
      if (!it.active) continue   // hidden — exclude from progress entirely
      if (it.task_type === 'dynamic_clients_with_expenses') {
        // Each client sub-row counts as one. If there are 0 clients this
        // month, treat the parent as a single auto-done row (no work).
        if (clientExp.length === 0) {
          total += 1
          // Consider it implicitly N/A when there are no clients — no
          // completion row required.
          skipped += 1
        } else {
          total += clientExp.length
          for (const c of clientExp) {
            const comp = getCompletion(it.id, c.client_name)
            if (comp?.status === 'done') done += 1
            else if (comp?.status === 'skipped') skipped += 1
          }
        }
      } else {
        total += 1
        const comp = getCompletion(it.id)
        if (comp?.status === 'done') done += 1
        else if (comp?.status === 'skipped') skipped += 1
      }
    }
    const pending = Math.max(0, total - done - skipped)
    const pct = total === 0 ? 0 : Math.round(((done + skipped) / total) * 100)
    return { total, done, skipped, pending, pct }
  }, [items, completionMap, clientExp])

  // ---- Renderers ----
  // isSubRow is true only for dynamic sub-rows (per client) — those don't get
  // a Hide button because hiding belongs to the parent template item.
  const renderRow = (item, subKey, label, amountSuffix, isSubRow = false) => {
    const comp = getCompletion(item.id, subKey)
    const status = comp?.status
    const noteKey = `${item.id}|${subKey || NO_SUB_KEY}`
    const isNoteOpen = !!noteOpen[noteKey]
    const isHidden = !item.active
    return (
      <div
        className={`checklist-row${isHidden ? ' checklist-row-hidden' : ''}`}
        key={`${item.id}-${subKey || 'static'}`}
      >
        <div className="checklist-row-main">
          {/* Checkbox / status indicator — disabled for hidden items */}
          <input
            type="checkbox"
            className="checklist-checkbox"
            checked={status === 'done'}
            disabled={isHidden}
            onChange={() => setStatus(item.id, subKey, status === 'done' ? null : 'done')}
          />
          <div className="checklist-row-label">
            <span style={{
              textDecoration: status === 'done' ? 'line-through' : 'none',
              color: isHidden ? '#9ca3af'
                : status === 'done' ? '#6b7280'
                : status === 'skipped' ? '#9ca3af'
                : '#111827',
              fontStyle: status === 'skipped' || isHidden ? 'italic' : 'normal',
            }}>
              {label}
            </span>
            {amountSuffix && (
              <span style={{ marginLeft: 8, color: '#374151', fontFamily: 'monospace', fontSize: 13 }}>
                {amountSuffix}
              </span>
            )}
            {isHidden && (
              <span style={{
                marginLeft: 8, padding: '2px 6px', background: '#f3f4f6',
                color: '#6b7280', fontSize: 11, borderRadius: 4,
              }}>
                Hidden
              </span>
            )}
          </div>
          {/* Status badge */}
          {status === 'done' && !isHidden && (
            <span className="status-badge status-done">
              ✓ Done {formatDateTime(comp.completed_at)}
            </span>
          )}
          {status === 'skipped' && !isHidden && (
            <span className="status-badge status-skipped">
              N/A this month
            </span>
          )}
          {/* Skip button (only for skippable items, only when not yet skipped, not hidden) */}
          {item.allows_skip && status !== 'skipped' && !isHidden && (
            <button
              className="row-action"
              onClick={() => setStatus(item.id, subKey, 'skipped')}
              title="Mark as not applicable this month"
            >
              N/A
            </button>
          )}
          {/* Clear button (when something is set, not hidden) */}
          {status && !isHidden && (
            <button
              className="row-action row-action-clear"
              onClick={() => setStatus(item.id, subKey, null)}
              title="Clear this month's status"
            >
              Clear
            </button>
          )}
          {/* Note toggle (not hidden) */}
          {!isHidden && (
            <button
              className="row-action"
              onClick={() => setNoteOpen(prev => ({ ...prev, [noteKey]: !isNoteOpen }))}
              title={comp?.note ? 'View / edit note' : 'Add a note'}
            >
              {comp?.note ? '📝 Note' : '📝'}
            </button>
          )}
          {/* Hide / Unhide — only on parent rows (never on dynamic sub-rows) */}
          {!isSubRow && (
            <button
              className="row-action"
              onClick={() => toggleHidden(item)}
              title={isHidden ? 'Restore this task to the active list' : 'Hide this task — won\'t count toward progress'}
            >
              {isHidden ? '↻ Unhide' : '× Hide'}
            </button>
          )}
        </div>
        {/* Expanded note input (suppressed for hidden) */}
        {isNoteOpen && !isHidden && (
          <div className="checklist-row-note">
            <textarea
              rows={2}
              placeholder="Optional note (auto-saves on blur)…"
              defaultValue={comp?.note || ''}
              onBlur={(e) => saveNote(item.id, subKey, e.target.value)}
              className="form-input"
            />
          </div>
        )}
      </div>
    )
  }

  const renderItem = (item) => {
    // Dynamic Client expense reports: one sub-row per client with reimbursable
    // expenses this month. Show a parent header line, then the sub-rows below.
    if (item.task_type === 'dynamic_clients_with_expenses') {
      if (clientExp.length === 0) {
        return (
          <div className="checklist-row" key={item.id}>
            <div className="checklist-row-main">
              <span style={{ marginRight: 8 }}>·</span>
              <div className="checklist-row-label" style={{ color: '#6b7280', fontStyle: 'italic' }}>
                {item.name} — no clients with reimbursable expenses this month
              </div>
            </div>
          </div>
        )
      }
      return (
        <div key={item.id}>
          <div className="dynamic-parent-header">
            {item.name}
            <span style={{ marginLeft: 8, color: '#6b7280', fontWeight: 400, fontSize: 13 }}>
              ({clientExp.length} {clientExp.length === 1 ? 'client' : 'clients'},
              {' '}total {formatEuro(clientExp.reduce((s, c) => s + c.total, 0))})
            </span>
          </div>
          {clientExp.map(c => renderRow(
            item,
            c.client_name,
            `${c.client_name} Expense Report ${monthName(selectedMonth)} ${selectedYear} — ${formatEuro(c.total)}`,
            null,
            true,  // isSubRow — suppresses the Hide button on per-client rows
          ))}
        </div>
      )
    }
    // Static row
    return renderRow(item, null, item.name, null)
  }

  // ---- Print handler ----
  // Inject a one-shot A4 portrait @page override (same pattern Travel Log /
  // Shareholder Report use) so the checklist prints on portrait paper with
  // page numbering — the global default is landscape. Cleaned up after print.
  const CHECKLIST_PORTRAIT_CSS = `
    @media print {
      @page {
        size: A4 portrait;
        margin: 1.5cm 1cm 1.5cm 1cm;
        @bottom-right {
          content: "Page " counter(page) " of " counter(pages);
          font-size: 10px;
          color: #6b7280;
        }
      }
    }
  `
  // ---- Close / Unlock period handlers ----
  // Close: simple confirm dialog. Sets a closed_periods row → app-wide
  // banner appears + all edit affordances on every page become disabled.
  const handleClosePeriod = async () => {
    if (!companyId || lockBusy) return
    const ok = await confirm({
      title: `Close ${monthName(selectedMonth)} ${selectedYear} for ${selectedCompany}?`,
      message:
        'Closing the period locks ALL data for this company + month:\n\n' +
        '• Expenses (View / Add / Edit) → read-only\n' +
        '• Bank Parser → no Finalize / Bulk Approve / status edits\n' +
        '• Client Invoicing → no invoice CRUD or defer/undo\n' +
        '• Travel Log / Shareholder Report → no edits\n\n' +
        'The Monthly Checklist itself stays editable so you can still tick or update notes.\n\n' +
        'You can unlock the period later via the Unlock button below.',
      confirmText: 'Close period',
      variant: 'danger',
    })
    if (!ok) return
    try {
      setLockBusy(true)
      await lock.lockPeriod(companyId, selectedYear, selectedMonth)
    } catch (err) {
      alert('Could not close period: ' + (err.message || err))
    } finally {
      setLockBusy(false)
    }
  }

  // Unlock: requires the user to type "UNLOCK <MONTH> <YEAR>" verbatim.
  // No drive-by clicks possible.
  const unlockExpectedToken = `UNLOCK ${monthName(selectedMonth).toUpperCase()} ${selectedYear}`
  const handleUnlockConfirm = async () => {
    if (!companyId || lockBusy) return
    if (unlockingTyped.trim().toUpperCase() !== unlockExpectedToken) return
    try {
      setLockBusy(true)
      await lock.unlockPeriod(companyId, selectedYear, selectedMonth)
      setUnlockingOpen(false)
      setUnlockingTyped('')
    } catch (err) {
      alert('Could not unlock period: ' + (err.message || err))
    } finally {
      setLockBusy(false)
    }
  }

  const handlePrint = () => {
    const styleEl = document.createElement('style')
    styleEl.textContent = CHECKLIST_PORTRAIT_CSS
    document.head.appendChild(styleEl)
    const cleanup = () => {
      styleEl.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  // ---- Render ----
  if (loading) return <div className="loading">Loading checklist…</div>
  if (error) return <div className="error">{error}</div>

  return (
    <div className="monthly-checklist">
      {/* Print toolbar — hidden in print via .no-print. */}
      <div className="action-bar no-print">
        <button onClick={handlePrint} className="toolbar-btn primary" title="Print the cover page for the physical document folder (heading + ticked-contents list).">
          🖨 Print Cover Page
        </button>
        {/* Close / Unlock period — the workflow endpoint of month-end close.
            Locking flips every page into read-only for this (company, month, year)
            via the LockContext + lock-banner. Unlocking is intentionally harder
            (type-to-confirm) so it can't happen by accident. */}
        {!lock.isCurrentLocked ? (
          <button
            onClick={handleClosePeriod}
            disabled={lockBusy || !companyId}
            className="toolbar-btn"
            style={{ background: '#fef3c7', borderColor: '#fcd34d', color: '#92400e' }}
            title="Mark this month as closed — locks all data editing for this company + month across every tab."
          >
            🔒 Close Period
          </button>
        ) : (
          <button
            onClick={() => { setUnlockingOpen(true); setUnlockingTyped('') }}
            disabled={lockBusy || !companyId}
            className="toolbar-btn"
            style={{ background: '#fee2e2', borderColor: '#fca5a5', color: '#991b1b' }}
            title="Unlock this month so edits are allowed again. Requires typing the exact unlock phrase to confirm."
          >
            🔓 Unlock Period
          </button>
        )}
      </div>

      {/* Unlock confirm modal — type-to-confirm pattern. The expected
          token is "UNLOCK <MONTH NAME> <YEAR>" e.g. "UNLOCK MARCH 2026".
          Comparison is case-insensitive and trimmed but otherwise exact. */}
      {unlockingOpen && (
        <div className="modal-overlay no-print" onClick={() => !lockBusy && setUnlockingOpen(false)}>
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>🔓 Unlock {monthName(selectedMonth)} {selectedYear}?</h3>
              <button className="modal-close" onClick={() => !lockBusy && setUnlockingOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ padding: 18 }}>
              <p style={{ marginTop: 0, fontSize: 14, color: '#374151', lineHeight: 1.5 }}>
                Unlocking this period for <strong>{selectedCompany}</strong> will allow edits, saves, and deletes again on every tab.
              </p>
              <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                To confirm, type this exact phrase below (no quotes):
              </p>
              <div style={{
                background: '#f3f4f6', padding: '8px 12px', borderRadius: 4,
                fontFamily: 'monospace', fontSize: 14, color: '#1f2937',
                marginBottom: 10, userSelect: 'all',
              }}>
                {unlockExpectedToken}
              </div>
              <input
                type="text"
                autoFocus
                value={unlockingTyped}
                onChange={(e) => setUnlockingTyped(e.target.value)}
                placeholder="Type the phrase above to enable Unlock"
                className="form-input"
                style={{ width: '100%' }}
                disabled={lockBusy}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button
                  onClick={() => { setUnlockingOpen(false); setUnlockingTyped('') }}
                  className="btn-secondary"
                  disabled={lockBusy}
                >
                  Cancel
                </button>
                <button
                  onClick={handleUnlockConfirm}
                  className="button"
                  style={{
                    background: unlockingTyped.trim().toUpperCase() === unlockExpectedToken ? '#dc2626' : '#9ca3af',
                    color: 'white',
                    cursor: unlockingTyped.trim().toUpperCase() === unlockExpectedToken ? 'pointer' : 'not-allowed',
                  }}
                  disabled={lockBusy || unlockingTyped.trim().toUpperCase() !== unlockExpectedToken}
                >
                  {lockBusy ? '⏳ Unlocking…' : '🔓 Unlock'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {confirmModal}

      {/* Unified letterhead — visible on screen AND in print. Heading is just
          the company name + the selected month/year; both auto-fill from the
          top-bar selectors. */}
      <PrintLetterhead
        companyName={selectedCompany}
        reportTitle={`${monthName(selectedMonth)} ${selectedYear}`}
      />

      {/* ===== FOLDER COVER PAGE =====
          Independent of the task list. Tick the items that are included in
          the physical document folder for this month; the Print button at
          the top prints THIS block (with the letterhead above it) and
          nothing else. State is persisted per (company, year, month) in
          localStorage — no DB migration needed; this is a printing aid
          rather than an accounting record. */}
      <div className={`cover-page${coverExpanded ? '' : ' is-collapsed'}`}>
        <button
          type="button"
          className="cover-page-title cover-page-toggle"
          onClick={() => setCoverExpanded(v => !v)}
          aria-expanded={coverExpanded}
          title={coverExpanded ? 'Hide the folder cover page' : 'Show the folder cover page'}
        >
          <span className="cover-page-toggle-chevron">{coverExpanded ? '▾' : '▸'}</span>
          Physical document folder — contents
        </button>

        {/* 1. Summary (Dashboard printout) */}
        <div className="cover-page-section">
          <label className="cover-page-row">
            <input
              type="checkbox"
              checked={!!coverChecks.summary}
              onChange={() => toggleCoverCheck('summary')}
            />
            <span className="cover-page-row-label">Summary</span>
          </label>
        </div>

        {/* 2. Bank Statement — Current Account (always) + Mastercard Account
              (Rabona only — Espargos has no Mastercard). */}
        <div className="cover-page-section">
          <div className="cover-page-parent-label">Bank Statement</div>
          <label className="cover-page-row is-sub">
            <input
              type="checkbox"
              checked={!!coverChecks.bank_current}
              onChange={() => toggleCoverCheck('bank_current')}
            />
            <span className="cover-page-row-label">{selectedCompany} Current Account</span>
          </label>
          {selectedCompany !== 'Espargos' && (
            <label className="cover-page-row is-sub">
              <input
                type="checkbox"
                checked={!!coverChecks.bank_mastercard}
                onChange={() => toggleCoverCheck('bank_mastercard')}
              />
              <span className="cover-page-row-label">{selectedCompany} Mastercard Account</span>
            </label>
          )}
        </div>

        {/* 3. Expenses — subheading with the expense chart + supporting
              invoice/receipt copies. Both apply to every company. */}
        <div className="cover-page-section">
          <div className="cover-page-parent-label">Expenses</div>
          <label className="cover-page-row is-sub">
            <input
              type="checkbox"
              checked={!!coverChecks.expense_chart}
              onChange={() => toggleCoverCheck('expense_chart')}
            />
            <span className="cover-page-row-label">{selectedCompany} Expense Chart</span>
          </label>
          <label className="cover-page-row is-sub">
            <input
              type="checkbox"
              checked={!!coverChecks.invoice_receipt_copies}
              onChange={() => toggleCoverCheck('invoice_receipt_copies')}
            />
            <span className="cover-page-row-label">Copies of invoices and receipts</span>
          </label>
        </div>

        {/* 4. Reimbursements — one row per client with reimbursable expenses
              this month. Pulled from clientExp (the same source the existing
              dynamic_clients_with_expenses task uses). */}
        <div className="cover-page-section">
          <div className="cover-page-parent-label">Reimbursements — Client Expense Reports</div>
          {clientExp.length === 0 ? (
            <div className="cover-page-empty">
              No clients with reimbursable expenses this month.
            </div>
          ) : (
            clientExp.map(c => {
              const key = `reimbursement:${c.client_name}`
              return (
                <label className="cover-page-row is-sub" key={key}>
                  <input
                    type="checkbox"
                    checked={!!coverChecks[key]}
                    onChange={() => toggleCoverCheck(key)}
                  />
                  <span className="cover-page-row-label">
                    {c.client_name} Expense Report {monthName(selectedMonth)} {selectedYear} — {formatEuro(c.total)}
                  </span>
                </label>
              )
            })
          )}
        </div>

        {/* 5. Invoicing — small subheading with two tickable sub-rows:
              (a) the physical Invoices Issued Chart/report, and
              (b) confirmation that the issued invoices have been sent by
                  email to the clients.
              The detailed invoice list lives in the chart itself, so we
              don't repeat it here. When no invoices were issued, both
              sub-rows are replaced with a single informational note. */}
        <div className="cover-page-section">
          <div className="cover-page-parent-label">Invoicing</div>
          {invoicesIssued.length === 0 ? (
            <div className="cover-page-empty">
              No invoices issued this month.
            </div>
          ) : (
            <>
              <label className="cover-page-row is-sub">
                <input
                  type="checkbox"
                  checked={!!coverChecks.invoices_chart}
                  onChange={() => toggleCoverCheck('invoices_chart')}
                />
                <span className="cover-page-row-label">{selectedCompany} Invoices Issued Chart</span>
              </label>
              <label className="cover-page-row is-sub">
                <input
                  type="checkbox"
                  checked={!!coverChecks.invoices_emailed}
                  onChange={() => toggleCoverCheck('invoices_emailed')}
                />
                <span className="cover-page-row-label">Invoices issued current month sent by email</span>
              </label>
            </>
          )}
        </div>

        {/* 6. Travel Expenses — YK Log, BK Log, Prepaid (Rabona only —
              Espargos shareholders don't travel under that company). */}
        {selectedCompany !== 'Espargos' && (
          <div className="cover-page-section">
            <div className="cover-page-parent-label">Travel Expenses</div>
            <label className="cover-page-row is-sub">
              <input
                type="checkbox"
                checked={!!coverChecks.travel_yk}
                onChange={() => toggleCoverCheck('travel_yk')}
              />
              <span className="cover-page-row-label">YK Travel Log</span>
            </label>
            <label className="cover-page-row is-sub">
              <input
                type="checkbox"
                checked={!!coverChecks.travel_bk}
                onChange={() => toggleCoverCheck('travel_bk')}
              />
              <span className="cover-page-row-label">BK Travel Log</span>
            </label>
            <label className="cover-page-row is-sub">
              <input
                type="checkbox"
                checked={!!coverChecks.travel_prepaid}
                onChange={() => toggleCoverCheck('travel_prepaid')}
              />
              <span className="cover-page-row-label">Pre-paid / Unassigned Travel Expenses</span>
            </label>
          </div>
        )}

        {/* 6. Shareholder Reports — YK and BK */}
        <div className="cover-page-section">
          <div className="cover-page-parent-label">Shareholder Reports</div>
          <label className="cover-page-row is-sub">
            <input
              type="checkbox"
              checked={!!coverChecks.shareholder_yk}
              onChange={() => toggleCoverCheck('shareholder_yk')}
            />
            <span className="cover-page-row-label">YK Shareholder Report</span>
          </label>
          <label className="cover-page-row is-sub">
            <input
              type="checkbox"
              checked={!!coverChecks.shareholder_bk}
              onChange={() => toggleCoverCheck('shareholder_bk')}
            />
            <span className="cover-page-row-label">BK Shareholder Report</span>
          </label>
        </div>
      </div>

      <div className="checklist-header no-print">
        <div>
          <h2 style={{ margin: 0 }}>
            📋 Monthly Checklist — {selectedCompany} · {monthName(selectedMonth)} {selectedYear}
          </h2>
          <div style={{ color: '#6b7280', marginTop: 4, fontSize: 13 }}>
            {progress.done} of {progress.total} done · {progress.skipped} N/A · {progress.pending} pending
          </div>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
          <div className="progress-label">{progress.pct}%</div>
        </div>
      </div>

      {/* If this company has no items yet, show an empty-state helper. */}
      {items.length === 0 && (
        <div className="empty-state no-print">
          <p><strong>No checklist items yet for {selectedCompany}.</strong></p>
          <p>Use the "+ Add task" form under each section to build the list.</p>
        </div>
      )}

      {/* Render each category section in order, skipping empty ones (unless
          empty-state above already handled the no-items case). */}
      {CATEGORY_ORDER.map(cat => {
        const catItems = itemsByCategory.get(cat) || []
        const visibleItems = catItems.filter(i => i.active)
        const hiddenItems  = catItems.filter(i => !i.active)
        const sectionShowHidden = !!showHidden[cat]
        // Show the section header + add-task form even for empty categories
        // when this company has SOME items (so user can add per-category).
        const meta = CATEGORY_META[cat]
        const f = addForm[cat] || {}
        return (
          <section
            key={cat}
            className="checklist-section no-print"
            style={{ borderLeft: `4px solid ${meta.accent}` }}
          >
            <div className="checklist-section-header">
              <div>
                <h3 style={{ margin: 0, color: meta.accent }}>{meta.label}</h3>
                <div style={{ color: '#6b7280', fontSize: 12 }}>{meta.subtitle}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {/* Show hidden / Hide hidden toggle (only when there are hidden items) */}
                {hiddenItems.length > 0 && (
                  <button
                    className="row-action"
                    onClick={() => setShowHidden(prev => ({ ...prev, [cat]: !prev[cat] }))}
                    title={sectionShowHidden ? 'Hide the hidden tasks again' : `Reveal ${hiddenItems.length} hidden task${hiddenItems.length === 1 ? '' : 's'}`}
                  >
                    {sectionShowHidden
                      ? `↑ Hide ${hiddenItems.length} hidden`
                      : `↓ Show ${hiddenItems.length} hidden`}
                  </button>
                )}
                <button
                  className="row-action"
                  onClick={() => setAddForm(prev => ({
                    ...prev,
                    [cat]: { ...(prev[cat] || {}), open: !f.open },
                  }))}
                >
                  {f.open ? '× Cancel' : '+ Add task'}
                </button>
              </div>
            </div>

            {/* Inline Add task form */}
            {f.open && (
              <div className="add-task-form">
                <input
                  type="text"
                  placeholder="New task name…"
                  value={f.name || ''}
                  onChange={(e) => setAddForm(prev => ({
                    ...prev,
                    [cat]: { ...prev[cat], name: e.target.value },
                  }))}
                  className="form-input"
                  style={{ flex: 1 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={!!f.allows_skip}
                    onChange={(e) => setAddForm(prev => ({
                      ...prev,
                      [cat]: { ...prev[cat], allows_skip: e.target.checked },
                    }))}
                  />
                  Allows N/A
                </label>
                <button
                  onClick={() => addTask(cat)}
                  className="button"
                  style={{ padding: '6px 12px' }}
                  disabled={!(f.name || '').trim()}
                >
                  Add
                </button>
              </div>
            )}

            {/* Visible (active) items */}
            {visibleItems.length === 0 && !f.open && (
              <div style={{ padding: '12px 8px', color: '#9ca3af', fontStyle: 'italic', fontSize: 13 }}>
                {hiddenItems.length > 0
                  ? `All tasks in this section are hidden. Click "Show ${hiddenItems.length} hidden" above to manage them.`
                  : 'No tasks in this section yet.'}
              </div>
            )}
            {visibleItems.map(renderItem)}

            {/* Hidden items — only rendered when the section toggle is on */}
            {sectionShowHidden && hiddenItems.length > 0 && (
              <div style={{
                marginTop: 8, paddingTop: 8,
                borderTop: '1px dashed #d1d5db',
              }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, fontStyle: 'italic' }}>
                  Hidden tasks (excluded from progress — click ↻ Unhide to bring back):
                </div>
                {hiddenItems.map(renderItem)}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
