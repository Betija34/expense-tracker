import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { PrintLetterhead } from '../PrintLetterhead/PrintLetterhead'
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
  // Cross-period reimbursable totals — populated for deferral SOURCE
  // periods (so when we render Block 4 of March, we know the per-client
  // total from Jan and Feb that's being rolled into March's invoice).
  // Keyed by `${clientNameLower}|${year}|${month}` → { displayName, total }.
  const [reimbursableBySourcePeriod, setReimbursableBySourcePeriod] = useState(new Map())
  // All deferral rows for this company. Small table; load wholesale so
  // we can answer both "what defers OUT of period X" and "what defers
  // INTO period X" without re-querying.
  const [deferrals, setDeferrals] = useState([])
  // Defer-target picker modal state. null = closed. Otherwise:
  //   { client, sourceYear, sourceMonth, targetYear, targetMonth, busy, error }
  const [deferModal, setDeferModal] = useState(null)
  // Invoices for the selected company + month, loaded from V21's invoices
  // table. The page renders ONE row per active client per applicable type;
  // those rows are auto-drafted as placeholders in the UI and only get
  // INSERTed to this list when the user types into any lifecycle field
  // (lazy-create — keeps the DB clean from un-touched draft rows).
  const [invoices, setInvoices]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  // editing = null (closed) | { mode: 'add' | 'edit', client: {...} }
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(BLANK_FORM)
  const [saveError, setSaveError] = useState(null)
  const [saving, setSaving]       = useState(false)
  // One-off invoice modal state. null = closed.
  // Otherwise: { client_id, oneoff_type ('service' | 'reimbursement'),
  //              description, amount_net, vat_rate, notes }
  const [oneOffForm, setOneOffForm]   = useState(null)
  const [oneOffError, setOneOffError] = useState(null)
  // Delete-confirmation modal state. null = closed. Otherwise:
  //   { client, impact: { invoices, expenses }, typed }
  // The user must type the client's trade_name (case-insensitive)
  // before the Delete button enables — guards against accidental clicks.
  const [deleting, setDeleting]       = useState(null)

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
            // Map shape: { displayName, total } per lowercased key. The
            // displayName preserves the original casing from the FIRST
            // expense with that name (so orphan rows can render the name
            // as the user actually typed it on the expense).
            const m = new Map()
            for (const row of (exp || [])) {
              const raw = (row.client_name || '').trim()
              const key = raw.toLowerCase()
              if (!key) continue
              const existing = m.get(key)
              if (existing) {
                existing.total += Math.abs(Number(row.amount) || 0)
              } else {
                m.set(key, { displayName: raw, total: Math.abs(Number(row.amount) || 0) })
              }
            }
            setReimbursableByClient(m)
          }

          // Invoices for the selected month — feeds the lifecycle inputs
          // on each invoice row. Loaded last so all the upstream context
          // (clients, reimbursables) is ready when rows render.
          const { data: inv, error: invErr } = await supabase
            .from('invoices')
            .select('*')
            .eq('company_id', comp.id)
            .eq('period_year', selectedYear)
            .eq('period_month', selectedMonth)
          if (invErr) throw invErr
          if (!cancelled) setInvoices(inv || [])

          // Deferrals for this company. Small table; load all rows and
          // filter in memory by source/target period as needed.
          const { data: defs, error: defErr } = await supabase
            .from('expense_deferrals')
            .select('*')
            .eq('company_id', comp.id)
          if (defErr && defErr.code !== '42P01') throw defErr  // 42P01 = table not yet created (pre-V24)
          if (!cancelled) setDeferrals(defs || [])

          // For any deferral whose TARGET = current period, we also need
          // the reimbursable totals from its SOURCE period to compute
          // the combined invoice amount + breakdown description. Fetch
          // those source-period expenses now (one extra query per source
          // period — usually 0-2 at most).
          const sourcePeriodsToLoad = (defs || [])
            .filter(d => d.target_year === selectedYear && d.target_month === selectedMonth)
            .map(d => `${d.source_year}-${String(d.source_month).padStart(2, '0')}`)
          const uniqSources = Array.from(new Set(sourcePeriodsToLoad))
          if (uniqSources.length > 0) {
            const sourceMap = new Map()
            for (const ym of uniqSources) {
              const [y, mo] = ym.split('-').map(Number)
              const sStart = `${y}-${String(mo).padStart(2, '0')}-01`
              const sEnd   = new Date(y, mo, 0).toISOString().slice(0, 10)
              const { data: srcExp, error: srcErr } = await supabase
                .from('expenses')
                .select('client_name, amount')
                .eq('company_id', comp.id)
                .eq('requires_reimbursement', true)
                .not('client_name', 'is', null)
                .gte('date', sStart)
                .lte('date', sEnd)
              if (srcErr) throw srcErr
              for (const row of (srcExp || [])) {
                const raw = (row.client_name || '').trim()
                const k = `${raw.toLowerCase()}|${y}|${mo}`
                if (!k) continue
                const ex = sourceMap.get(k)
                const val = Math.abs(Number(row.amount) || 0)
                if (ex) ex.total += val
                else sourceMap.set(k, { displayName: raw, total: val })
              }
            }
            if (!cancelled) setReimbursableBySourcePeriod(sourceMap)
          } else {
            if (!cancelled) setReimbursableBySourcePeriod(new Map())
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

  // Combined Project cell: trade_name bold on top, legal_name smaller
  // underneath. Saves a column of horizontal space vs. showing each in
  // its own <td>. Used in every invoice block and the inactive-clients
  // table.
  const renderProjectCell = (c) => (
    <td>
      <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>
        {c?.trade_name || c?.legal_name || '—'}
      </div>
      {c?.trade_name && c?.legal_name && (
        <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.2, marginTop: 1 }}>
          {c.legal_name}
        </div>
      )}
    </td>
  )

  // Helper — get the reimbursable total for a client by trying trade_name
  // first, then falling back to legal_name. Returns 0 when no match.
  // (Map value shape is { displayName, total } — pull .total.)
  const reimbursableFor = (client) => {
    const tradeKey = (client.trade_name || '').trim().toLowerCase()
    const legalKey = (client.legal_name || '').trim().toLowerCase()
    const entry = reimbursableByClient.get(tradeKey)
               || reimbursableByClient.get(legalKey)
    return entry?.total || 0
  }

  // Same as reimbursableFor but for ANY (year, month) — used to look up
  // amounts in deferral SOURCE periods that roll into the current top
  // bar. The data was preloaded into reimbursableBySourcePeriod when
  // the component fetched deferrals.
  const reimbursableForPeriod = (client, year, month) => {
    if (!year || !month) return 0
    // Fast path: if asking about the current top-bar period, use the
    // existing map (avoids a redundant duplicate query).
    if (year === selectedYear && month === selectedMonth) {
      return reimbursableFor(client)
    }
    const tradeKey = (client.trade_name || '').trim().toLowerCase()
    const legalKey = (client.legal_name || '').trim().toLowerCase()
    const k = (key) => `${key}|${year}|${month}`
    const entry = reimbursableBySourcePeriod.get(k(tradeKey))
               || reimbursableBySourcePeriod.get(k(legalKey))
    return entry?.total || 0
  }

  // Deferral lookups — type-aware.
  // outbound: is this client's CURRENT month deferred away to a later
  //   month for the given invoice type? Returns the deferral row, or null.
  // inbound:  which client-source-months defer INTO the current month
  //   for this type? Array of { source_year, source_month, amount, deferral_id }
  //   sorted chronologically.
  // Default invoiceType is 'variable_expense' for backward compatibility
  // with the original V24-era call sites.
  const outboundDeferralFor = (client, invoiceType = 'variable_expense') =>
    deferrals.find(d =>
      d.client_id     === client.id &&
      d.source_year   === selectedYear &&
      d.source_month  === selectedMonth &&
      (d.invoice_type || 'variable_expense') === invoiceType
    ) || null

  const inboundDeferralsFor = (client, invoiceType = 'variable_expense') =>
    deferrals
      .filter(d =>
        d.client_id    === client.id &&
        d.target_year  === selectedYear &&
        d.target_month === selectedMonth &&
        (d.invoice_type || 'variable_expense') === invoiceType
      )
      .map(d => ({
        source_year:  d.source_year,
        source_month: d.source_month,
        amount:       naturalForPeriod(client, d.source_year, d.source_month, invoiceType),
        deferral_id:  d.id,
      }))
      .sort((a, b) =>
        (a.source_year - b.source_year) ||
        (a.source_month - b.source_month)
      )

  // Generic "natural amount this client expects to be billed for this
  // type in this period". Variable expenses come from the expenses
  // table; monthly fee + fixed expense reimbursement are static values
  // on the client record (we treat them as the same value across all
  // periods since no historical rate tracking exists).
  const naturalForPeriod = (client, year, month, invoiceType) => {
    if (invoiceType === 'monthly_fee') {
      return Number(client.monthly_fee_net || 0)
    }
    if (invoiceType === 'fixed_expense') {
      return Number(client.monthly_fixed_expense_net || 0)
    }
    // variable_expense (default)
    return reimbursableForPeriod(client, year, month)
  }

  // Effective amount to bill THIS month for the client (type-aware).
  // Natural top-bar amount is excluded if this month is deferred away
  // — but ANY inbound deferrals from earlier months still count.
  // (User-supported case: "this month I bill Jan + Feb that were
  // deferred in, AND I defer this month's own to a later month.")
  const effectiveAmountFor = (client, invoiceType = 'variable_expense') => {
    const ownNatural =
      invoiceType === 'monthly_fee'   ? Number(client.monthly_fee_net || 0) :
      invoiceType === 'fixed_expense' ? Number(client.monthly_fixed_expense_net || 0) :
      reimbursableFor(client)
    const naturalCounted = outboundDeferralFor(client, invoiceType) ? 0 : ownNatural
    const inbound = inboundDeferralsFor(client, invoiceType).reduce((s, d) => s + d.amount, 0)
    return naturalCounted + inbound
  }
  // Backward-compat alias used by existing variable_expense call sites.
  const effectiveReimbursableFor = (client) => effectiveAmountFor(client, 'variable_expense')

  // Render the per-month breakdown cell content. Used in BOTH placeholder
  // rows and saved DB rows of Block 4 so the user always sees the
  // line-by-line contribution per month (deferred-in + this month's
  // own). Takes an explicit `savedAmount` so DB rows can flag a
  // mismatch if the saved invoice total doesn't match the current
  // breakdown sum (e.g. deferrals changed after the invoice was saved).
  const renderBreakdownCell = (client, savedAmount = null, fallbackText = null, invoiceType = 'variable_expense') => {
    const bk = periodBreakdown(client, invoiceType)
    const periodLbl = (() => {
      if (!selectedMonth || !selectedYear) {
        if (invoiceType === 'monthly_fee')   return 'Monthly fee'
        if (invoiceType === 'fixed_expense') return 'Fixed expense reimbursement'
        return 'Reimbursable expenses'
      }
      const m = monthName(selectedMonth)
      if (invoiceType === 'monthly_fee')   return `${m} ${selectedYear} fee`
      if (invoiceType === 'fixed_expense') return `${m} ${selectedYear} fixed expenses`
      return `${m} ${selectedYear} expenses to be reimbursed`
    })()
    const titleText = fallbackText || periodLbl
    const hasInbound  = bk.items.some(i => i.isDeferred)
    const hasOutbound = !!bk.outbound
    const natural     =
      invoiceType === 'monthly_fee'   ? Number(client.monthly_fee_net || 0) :
      invoiceType === 'fixed_expense' ? Number(client.monthly_fixed_expense_net || 0) :
      reimbursableFor(client)
    // Standalone "this month's natural" info chip — surfaced on saved DB
    // rows whenever the saved invoice amount doesn't match this month's
    // natural reimbursables AND we're not already showing it as outbound.
    // The classic case: Jan saved invoice was for Nov+Dec expenses; Jan's
    // own €284.24 are a SEPARATE amount that the user needs to see so she
    // can decide to defer them or invoice them separately.
    const showNaturalInfo =
      savedAmount != null
      && natural > 0
      && !hasOutbound
      && Math.abs(Number(savedAmount) - natural) > 0.005

    if (!hasInbound && !hasOutbound && !showNaturalInfo) {
      // Nothing special — plain description (saved or generated).
      return <span style={{ fontStyle: 'italic', color: '#374151' }}>{titleText}</span>
    }

    return (
      <div>
        <div style={{ fontStyle: 'italic', color: '#374151' }}>{titleText}</div>

        {/* Inbound breakdown — itemized list of deferred-in months + the
            current month's own natural amount (when not deferred away). */}
        {(hasInbound || (!hasOutbound && natural > 0 && !showNaturalInfo)) && bk.items.length > 0 && (
          <ul style={{ margin: '4px 0 0 0', padding: '0 0 0 4px', listStyle: 'none', fontSize: 11, color: '#374151' }}>
            {bk.items.map((item, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '1px 0' }}>
                <span style={{ color: item.isDeferred ? '#0891b2' : '#111827' }}>
                  {item.isDeferred ? '↪ ' : '· '}
                  {monthName(item.month)} {item.year}
                  {item.isDeferred ? ' (deferred in)' : ' (this month)'}
                </span>
                <span style={{ fontFamily: 'monospace', color: '#374151' }}>{formatEuro(item.amount)}</span>
              </li>
            ))}
            <li style={{
              display: 'flex', justifyContent: 'space-between', gap: 8,
              borderTop: '1px solid #e5e7eb', marginTop: 3, paddingTop: 3,
              fontWeight: 600, color: '#111827',
            }}>
              <span>Total</span>
              <span style={{ fontFamily: 'monospace' }}>{formatEuro(bk.total)}</span>
            </li>
          </ul>
        )}

        {/* Outbound badge — this month's natural was deferred to a later month. */}
        {hasOutbound && (
          <div style={{
            fontSize: 10, color: '#92400e', marginTop: 4,
            background: '#fef3c7', padding: '2px 6px', borderRadius: 3,
          }}>
            ⚠ This month's own expenses ({formatEuro(bk.natural)}) deferred to {monthName(bk.outbound.target_month)} {bk.outbound.target_year}
          </div>
        )}

        {/* Natural-info chip — saved invoice represents some other period;
            this is the actual natural reimbursable for the current month. */}
        {showNaturalInfo && (
          <div style={{
            fontSize: 11, color: '#7c2d12', marginTop: 6,
            background: '#fef3c7', padding: '5px 8px', borderRadius: 4,
            border: '1px solid #fcd34d',
          }}>
            <div style={{ fontWeight: 600 }}>
              📋 {monthName(selectedMonth)} {selectedYear} natural reimbursables: {formatEuro(natural)}
            </div>
            <div style={{ fontSize: 10, marginTop: 2, color: '#92400e' }}>
              Separate from the saved invoice ({formatEuro(savedAmount)}).
              Use <strong>→ Defer</strong> to route them to a future month, or
              <strong> + Add variable reimbursement</strong> to invoice them separately this month.
            </div>
          </div>
        )}
      </div>
    )
  }

  // Per-month breakdown for the description cell — type-aware. Used to
  // render an itemised line-by-line view like:
  //   Jan 2026 (deferred): €500
  //   Feb 2026 (deferred): €700
  //   Mar 2026 (this month): €420
  //   Total:                 €1,620
  const periodBreakdown = (client, invoiceType = 'variable_expense') => {
    const outbound = outboundDeferralFor(client, invoiceType)
    const inbound  = inboundDeferralsFor(client, invoiceType)
    const natural  =
      invoiceType === 'monthly_fee'   ? Number(client.monthly_fee_net || 0) :
      invoiceType === 'fixed_expense' ? Number(client.monthly_fixed_expense_net || 0) :
      reimbursableFor(client)
    const items = []
    for (const d of inbound) {
      if (d.amount > 0) {
        items.push({
          year:       d.source_year,
          month:      d.source_month,
          amount:     d.amount,
          isDeferred: true,
        })
      }
    }
    if (!outbound && natural > 0) {
      items.push({
        year:       selectedYear,
        month:      selectedMonth,
        amount:     natural,
        isDeferred: false,
      })
    }
    const total = items.reduce((s, i) => s + i.amount, 0)
    return { items, total, outbound, natural }
  }
  // Backward-compat alias for existing variable_expense call sites.
  const reimbursableBreakdown = (client) => periodBreakdown(client, 'variable_expense')

  // Auto-build description for a combined invoice (type-aware). Format:
  //   variable_expense → "Jan (€500) + Feb (€700) + Mar (€420) reimbursable expenses"
  //   monthly_fee      → "Jan (€10,000) + Feb (€10,000) + Mar (€10,000) fees"
  // Months listed in chronological order; the current top-bar month is
  // included if its natural amount > 0 AND it isn't deferred away.
  const buildBreakdownDescription = (client, invoiceType = 'variable_expense') => {
    const parts = []
    for (const d of inboundDeferralsFor(client, invoiceType)) {
      if (d.amount > 0) {
        parts.push(`${monthName(d.source_month).slice(0, 3)} (${formatEuro(d.amount)})`)
      }
    }
    const ownNatural =
      invoiceType === 'monthly_fee'   ? Number(client.monthly_fee_net || 0) :
      invoiceType === 'fixed_expense' ? Number(client.monthly_fixed_expense_net || 0) :
      reimbursableFor(client)
    const outbound = outboundDeferralFor(client, invoiceType)
    if (!outbound && ownNatural > 0) {
      parts.push(`${monthName(selectedMonth).slice(0, 3)} (${formatEuro(ownNatural)})`)
    }
    if (parts.length === 0) return null
    const suffix =
      invoiceType === 'monthly_fee'   ? 'fees' :
      invoiceType === 'fixed_expense' ? 'fixed expenses' :
      'reimbursable expenses'
    return `${parts.join(' + ')} ${suffix}`
  }
  // Backward-compat alias used by the legacy variable_expense computeInvoiceDefaults.
  const buildDeferralDescription = (client) => buildBreakdownDescription(client, 'variable_expense')

  // Is a target-month invoice already issued (PF# + Date set)? Used
  // to lock the deferrals feeding into it so they can't be silently
  // re-routed after the invoice is out the door. Type-aware: a
  // monthly_fee deferral's lock check looks at monthly_fee invoices;
  // variable_expense looks at variable_expense invoices.
  const isTargetInvoiceIssued = (client, invoiceType = 'variable_expense') => {
    const inv = invoices.find(i =>
      i.client_id === client.id && i.invoice_type === invoiceType
    )
    return !!(inv && inv.invoice_number && inv.date_issued)
  }

  // Defer-target picker modal handlers. Source month = current top-bar.
  // User picks (target_year, target_month); we INSERT one row into
  // expense_deferrals tagged with the right invoice_type and refresh
  // local state. Type defaults to 'variable_expense' for back-compat
  // (Block 4 callers), and Block 1 passes 'monthly_fee' explicitly.
  const openDeferModal = (client, invoiceType = 'variable_expense') => {
    const nextMonth = selectedMonth === 12 ? 1            : selectedMonth + 1
    const nextYear  = selectedMonth === 12 ? selectedYear + 1 : selectedYear
    setDeferModal({
      client,
      invoiceType,
      sourceYear:  selectedYear,
      sourceMonth: selectedMonth,
      targetYear:  nextYear,
      targetMonth: nextMonth,
      busy:        false,
      error:       null,
    })
  }
  const closeDeferModal = () => setDeferModal(null)

  const saveDeferral = async () => {
    if (!deferModal) return
    const { client, invoiceType, sourceYear, sourceMonth, targetYear, targetMonth } = deferModal
    if (targetYear < sourceYear ||
        (targetYear === sourceYear && targetMonth <= sourceMonth)) {
      setDeferModal(d => d ? { ...d, error: 'Target month must be later than the source month.' } : d)
      return
    }
    setDeferModal(d => d ? { ...d, busy: true, error: null } : d)
    try {
      const { data: inserted, error: insErr } = await supabase
        .from('expense_deferrals')
        .insert([{
          company_id:   companyId,
          client_id:    client.id,
          invoice_type: invoiceType,
          source_year:  sourceYear,
          source_month: sourceMonth,
          target_year:  targetYear,
          target_month: targetMonth,
        }])
        .select('*').single()
      if (insErr) throw insErr
      setDeferrals(prev => [...prev, inserted])
      setDeferModal(null)
    } catch (err) {
      const friendly = err.code === '23505'
        ? 'This client-month already has a deferral of this type. Remove it first or pick a different source month.'
        : err.message
      setDeferModal(d => d ? { ...d, busy: false, error: friendly } : d)
    }
  }

  const removeDeferral = async (deferralId) => {
    try {
      const { error: delErr } = await supabase
        .from('expense_deferrals')
        .delete()
        .eq('id', deferralId)
      if (delErr) throw delErr
      setDeferrals(prev => prev.filter(d => d.id !== deferralId))
    } catch (err) {
      alert(`Could not remove deferral: ${err.message}`)
    }
  }

  // Helper — compute orphan reimbursable expense groups. These are
  // expense client_names that don't match any client record (case-
  // insensitive). They'd otherwise be invisible in Block 4 since the
  // current render iterates over clients. Returns [{ name, total }].
  const orphanReimbursables = useMemo(() => {
    const matchedKeys = new Set()
    for (const c of clients) {
      if (c.trade_name) matchedKeys.add(c.trade_name.trim().toLowerCase())
      if (c.legal_name) matchedKeys.add(c.legal_name.trim().toLowerCase())
    }
    const out = []
    for (const [key, val] of reimbursableByClient.entries()) {
      if (!matchedKeys.has(key)) {
        out.push({ name: val.displayName, total: val.total })
      }
    }
    return out.sort((a, b) => b.total - a.total)
  }, [reimbursableByClient, clients])

  // Create a client record from an orphan reimbursable expense.
  // Used by the "+ Create client" button on orphan rows in Block 4.
  // Opens the full client edit modal pre-filled with the orphan name
  // so the user can fill in legal name, monthly fee, VAT, email chain,
  // notes — the full client profile. After save, the orphan row
  // disappears (matchedKeys recomputes) and Block 4 picks up the
  // reimbursable amount under the new client's real Block 4 row.
  const createClientFromOrphan = (rawName) => {
    if (!rawName?.trim()) return
    const trimmed = rawName.trim()
    setForm({
      ...BLANK_FORM,
      trade_name: trimmed,
      legal_name: trimmed,  // default — user typically edits to the full legal entity name
      active:     true,
      notes:      `Auto-created from orphan reimbursable expense(s) on ${new Date().toISOString().slice(0, 10)}.`,
    })
    setSaveError(null)
    setEditing({ mode: 'add', client: null })
  }

  // ===================================================================
  // INVOICE HELPERS (V21 / Step 2 MVP)
  // ===================================================================
  // Each invoice block (Monthly Fee, Fixed Exp Reimbursement, Variable
  // Exp Reimbursement) shows ONE row per active client. The row is a
  // "placeholder" until the user types into any lifecycle field — then
  // we INSERT the invoice to the DB. Subsequent edits UPDATE in place.

  // Find the DB invoice for a (client, type) — returns null if not yet
  // created (placeholder state).
  const getInvoiceFor = (clientId, invoiceType) =>
    invoices.find(i => i.client_id === clientId && i.invoice_type === invoiceType) || null

  // Compute the auto-filled defaults for a new invoice row based on the
  // client master + invoice type + selected period. Used at INSERT time.
  const computeInvoiceDefaults = (client, invoiceType) => {
    let amount_net = 0
    let vat_rate   = 0
    let description = ''
    if (invoiceType === 'monthly_fee') {
      // Effective amount = natural monthly fee + any inbound deferrals.
      // (Equivalent to a bare monthly_fee_net when no deferrals apply.)
      amount_net  = effectiveAmountFor(client, 'monthly_fee')
      vat_rate    = Number(client.vat_rate || 0)
      // Auto-build "Jan + Feb + Mar 2026 fees" when deferrals contribute.
      description = buildBreakdownDescription(client, 'monthly_fee')
                 || `${monthName(selectedMonth)} ${selectedYear} fee`
    } else if (invoiceType === 'fixed_expense') {
      // Effective amount = natural fixed expense + any inbound deferrals.
      amount_net  = effectiveAmountFor(client, 'fixed_expense')
      vat_rate    = 0  // reimbursements never carry VAT (pass-through cost)
      description = buildBreakdownDescription(client, 'fixed_expense')
                 || `${monthName(selectedMonth)} ${selectedYear} fixed expenses`
    } else if (invoiceType === 'variable_expense') {
      // Effective amount = natural top-bar amount + any inbound deferrals
      // rolled into this month from earlier source months.
      amount_net  = effectiveReimbursableFor(client)
      vat_rate    = 0
      // When deferrals contribute, auto-build a breakdown description
      // like "Jan (€500) + Feb (€700) + Mar (€420) reimbursable expenses".
      // Falls back to the plain period label when no deferrals apply.
      description = buildDeferralDescription(client)
                 || `${monthName(selectedMonth)} ${selectedYear} expenses to be reimbursed`
    }
    return {
      company_id:    companyId,
      client_id:     client.id,
      period_year:   selectedYear,
      period_month:  selectedMonth,
      invoice_type:  invoiceType,
      description,
      amount_net,
      vat_rate,
      amount_total:  amount_net * (1 + vat_rate),
      status:        'planned',
    }
  }

  // Patch one or more fields on an invoice row. INSERTs the row if it
  // doesn't exist yet (lazy-create), UPDATEs in place if it does.
  // Pass `null` for a field to clear it (used when un-ticking a SOA box).
  const upsertInvoice = async (client, invoiceType, patch) => {
    try {
      const existing = getInvoiceFor(client.id, invoiceType)
      const stamped  = { ...patch, updated_at: new Date().toISOString() }
      // Recompute amount_total whenever amount_net or vat_rate change.
      if (Object.prototype.hasOwnProperty.call(stamped, 'amount_net') ||
          Object.prototype.hasOwnProperty.call(stamped, 'vat_rate')) {
        const baseRow = existing || computeInvoiceDefaults(client, invoiceType)
        const nextNet = stamped.amount_net != null ? Number(stamped.amount_net) : Number(baseRow.amount_net || 0)
        const nextVat = stamped.vat_rate != null   ? Number(stamped.vat_rate)   : Number(baseRow.vat_rate   || 0)
        stamped.amount_total = nextNet * (1 + nextVat)
      }
      if (existing) {
        const { data: updated, error: updErr } = await supabase
          .from('invoices').update(stamped).eq('id', existing.id).select('*').single()
        if (updErr) throw updErr
        setInvoices(prev => prev.map(i => i.id === updated.id ? updated : i))
      } else {
        const defaults = computeInvoiceDefaults(client, invoiceType)
        const { data: inserted, error: insErr } = await supabase
          .from('invoices').insert([{ ...defaults, ...stamped }]).select('*').single()
        if (insErr) throw insErr
        setInvoices(prev => [...prev, inserted])
      }
    } catch (err) {
      alert(`Could not save: ${err.message}`)
    }
  }

  // Derive the human-readable status badge label from which lifecycle
  // fields are filled. The DB also stores a status string but the UI
  // computes from fields directly so the user always sees ground truth.
  const deriveStatus = (invoice) => {
    if (!invoice) return { label: 'Pending', cls: 'status-pending' }
    if (invoice.status === 'skipped') return { label: 'Skipped', cls: 'status-skipped-badge' }
    if (invoice.status === 'voided')  return { label: 'Voided',  cls: 'status-voided' }
    if (invoice.soa_updated_at_payment) return { label: 'Finalized', cls: 'status-finalized' }
    if (invoice.date_paid)              return { label: 'Paid',      cls: 'status-paid' }
    if (invoice.email_sent_at)          return { label: 'Emailed',   cls: 'status-emailed' }
    if (invoice.invoice_number && invoice.date_issued) return { label: 'Issued', cls: 'status-issued' }
    return { label: 'Pending', cls: 'status-pending' }
  }

  // -------------------------------------------------------------------
  // ADD-INVOICE MODAL — unified flow for one-off / fixed / variable invoices
  // -------------------------------------------------------------------
  // Used by Blocks 2 (One-off), 3 (Fixed Exp), and 4 (Variable Exp) to
  // manually add an invoice row. Block 1 (Monthly Fee) doesn't need this
  // path because recurring monthly fee rows auto-draft per active client.
  //
  // The modal's invoice_type field accepts:
  //   - one_off_service        (VAT applies)
  //   - one_off_reimbursement  (no VAT — pass-through)
  //   - fixed_expense          (no VAT — pass-through)
  //   - variable_expense       (no VAT — pass-through)

  // Map of invoice_type → which types carry VAT. Service-style invoices
  // do; pass-through reimbursements don't. Credit notes mirror whatever
  // they're reversing, so they're VAT-capable (user picks the rate in
  // the modal — defaults to 19% but can be set to 0%).
  const TYPE_CARRIES_VAT = {
    monthly_fee:           true,
    one_off_service:       true,
    one_off_reimbursement: false,
    fixed_expense:         false,
    variable_expense:      false,
    credit_note:           true,
    pro_forma:             true,
  }

  // Friendly labels for the type dropdown in the modal.
  const TYPE_LABELS = {
    monthly_fee:           '📄 Monthly Fee (VAT applies)',
    one_off_service:       '💼 One-off Service (VAT applies)',
    one_off_reimbursement: '💵 One-off Reimbursement (no VAT — pass-through)',
    fixed_expense:         '🔁 Fixed Expense Reimbursement (no VAT — pass-through)',
    variable_expense:      '💸 Variable Expense Reimbursement (no VAT — pass-through)',
    credit_note:           '↩️ Credit Note (reverses a previous invoice)',
    pro_forma:             '📋 Pro Forma Invoice (not a tax document — no payment tracking)',
  }

  // Description placeholder text per type — helps the user write a useful
  // description (especially for credit notes which need to reference the
  // original invoice number).
  const TYPE_DESCRIPTION_PLACEHOLDER = {
    monthly_fee:           'e.g. "January 2026 fee (late catch-up)" or "April 2026 fee (advance)"',
    one_off_service:       'e.g. "Special project Q2 — March 2026 advisory work"',
    one_off_reimbursement: 'e.g. "One-time travel cost advance"',
    fixed_expense:         'e.g. "Late catch-up — November 2025 fixed expenses"',
    variable_expense:      'e.g. "January 2026 reimbursable expenses"',
    credit_note:           'e.g. "Credit note for invoice 2026-001 — overcharge correction"',
    pro_forma:             'e.g. "Pro forma — Q3 advisory engagement, awaiting client approval"',
  }

  // Open the modal pre-filled. typePrefill controls which invoice type is
  // selected by default (matches the block the user clicked Add from).
  //
  // Filing model: every invoice is saved under the TOP-BAR's selected
  // month/year — i.e. the ISSUE month, not the period the invoice covers.
  // Reason (user clarification, May 22 session): VIES + VAT reporting
  // happen in the month the invoice was issued, regardless of which
  // period the invoice describes. So a January fee invoiced in April is
  // filed in April. The "what period does this cover" info lives in the
  // description field (e.g. "January 2026 fee — late catch-up").
  const openOneOffModal = (clientIdPrefill = '', typePrefill = 'one_off_service') => {
    setOneOffError(null)
    setOneOffForm({
      client_id:     clientIdPrefill,
      invoice_type:  typePrefill,
      description:   '',
      amount_net:    '',
      vat_rate:      TYPE_CARRIES_VAT[typePrefill] ? '0.19' : '0',
      notes:         '',
    })
  }
  const closeOneOffModal = () => {
    setOneOffForm(null)
    setOneOffError(null)
  }

  // Save the invoice: validate, INSERT into invoices, refresh state.
  const saveOneOff = async () => {
    setOneOffError(null)
    if (!oneOffForm.client_id) {
      setOneOffError('Please pick a client (or add a new one).'); return
    }
    if (!oneOffForm.description?.trim()) {
      setOneOffError('Description is required.'); return
    }
    const amt = parseFloat(oneOffForm.amount_net)
    if (Number.isNaN(amt) || amt <= 0) {
      setOneOffError('Amount must be greater than zero.'); return
    }
    // Only one_off_service carries VAT; everything else is forced to 0
    // (pass-through cost — see TYPE_CARRIES_VAT above).
    const carriesVat = TYPE_CARRIES_VAT[oneOffForm.invoice_type] === true
    const vat = carriesVat ? parseFloat(oneOffForm.vat_rate || '0') : 0
    if (Number.isNaN(vat) || vat < 0 || vat > 1) {
      setOneOffError('VAT rate must be between 0 and 1 (e.g. 0.19 for 19%).'); return
    }
    // Filing month = the top-bar's selected month/year. Every invoice is
    // filed under the month it's ISSUED in, not the period it covers
    // (period info lives in the description for cases where they differ).
    const row = {
      company_id:    companyId,
      client_id:     oneOffForm.client_id,
      period_year:   selectedYear,
      period_month:  selectedMonth,
      invoice_type:  oneOffForm.invoice_type,
      description:   oneOffForm.description.trim(),
      amount_net:    amt,
      vat_rate:      vat,
      amount_total:  amt * (1 + vat),
      status:        'planned',
      notes:         oneOffForm.notes?.trim() || null,
    }
    try {
      const { data: inserted, error: insErr } = await supabase
        .from('invoices').insert([row]).select('*').single()
      if (insErr) throw insErr
      setInvoices(prev => [...prev, inserted])
      closeOneOffModal()
    } catch (err) {
      setOneOffError(err.message || 'Could not save invoice')
    }
  }

  // Delete an invoice row (with confirm). Used for one-off + any manually
  // added fixed/variable reimbursement rows. Auto-drafted rows from Block
  // 1/3/4 use their own delete flow (none today — they just stay PLANNED).
  const deleteOneOff = async (invoice) => {
    const ok = window.confirm(`Delete this invoice (${invoice.description})? This cannot be undone.`)
    if (!ok) return
    try {
      const { error: delErr } = await supabase
        .from('invoices').delete().eq('id', invoice.id)
      if (delErr) throw delErr
      setInvoices(prev => prev.filter(i => i.id !== invoice.id))
    } catch (err) {
      alert(`Delete failed: ${err.message}`)
    }
  }

  // For one-off rows: a lifecycle-cells renderer that takes the actual
  // invoice row instead of looking it up by (client_id, type). Used in
  // Block 2 because there can be multiple one-off rows per client.
  const renderLifecycleCellsForInvoice = (invoice) => {
    const status = deriveStatus(invoice)
    const patch = (field, value) =>
      supabase.from('invoices').update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', invoice.id).select('*').single()
        .then(({ data, error }) => {
          if (error) { alert(`Save failed: ${error.message}`); return }
          setInvoices(prev => prev.map(i => i.id === data.id ? data : i))
        })
    const handleField = (field, value) => patch(field, value)
    const handleCheckbox = (field, checked) => patch(field, checked ? new Date().toISOString() : null)
    // Per-type prefix: credit notes use "YYYY-", everything else "YYYY-MM-".
    const typePrefix      = prefixForType(invoice.invoice_type)
    const initialSuffix   = extractInvoiceSuffix(invoice.invoice_number || '', invoice.invoice_type)
    // Regex that detects whether the user's input ALREADY contains a
    // valid prefix (so we don't double-prepend). For credit notes, any
    // leading "YYYY-" qualifies; for everything else we need "YYYY-MM-".
    const prefixDetector  = invoice.invoice_type === 'credit_note'
      ? /^\d{4}\s*[-/.]/
      : /^\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]/
    return (
      <>
        <td>
          <div className="invoice-num-wrap">
            <span className="invoice-num-prefix">{typePrefix}</span>
            <input
              type="text"
              className="invoice-num-suffix lifecycle-input-mono"
              placeholder="001"
              defaultValue={initialSuffix}
              onBlur={(e) => {
                const suffix = e.target.value.trim()
                let next = null
                if (suffix) {
                  next = prefixDetector.test(suffix) ? suffix : `${typePrefix}${suffix}`
                }
                if (next) {
                  const v = validateInvoiceNumber(next, invoice.invoice_type)
                  if (!v.ok) {
                    alert(v.error)
                    e.target.value = initialSuffix   // revert
                    return
                  }
                }
                if (next !== (invoice.invoice_number || null)) handleField('invoice_number', next)
              }}
            />
          </div>
        </td>
        <td>
          {renderPeriodDayInput({
            currentValue: invoice.date_issued,
            onSave: (next) => handleField('date_issued', next),
            key: `iss-${invoice.id}`,
          })}
        </td>
        <td style={{ textAlign: 'center' }}>
          <input type="checkbox" checked={!!invoice.soa_updated_at_issue}
            onChange={(e) => handleCheckbox('soa_updated_at_issue', e.target.checked)} />
        </td>
        <td style={{ textAlign: 'center' }}>
          <input type="checkbox" checked={!!invoice.email_sent_at}
            onChange={(e) => handleCheckbox('email_sent_at', e.target.checked)} />
        </td>
        <td>
          {renderFreeDateInput({
            currentValue: invoice.date_paid,
            onSave: (next) => handleField('date_paid', next),
            key: `paid-${invoice.id}`,
          })}
        </td>
        <td style={{ textAlign: 'center' }}>
          <input type="checkbox" checked={!!invoice.soa_updated_at_payment}
            onChange={(e) => handleCheckbox('soa_updated_at_payment', e.target.checked)} />
        </td>
        <td style={{ textAlign: 'center' }}>
          <span className={`status-badge ${status.cls}`}>{status.label}</span>
        </td>
      </>
    )
  }

  // Render the LITE lifecycle cells for a Pro Forma row. Pro formas
  // aren't tax documents — no SOA tracking, no payment columns. We only
  // need: PF# (YYYY-MM-NNN with locked prefix) + Date (locked to top-bar
  // month) + Email-sent checkbox + Status.
  const renderProFormaLifecycleCells = (invoice) => {
    const patch = (field, value) =>
      supabase.from('invoices').update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', invoice.id).select('*').single()
        .then(({ data, error }) => {
          if (error) { alert(`Save failed: ${error.message}`); return }
          setInvoices(prev => prev.map(i => i.id === data.id ? data : i))
        })
    const handleField = (field, value) => patch(field, value)
    const handleCheckbox = (field, checked) => patch(field, checked ? new Date().toISOString() : null)

    const typePrefix     = prefixForType(invoice.invoice_type)
    const initialSuffix  = extractInvoiceSuffix(invoice.invoice_number || '', invoice.invoice_type)
    const prefixDetector = /^\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]/

    // Three-state status: Draft → Issued → Sent (no Paid for pro formas).
    const status = invoice.email_sent_at
      ? { label: 'Sent', cls: 'status-paid' }       // green
      : (invoice.invoice_number && invoice.date_issued
          ? { label: 'Issued', cls: 'status-issued' }   // blue
          : { label: 'Draft',  cls: 'status-pending' }) // grey

    return (
      <>
        <td>
          <div className="invoice-num-wrap">
            <span className="invoice-num-prefix">{typePrefix}</span>
            <input
              type="text"
              className="invoice-num-suffix lifecycle-input-mono"
              placeholder="001"
              defaultValue={initialSuffix}
              onBlur={(e) => {
                const suffix = e.target.value.trim()
                let next = null
                if (suffix) {
                  next = prefixDetector.test(suffix) ? suffix : `${typePrefix}${suffix}`
                }
                if (next) {
                  const v = validateInvoiceNumber(next, invoice.invoice_type)
                  if (!v.ok) {
                    alert(v.error)
                    e.target.value = initialSuffix
                    return
                  }
                }
                if (next !== (invoice.invoice_number || null)) handleField('invoice_number', next)
              }}
            />
          </div>
        </td>
        <td>
          {renderPeriodDayInput({
            currentValue: invoice.date_issued,
            onSave: (next) => handleField('date_issued', next),
            key: `pf-iss-${invoice.id}`,
          })}
        </td>
        <td style={{ textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={!!invoice.email_sent_at}
            onChange={(e) => handleCheckbox('email_sent_at', e.target.checked)}
            title={invoice.email_sent_at
              ? `Sent ${new Date(invoice.email_sent_at).toLocaleString()}`
              : 'Tick when pro forma emailed to client'}
          />
        </td>
        <td style={{ textAlign: 'center' }}>
          <span className={`status-badge ${status.cls}`}>{status.label}</span>
        </td>
      </>
    )
  }

  // -------------------------------------------------------------------
  // VALIDATION — invoice number + issue date must match top-bar period
  // -------------------------------------------------------------------
  // Invoice numbers must start with YYYY[separator]MM[separator] where
  // YYYY/MM are the top-bar values. Issue date must fall within that
  // same month. These rules exist because VIES + VAT reporting use the
  // issue month — letting the user type a Feb invoice number while
  // viewing April would create a filing mismatch.

  const expectedYearMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`

  // --- Period helpers for the prefix UI + date range ---
  // For the locked invoice-number prefix and the date input's min/max range.
  // expectedPrefix renders the literal text "YYYY-MM-" the user sees.
  // periodFirstDay / periodLastDay constrain the date picker so only days
  // within the top-bar month are pickable.
  const expectedPrefix   = `${expectedYearMonth}-`
  const periodFirstDay   = (selectedMonth && selectedYear) ? `${expectedYearMonth}-01` : ''
  const periodLastDay    = (selectedMonth && selectedYear)
    ? new Date(selectedYear, selectedMonth, 0).toISOString().slice(0, 10)  // last day
    : ''

  // Credit notes get a separate numbering scheme — YYYY-NNN (no month).
  // VIES still files them in the month they were issued, but the human-
  // readable sequence runs per year, not per month. Helper returns the
  // prefix shown in the lifecycle UI for any invoice type.
  const prefixForType = (invoiceType) => {
    if (invoiceType === 'credit_note') return `${selectedYear}-`
    return `${expectedYearMonth}-`
  }

  // Extract just the DD part from a YYYY-MM-DD date when it falls in
  // the current top-bar period. Out-of-period values come back as the
  // full string (e.g. legacy data, or a payment received in a different
  // month than the current top-bar) so the input still shows them.
  const extractDayPart = (fullValue) => {
    if (!fullValue) return ''
    const m = String(fullValue).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return String(fullValue)
    const y  = parseInt(m[1])
    const mo = parseInt(m[2])
    if (y === selectedYear && mo === selectedMonth) {
      return m[3]
    }
    return String(fullValue)
  }

  // Render a day-only date input for ISSUE-style dates (locked to the
  // top-bar month/year — used for Issue Date, Pro Forma Date, Credit
  // Note Issue Date). Visual order: [DD input] - MM - YYYY (day first,
  // matching European convention). The MM-YYYY portion is a fixed grey
  // suffix label; the user only types the day.
  //
  // Storage stays as YYYY-MM-DD (Postgres date format) but display
  // reads as DD-MM-YYYY which is what the user reads naturally.
  //
  // Props:
  //   currentValue: 'YYYY-MM-DD' or null (the saved date)
  //   onSave: (newValue: string | null) => void
  //   key: unique React key for the wrap
  const renderPeriodDayInput = ({ currentValue, onSave, key }) => {
    const dayPart = extractDayPart(currentValue || '')
    const isOutOfPeriod = currentValue && dayPart === String(currentValue)
    const periodLastDayNum = new Date(selectedYear, selectedMonth, 0).getDate()
    // Suffix shows "-MM-YYYY" in European order (with leading dash so
    // it visually attaches to the DD input on its left).
    const suffixLabel = `-${String(selectedMonth).padStart(2, '0')}-${selectedYear}`
    return (
      <div className="day-date-wrap" key={key}>
        <input
          type="text"
          inputMode="numeric"
          maxLength={isOutOfPeriod ? 10 : 2}
          className="day-date-input lifecycle-input-mono"
          placeholder="DD"
          defaultValue={dayPart}
          onBlur={(e) => {
            const typed = e.target.value.trim()
            if (!typed) {
              if (currentValue) onSave(null)
              return
            }
            // If the user pasted a full ISO date, accept as-is.
            if (/^\d{4}-\d{2}-\d{2}$/.test(typed)) {
              if (typed !== currentValue) onSave(typed)
              return
            }
            const day = parseInt(typed, 10)
            if (Number.isNaN(day) || day < 1 || day > 31) {
              alert(`Day must be a number between 1 and 31. You typed: "${typed}".`)
              e.target.value = dayPart
              return
            }
            if (day > periodLastDayNum) {
              alert(`${monthName(selectedMonth)} ${selectedYear} only has ${periodLastDayNum} days.\nYou typed: ${day}.`)
              e.target.value = dayPart
              return
            }
            const newValue = `${expectedYearMonth}-${String(day).padStart(2, '0')}`
            if (newValue !== currentValue) onSave(newValue)
          }}
        />
        <span className="day-date-suffix">{suffixLabel}</span>
      </div>
    )
  }

  // Free-form date input for PAYMENT dates. Payments often arrive in a
  // different month than the invoice was issued (a January invoice paid
  // in March, etc.) — so this input does NOT lock to the top-bar period.
  // The user types the full DD-MM-YYYY (slashes also accepted on input
  // for tolerance), and we save back as YYYY-MM-DD internally.
  //
  // Props:
  //   currentValue: 'YYYY-MM-DD' or null
  //   onSave: (newValue: string | null) => void
  //   key: unique React key
  const renderFreeDateInput = ({ currentValue, onSave, key }) => {
    // Display the stored ISO date as DD-MM-YYYY for readability.
    const displayValue = (() => {
      if (!currentValue) return ''
      const m = String(currentValue).match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (!m) return String(currentValue)
      return `${m[3]}-${m[2]}-${m[1]}`
    })()
    return (
      <input
        type="text"
        inputMode="numeric"
        className="lifecycle-input lifecycle-input-mono"
        placeholder="DD-MM-YYYY"
        defaultValue={displayValue}
        key={key}
        style={{ width: 110, textAlign: 'center' }}
        onBlur={(e) => {
          const typed = e.target.value.trim()
          if (!typed) {
            if (currentValue) onSave(null)
            return
          }
          // Accept DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY (lenient on
          // separator). 2-digit year auto-expanded to 20XX.
          const m = typed.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/)
          if (!m) {
            alert(`Invalid date format. Use DD-MM-YYYY (e.g., 15-03-2026).\nYou typed: "${typed}"`)
            e.target.value = displayValue
            return
          }
          const day   = parseInt(m[1], 10)
          const month = parseInt(m[2], 10)
          let year    = parseInt(m[3], 10)
          if (m[3].length === 2) year = 2000 + year
          if (year < 2000 || year > 2100) {
            alert(`Year ${year} seems out of range (expected 2000-2100).`)
            e.target.value = displayValue
            return
          }
          if (month < 1 || month > 12) {
            alert(`Month must be between 1 and 12. You typed: ${month}.`)
            e.target.value = displayValue
            return
          }
          const lastDay = new Date(year, month, 0).getDate()
          if (day < 1 || day > lastDay) {
            alert(`${monthName(month)} ${year} only has ${lastDay} days.\nYou typed day ${day}.`)
            e.target.value = displayValue
            return
          }
          const isoValue = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          if (isoValue !== currentValue) onSave(isoValue)
        }}
      />
    )
  }

  // Given a full invoice number, return just the suffix the user types.
  // Behavior depends on invoice_type:
  //   - credit_note: "2026-001" → "001"
  //   - everything else: "2026-02-001" → "001"
  // If the stored value doesn't match the current top-bar period (e.g.
  // legacy credit notes still in YYYY-MM-NNN), returns the full value
  // so it stays visible and the validation can fire on next save.
  const extractInvoiceSuffix = (fullValue, invoiceType) => {
    if (!fullValue) return ''
    const trimmed = String(fullValue).trim()
    if (invoiceType === 'credit_note') {
      // YYYY-SEQ (where SEQ can itself contain anything — including legacy
      // MM-NNN from before the format change). Only strip the leading year
      // if it matches the top-bar year.
      const m = trimmed.match(/^(\d{4})\s*[-/.]\s*(.+)$/)
      if (!m) return trimmed
      const y = parseInt(m[1])
      if (y === selectedYear) return m[2].trim()
      return trimmed
    }
    const m = trimmed.match(/^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(.+)$/)
    if (!m) return trimmed
    const y  = parseInt(m[1])
    const mo = parseInt(m[2])
    if (y === selectedYear && mo === selectedMonth) {
      return m[3].trim()
    }
    return trimmed
  }

  const validateInvoiceNumber = (value, invoiceType) => {
    if (!value || !String(value).trim()) return { ok: true }
    const trimmed = String(value).trim()

    if (invoiceType === 'credit_note') {
      // YYYY-NNN format only checks the year matches the top bar.
      // The sequence portion is free text (the user may use "001" or
      // "CN-12" or whatever convention they've used historically).
      const m = trimmed.match(/^(\d{4})\s*[-/.]\s*(.+)$/)
      if (!m) {
        return {
          ok: false,
          error: `Credit note number must start with the year.\nExpected format: ${selectedYear}-001 (separators: - / .)`,
        }
      }
      const y = parseInt(m[1])
      if (y !== selectedYear) {
        return {
          ok: false,
          error: `Credit note year is ${y} but the top bar is on ${selectedYear}.\nSwitch the top bar to ${y} or correct the credit note number.`,
        }
      }
      return { ok: true }
    }

    // Lenient on separators: accept "-", "/", "." between year/month/seq.
    const m = trimmed.match(/^(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(.+)$/)
    if (!m) {
      return {
        ok: false,
        error: `Invoice number must include year + month from the top bar.\nExpected format: ${expectedYearMonth}-001 (separators: - / .)`,
      }
    }
    const y  = parseInt(m[1])
    const mo = parseInt(m[2])
    if (y !== selectedYear) {
      return {
        ok: false,
        error: `Invoice number year is ${y} but the top bar is on ${selectedYear}.\nSwitch the top bar to ${y} or correct the invoice number.`,
      }
    }
    if (mo !== selectedMonth) {
      return {
        ok: false,
        error: `Invoice number month is ${String(mo).padStart(2, '0')} (${monthName(mo)}) but the top bar is on ${String(selectedMonth).padStart(2, '0')} (${monthName(selectedMonth)}).\nSwitch the top bar or correct the invoice number.`,
      }
    }
    return { ok: true }
  }

  const validateIssueDate = (value) => {
    if (!value) return { ok: true }
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return { ok: false, error: 'Invalid date format.' }
    const y  = parseInt(m[1])
    const mo = parseInt(m[2])
    if (y !== selectedYear || mo !== selectedMonth) {
      return {
        ok: false,
        error: `Issue Date must fall within ${monthName(selectedMonth)} ${selectedYear} (the top-bar period).\nTo file an invoice under a different month, switch the top bar first.`,
      }
    }
    return { ok: true }
  }

  // Render the 6 inline-editable lifecycle cells for one invoice row.
  // Used by Blocks 1 (Monthly Fee), 3 (Fixed Exp), and 4 (Variable Exp).
  // For checkboxes, ticking stores a timestamp; un-ticking sets it to null.
  const renderLifecycleCells = (client, invoiceType) => {
    const inv = getInvoiceFor(client.id, invoiceType)
    const status = deriveStatus(inv)
    const handleField = (field, value) => upsertInvoice(client, invoiceType, { [field]: value })
    const handleCheckbox = (field, checked) =>
      upsertInvoice(client, invoiceType, { [field]: checked ? new Date().toISOString() : null })
    // Suffix-only editing — the YYYY-MM- prefix is rendered as a fixed
    // label so the user only types the trailing sequence (e.g., "001").
    // If the stored value has a different period (legacy), the suffix
    // helper returns the full value so it stays editable.
    // This per-client renderer is only used by Blocks 1/3/4 — never for
    // credit notes (handled by renderLifecycleCellsForInvoice) — so the
    // prefix is always YYYY-MM-. Passing invoiceType keeps things future
    // proof if we ever wire a credit-note-style type through here.
    const initialSuffix = extractInvoiceSuffix(inv?.invoice_number || '', invoiceType)
    return (
      <>
        <td>
          <div className="invoice-num-wrap">
            <span className="invoice-num-prefix">{expectedPrefix}</span>
            <input
              type="text"
              className="invoice-num-suffix lifecycle-input-mono"
              placeholder="001"
              defaultValue={initialSuffix}
              onBlur={(e) => {
                const suffix = e.target.value.trim()
                // Empty suffix = clear the invoice number.
                // If the user pasted a full "YYYY-MM-SEQ", keep it as-is
                // (validate against period); otherwise rebuild with prefix.
                let next = null
                if (suffix) {
                  next = /^\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]/.test(suffix)
                    ? suffix
                    : `${expectedPrefix}${suffix}`
                }
                if (next) {
                  const v = validateInvoiceNumber(next, invoiceType)
                  if (!v.ok) {
                    alert(v.error)
                    e.target.value = initialSuffix   // revert
                    return
                  }
                }
                if (next !== (inv?.invoice_number || null)) handleField('invoice_number', next)
              }}
            />
          </div>
        </td>
        <td>
          {renderPeriodDayInput({
            currentValue: inv?.date_issued,
            onSave: (next) => handleField('date_issued', next),
            key: `iss-${client.id}-${invoiceType}`,
          })}
        </td>
        <td style={{ textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={!!inv?.soa_updated_at_issue}
            onChange={(e) => handleCheckbox('soa_updated_at_issue', e.target.checked)}
            title={inv?.soa_updated_at_issue
              ? `Ticked ${new Date(inv.soa_updated_at_issue).toLocaleString()}`
              : 'Tick when SOA updated after issuing'}
          />
        </td>
        <td style={{ textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={!!inv?.email_sent_at}
            onChange={(e) => handleCheckbox('email_sent_at', e.target.checked)}
            title={inv?.email_sent_at
              ? `Sent ${new Date(inv.email_sent_at).toLocaleString()}`
              : 'Tick when email sent to client'}
          />
        </td>
        <td>
          {renderFreeDateInput({
            currentValue: inv?.date_paid,
            onSave: (next) => handleField('date_paid', next),
            key: `paid-${client.id}-${invoiceType}`,
          })}
        </td>
        <td style={{ textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={!!inv?.soa_updated_at_payment}
            onChange={(e) => handleCheckbox('soa_updated_at_payment', e.target.checked)}
            title={inv?.soa_updated_at_payment
              ? `Ticked ${new Date(inv.soa_updated_at_payment).toLocaleString()}`
              : 'Tick when SOA updated after payment received'}
          />
        </td>
        <td style={{ textAlign: 'center' }}>
          <span className={`status-badge ${status.cls}`}>{status.label}</span>
        </td>
      </>
    )
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

    // Duplicate-project guard. trade_name is unique per company
    // (case-insensitive) — enforced by V22's partial unique index but
    // we check in the app first so the user gets a friendly message
    // instead of a raw DB constraint error. legal_name is allowed to
    // repeat (e.g. one legal entity with multiple project aliases).
    const tradeName = form.trade_name?.trim() || null
    if (tradeName) {
      const existingDup = clients.find(c =>
        c.trade_name &&
        c.trade_name.trim().toLowerCase() === tradeName.toLowerCase() &&
        (editing.mode === 'add' || c.id !== editing.client.id)
      )
      if (existingDup) {
        setSaveError(
          `A project named "${existingDup.trade_name}" already exists for ${selectedCompany}`
          + (existingDup.active ? '.' : ' (currently inactive — scroll to the Inactive section at the bottom).')
          + ' Project names must be unique per company.'
        )
        return
      }
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
      // Friendlier error if the DB's unique constraint fires (V22) —
      // happens if a concurrent insert sneaks in or if local state was
      // stale. The PostgREST error code for unique violation is 23505.
      const msg = err.message || ''
      if (err.code === '23505' || /unique|duplicate/i.test(msg)) {
        setSaveError(
          `A project with this name already exists for ${selectedCompany}.\n`
          + 'Project names must be unique per company. Refresh the page and check the Inactive section at the bottom.'
        )
      } else {
        setSaveError(msg || 'Save failed')
      }
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

  // ---- Delete with type-to-confirm modal ----
  // Opens the modal, gathers impact stats (how many invoices will cascade,
  // how many free-text expenses will become orphans), and requires the user
  // to type the client name before the Delete button enables.
  const openDeleteModal = async (client) => {
    // Open immediately with loading impact so the modal feels responsive;
    // fetch stats in the background and patch them in when ready.
    setDeleting({
      client,
      typed: '',
      impact: null,   // null = still loading
      busy: false,
      error: null,
    })
    try {
      const trade = (client.trade_name || '').trim()
      const legal = (client.legal_name || '').trim()
      // Count linked invoices (ON DELETE CASCADE will sweep these).
      const { count: invoiceCount, error: invErr } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
      if (invErr) throw invErr
      // Count free-text expense rows that reference this client by name
      // (these will become orphans — the row stays, but no client card
      // exists anymore).
      let expenseQuery = supabase
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
      // Match on trade_name first (the canonical name we save against).
      // If trade is empty fall back to legal.
      if (trade) {
        expenseQuery = expenseQuery.ilike('client_name', trade)
      } else if (legal) {
        expenseQuery = expenseQuery.ilike('client_name', legal)
      } else {
        expenseQuery = expenseQuery.eq('id', '00000000-0000-0000-0000-000000000000')
      }
      const { count: expenseCount, error: expErr } = await expenseQuery
      if (expErr) throw expErr
      setDeleting(d => d && d.client.id === client.id
        ? { ...d, impact: { invoices: invoiceCount || 0, expenses: expenseCount || 0 } }
        : d)
    } catch (err) {
      setDeleting(d => d && d.client.id === client.id
        ? { ...d, impact: { invoices: 0, expenses: 0 }, error: `Could not load impact: ${err.message}` }
        : d)
    }
  }

  const closeDeleteModal = () => setDeleting(null)

  // Compare typed vs canonical (case-insensitive, trim). For a client with
  // no trade_name we fall back to legal_name as the type-target.
  const deleteConfirmTarget = (client) =>
    (client.trade_name || client.legal_name || '').trim()
  const deleteTypeMatches =
    deleting &&
    deleting.typed.trim().toLowerCase() ===
      deleteConfirmTarget(deleting.client).toLowerCase() &&
    deleteConfirmTarget(deleting.client).length > 0

  const confirmDelete = async () => {
    if (!deleting) return
    if (!deleteTypeMatches) return
    setDeleting(d => ({ ...d, busy: true, error: null }))
    try {
      const { error: delErr } = await supabase
        .from('clients').delete().eq('id', deleting.client.id)
      if (delErr) throw delErr
      setClients(prev => prev.filter(c => c.id !== deleting.client.id))
      setDeleting(null)
    } catch (err) {
      setDeleting(d => d ? { ...d, busy: false, error: `Delete failed: ${err.message}` } : d)
    }
  }

  // Wrapper kept for the existing onClick wiring — opens the modal.
  const handleDelete = (client) => openDeleteModal(client)

  // ---- Progress: % of invoices fully finalized this month ----
  // Mirrors the Monthly Checklist pattern. "Finalized" = all 6 lifecycle
  // fields filled (Inv #, Issue Date, SOA-issue, Email Sent, Payment Date,
  // SOA-payment). Placeholder rows count toward total but never as finalized
  // (they're invoices that haven't been started yet).
  const progress = useMemo(() => {
    // Pro forma rows have a lighter lifecycle (no SOA, no payment) and
    // aren't tax documents — they shouldn't drag the progress %. We
    // count them as "finalized" once PF# + Date + Email ✓ are set.
    // Everything else uses the standard 6-field rule.
    const isFinalized = (inv) => {
      if (inv.invoice_type === 'pro_forma') {
        return !!(inv.invoice_number && inv.date_issued && inv.email_sent_at)
      }
      return !!(inv.invoice_number && inv.date_issued &&
         inv.soa_updated_at_issue && inv.email_sent_at &&
         inv.date_paid && inv.soa_updated_at_payment)
    }

    // Index DB invoices by (type, client_id) so we can quickly tell which
    // clients still need a placeholder row.
    const clientIdsByType = new Map()
    let dbTotal = 0
    let finalized = 0
    for (const inv of invoices) {
      dbTotal += 1
      if (isFinalized(inv)) finalized += 1
      if (!clientIdsByType.has(inv.invoice_type)) clientIdsByType.set(inv.invoice_type, new Set())
      clientIdsByType.get(inv.invoice_type).add(inv.client_id)
    }

    // Placeholders: active clients with defaults whose row hasn't been
    // INSERTed yet for this month. Each counts as 1 row toward total
    // but 0 toward finalized.
    let placeholderTotal = 0
    for (const c of clients) {
      if (!c.active) continue
      if (Number(c.monthly_fee_net || 0) > 0 &&
          !clientIdsByType.get('monthly_fee')?.has(c.id)) {
        placeholderTotal += 1
      }
      if (Number(c.monthly_fixed_expense_net || 0) > 0 &&
          !clientIdsByType.get('fixed_expense')?.has(c.id)) {
        placeholderTotal += 1
      }
      // Use the EFFECTIVE amount (natural + inbound deferrals; 0 if
      // this month is deferred away) so the placeholder count tracks
      // what's actually billable this month.
      if (effectiveReimbursableFor(c) > 0 &&
          !clientIdsByType.get('variable_expense')?.has(c.id)) {
        placeholderTotal += 1
      }
    }

    const total = dbTotal + placeholderTotal
    const pending = total - finalized
    const pct = total === 0 ? 0 : Math.round((finalized / total) * 100)
    return { total, finalized, pending, pct }
    // reimbursableByClient is the underlying state behind reimbursableFor;
    // deferrals + reimbursableBySourcePeriod feed effectiveReimbursableFor.
  }, [invoices, clients, reimbursableByClient, reimbursableBySourcePeriod, deferrals])

  // ---- Print handler — A4 landscape, same pattern as Client Report ----
  const handlePrint = () => {
    const styleEl = document.createElement('style')
    // Tightened margins to maximize printable width (A4 landscape is
    // already only ~28cm wide and the page has ~14 columns). 0.6cm
    // left/right gives an extra 0.8cm of width vs the old 1cm margins,
    // which is enough to stop the rightmost column being clipped.
    // Bottom margin slightly bigger to leave room for the page counter.
    styleEl.textContent = `
      @media print {
        @page {
          size: A4 landscape;
          margin: 0.7cm 0.6cm 1.1cm 0.6cm;
          @bottom-right {
            content: "Page " counter(page) " of " counter(pages);
            font-size: 9px;
            color: #6b7280;
          }
        }
      }
    `
    document.head.appendChild(styleEl)
    const cleanup = () => {
      styleEl.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
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
      {/* Print-only letterhead — visible on paper, hidden on screen. */}
      <div className="print-only">
        <PrintLetterhead
          companyName={selectedCompany}
          reportTitle="Client Invoicing"
          periodLabel={selectedMonth && selectedYear
            ? `Issue period: ${monthName(selectedMonth)} ${selectedYear}`
            : ''}
        />
      </div>

      <div className="clients-header">
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>
            📋 Client Invoicing — {selectedCompany}
            {selectedMonth && selectedYear && (
              <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 16, marginLeft: 8 }}>
                · {monthName(selectedMonth)} {selectedYear}
              </span>
            )}
          </h2>
          <div style={{ color: '#6b7280', marginTop: 4, fontSize: 13 }}>
            {clients.length} clients · {clients.filter(c => c.active).length} active
            {' · '}total monthly billable: <strong>{formatEuro(totalMonthlyBillable)}</strong>
            {selectedMonth && selectedYear && (
              <>
                {' · '}reimbursable in {monthName(selectedMonth)} {selectedYear}:{' '}
                <strong>{formatEuro(totalReimbursable)}</strong>
              </>
            )}
          </div>
          {/* Progress: how many of this month's invoices are fully finalized */}
          <div style={{ marginTop: 8, color: '#374151', fontSize: 13 }}>
            <strong>{progress.finalized} of {progress.total} invoices finalized</strong>
            {progress.pending > 0 && (
              <span style={{ color: '#6b7280', marginLeft: 6 }}>
                · {progress.pending} pending
              </span>
            )}
          </div>
          {/* Green-fill progress bar — same shape as Monthly Checklist */}
          <div className="invoicing-progress-bar">
            <div
              className="invoicing-progress-fill"
              style={{ width: `${progress.pct}%` }}
            />
            <div className="invoicing-progress-label">{progress.pct}%</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <button onClick={handlePrint} className="button" style={{ background: '#475569' }}>
            🖨 Print
          </button>
          <button onClick={openAdd} className="button">+ Add client</button>
        </div>
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
            // All monthly_fee invoices for the selected period
            const dbInvoices = invoices.filter(i => i.invoice_type === 'monthly_fee')
            const clientIdsWithDbRow = new Set(dbInvoices.map(i => i.client_id))
            // Effective placeholder candidates: clients whose effective
            // monthly fee for this period (natural + inbound deferrals)
            // is > 0 AND who don't already have a saved invoice. A client
            // deferred AWAY from this period gets effective = 0 and shows
            // up in the outbound list below instead.
            const placeholderClients = clients
              .filter(c =>
                c.active &&
                effectiveAmountFor(c, 'monthly_fee') > 0 &&
                !clientIdsWithDbRow.has(c.id)
              )
            // Outbound-only: client's monthly fee deferred away AND no
            // inbound + no DB row, so the only thing to surface in this
            // month is the "deferred to X" muted note.
            const outboundClients = clients
              .filter(c =>
                c.active &&
                outboundDeferralFor(c, 'monthly_fee') &&
                effectiveAmountFor(c, 'monthly_fee') === 0 &&
                !clientIdsWithDbRow.has(c.id)
              )
              .map(c => ({ c, deferral: outboundDeferralFor(c, 'monthly_fee') }))
            const clientById = new Map(clients.map(c => [c.id, c]))
            const totalForBlock =
              dbInvoices.reduce((s, i) => s + Number(i.amount_total || 0), 0)
              + placeholderClients.reduce((s, c) => {
                  const eff = effectiveAmountFor(c, 'monthly_fee')
                  return s + eff * (1 + Number(c.vat_rate || 0))
                }, 0)
            const totalRows = placeholderClients.length + dbInvoices.length + outboundClients.length
            return (
              <section className="clients-block clients-block-monthly">
                <div className="clients-block-header">
                  <h3>📄 Monthly Fee Invoices</h3>
                  <div className="block-subtitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {totalRows} row{totalRows === 1 ? '' : 's'} · total <strong>{formatEuro(totalForBlock)}</strong>
                    </span>
                    <button
                      className="button"
                      style={{ padding: '6px 12px' }}
                      onClick={() => openOneOffModal('', 'monthly_fee')}
                      title="Add a monthly fee invoice for a different client, period, or amount (use for arrears or advance billing)"
                    >
                      + Add monthly fee invoice
                    </button>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                <table className="clients-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Description</th>
                      <th style={{ textAlign: 'right' }}>Amount (net)</th>
                      <th style={{ textAlign: 'right' }}>VAT</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th style={{ minWidth: 120 }}>Inv. #</th>
                      <th style={{ minWidth: 150 }}>Issue Date</th>
                      <th title="Statement of Account updated after invoice issued">SOA ✓</th>
                      <th title="Email with invoice sent to client">Email ✓</th>
                      <th style={{ minWidth: 150 }}>Payment Date</th>
                      <th title="Statement of Account updated after payment received">SOA ✓</th>
                      <th>Status</th>
                      <th title="Defer this month's fee to a later month, or undo a deferral">Defer</th>
                      <th>Active</th>
                      <th>Edit / Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Placeholder rows first — one per active client whose
                        effective monthly-fee amount > 0 this period. The
                        effective amount honors any inbound deferrals from
                        earlier months that target this period. */}
                    {placeholderClients.map(c => {
                      const effectiveNet = effectiveAmountFor(c, 'monthly_fee')
                      const vatRate      = Number(c.vat_rate || 0)
                      const total        = effectiveNet * (1 + vatRate)
                      const bk           = periodBreakdown(c, 'monthly_fee')
                      return (
                        <tr key={`placeholder-${c.id}`}>
                          {renderProjectCell(c)}
                          <td>
                            {renderBreakdownCell(c, null, null, 'monthly_fee')}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              type="number" step="0.01" min="0"
                              className="lifecycle-input lifecycle-input-mono"
                              style={{ textAlign: 'right', width: 90 }}
                              defaultValue={effectiveNet}
                              onBlur={(e) => {
                                const next = parseFloat(e.target.value)
                                if (!Number.isNaN(next) && next !== effectiveNet) {
                                  upsertInvoice(c, 'monthly_fee', { amount_net: next, vat_rate: vatRate })
                                }
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {vatRate === 0
                              ? <span style={{ color: '#9ca3af' }}>—</span>
                              : <span style={{ fontSize: 10, color: '#6b7280' }}>{(vatRate * 100).toFixed(0)}%</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                            {formatEuro(total)}
                          </td>
                          {renderLifecycleCells(c, 'monthly_fee')}
                          {/* Defer column — context-aware button. */}
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                            {bk.outbound ? (
                              <button
                                className="row-btn"
                                disabled={isTargetInvoiceIssued(c, 'monthly_fee')}
                                title={isTargetInvoiceIssued(c, 'monthly_fee')
                                  ? `Locked — ${monthName(bk.outbound.target_month)} ${bk.outbound.target_year} invoice already issued.`
                                  : `Cancel deferral`}
                                style={{ fontSize: 11, padding: '3px 6px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4 }}
                                onClick={() => {
                                  if (isTargetInvoiceIssued(c, 'monthly_fee')) return
                                  if (window.confirm(`Undo the monthly-fee deferral of ${monthName(selectedMonth)} ${selectedYear} for ${c.trade_name || c.legal_name}?`)) {
                                    removeDeferral(bk.outbound.deferral_id || bk.outbound.id)
                                  }
                                }}
                              >
                                ↩ Undo
                              </button>
                            ) : Number(c.monthly_fee_net || 0) > 0 ? (
                              <button
                                className="row-btn"
                                style={{ fontSize: 11, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4 }}
                                title={`Postpone ${monthName(selectedMonth)} ${selectedYear}'s fee to a later month`}
                                onClick={() => openDeferModal(c, 'monthly_fee')}
                              >
                                → Defer
                              </button>
                            ) : null}
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
                            <button className="row-btn danger" onClick={() => handleDelete(c)}>🗑️</button>
                          </td>
                        </tr>
                      )
                    })}
                    {/* DB rows — each is its own invoice. May include rows for
                        clients without a default fee (manually added via the
                        + Add button) or multiple invoices for the same client. */}
                    {dbInvoices.map(inv => {
                      const c = clientById.get(inv.client_id) || {}
                      const amountNet = Number(inv.amount_net || 0)
                      const vatRate   = Number(inv.vat_rate || 0)
                      const total     = Number(inv.amount_total || amountNet * (1 + vatRate))
                      const outbound  = outboundDeferralFor(c, 'monthly_fee')
                      return (
                        <tr key={inv.id}>
                          {renderProjectCell(c)}
                          <td>
                            {renderBreakdownCell(c, inv.amount_net, inv.description, 'monthly_fee')}
                            {outbound && !periodBreakdown(c, 'monthly_fee').outbound && (
                              <div style={{
                                display: 'inline-block', marginTop: 4,
                                padding: '1px 8px',
                                background: '#dbeafe', color: '#1e40af',
                                borderRadius: 10, fontSize: 11, fontWeight: 600,
                              }}>
                                → Also deferred to {monthName(outbound.target_month)} {outbound.target_year}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <input
                              type="number" step="0.01" min="0"
                              className="lifecycle-input lifecycle-input-mono"
                              style={{ textAlign: 'right', width: 90 }}
                              defaultValue={amountNet}
                              onBlur={(e) => {
                                const next = parseFloat(e.target.value)
                                if (!Number.isNaN(next) && next !== amountNet) {
                                  const newTotal = next * (1 + vatRate)
                                  supabase.from('invoices')
                                    .update({ amount_net: next, amount_total: newTotal, updated_at: new Date().toISOString() })
                                    .eq('id', inv.id).select('*').single()
                                    .then(({ data, error }) => {
                                      if (error) { alert(`Save failed: ${error.message}`); return }
                                      setInvoices(prev => prev.map(i => i.id === data.id ? data : i))
                                    })
                                }
                              }}
                            />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {vatRate === 0
                              ? <span style={{ color: '#9ca3af' }}>—</span>
                              : <span style={{ fontSize: 10, color: '#6b7280' }}>{(vatRate * 100).toFixed(0)}%</span>}
                          </td>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                            {formatEuro(total)}
                          </td>
                          {renderLifecycleCellsForInvoice(inv)}
                          {/* Defer column — Undo if outbound exists, else Defer if natural fee > 0 */}
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                            {outbound ? (
                              <button
                                className="row-btn"
                                disabled={isTargetInvoiceIssued(c, 'monthly_fee')}
                                title={isTargetInvoiceIssued(c, 'monthly_fee')
                                  ? `Locked — target invoice already issued.`
                                  : `Cancel deferral`}
                                style={{ fontSize: 11, padding: '3px 6px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4 }}
                                onClick={() => {
                                  if (isTargetInvoiceIssued(c, 'monthly_fee')) return
                                  if (window.confirm(`Undo the monthly-fee deferral of ${monthName(selectedMonth)} ${selectedYear} for ${c.trade_name || c.legal_name}?`)) {
                                    removeDeferral(outbound.id)
                                  }
                                }}
                              >
                                ↩ Undo
                              </button>
                            ) : Number(c.monthly_fee_net || 0) > 0 ? (
                              <button
                                className="row-btn"
                                style={{ fontSize: 11, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4 }}
                                title={`Route ${monthName(selectedMonth)} ${selectedYear}'s fee to a later month`}
                                onClick={() => openDeferModal(c, 'monthly_fee')}
                              >
                                → Defer
                              </button>
                            ) : null}
                          </td>
                          <td></td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="row-btn danger" onClick={() => deleteOneOff(inv)}>🗑️</button>
                          </td>
                        </tr>
                      )
                    })}
                    {/* Outbound-only muted rows — client's monthly fee for
                        this period was deferred forward AND no inbound, no
                        DB invoice this month. Just shows the deferred state. */}
                    {outboundClients.map(({ c, deferral }) => {
                      const targetLabel = `${monthName(deferral.target_month)} ${deferral.target_year}`
                      const targetIssued = isTargetInvoiceIssued(c, 'monthly_fee')
                      return (
                        <tr key={`outbound-mf-${deferral.id}`} style={{ background: '#f9fafb', color: '#9ca3af' }}>
                          {renderProjectCell(c)}
                          <td style={{ fontStyle: 'italic', color: '#9ca3af' }}>
                            <span style={{ textDecoration: 'line-through' }}>
                              {monthName(selectedMonth)} {selectedYear} fee
                            </span>
                            <div style={{
                              display: 'inline-block', marginLeft: 8,
                              padding: '1px 8px',
                              background: '#dbeafe', color: '#1e40af',
                              borderRadius: 10, fontSize: 11, fontWeight: 600,
                              fontStyle: 'normal',
                            }}>
                              → Deferred to {targetLabel}
                            </div>
                          </td>
                          <td style={{ textAlign: 'right', textDecoration: 'line-through', color: '#9ca3af', fontFamily: 'monospace' }}>
                            {formatEuro(Number(c.monthly_fee_net || 0))}
                          </td>
                          <td></td>
                          <td></td>
                          <td colSpan="6" style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
                            Billed in {targetLabel}
                          </td>
                          <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                            <button
                              className="row-btn"
                              disabled={targetIssued}
                              title={targetIssued
                                ? `Locked — ${targetLabel} invoice already issued.`
                                : `Bring ${monthName(selectedMonth)} ${selectedYear}'s fee back here.`}
                              style={{
                                fontSize: 11, padding: '3px 6px',
                                background: targetIssued ? '#f3f4f6' : '#fff',
                                color: targetIssued ? '#9ca3af' : '#374151',
                                border: '1px solid #d1d5db', borderRadius: 4,
                                cursor: targetIssued ? 'not-allowed' : 'pointer',
                              }}
                              onClick={() => {
                                if (targetIssued) return
                                if (window.confirm(`Undo the monthly-fee deferral of ${monthName(selectedMonth)} ${selectedYear} for ${c.trade_name || c.legal_name}?`)) {
                                  removeDeferral(deferral.id)
                                }
                              }}
                            >
                              ↩ Undo
                            </button>
                          </td>
                          <td></td>
                          <td></td>
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
              BLOCK 2 — One-off Invoices (live)
              Supports two sub-types via invoice_type:
                - one_off_service        (VAT applies)
                - one_off_reimbursement  (no VAT — pass-through)
              Multiple rows allowed per client per month (unlike the
              recurring blocks which have one row per client). Add via
              the "+ Add one-off invoice" button which opens a modal.
              ================================================================= */}
          {(() => {
            const rows = invoices
              .filter(i => i.invoice_type === 'one_off_service' || i.invoice_type === 'one_off_reimbursement')
              .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
            const totalForBlock = rows.reduce((s, i) => s + Number(i.amount_total || 0), 0)
            const clientById = new Map(clients.map(c => [c.id, c]))
            return (
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
                  <div className="block-subtitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {rows.length === 0
                        ? 'No one-off invoices for this month yet.'
                        : <>{rows.length} invoice{rows.length === 1 ? '' : 's'} · total <strong>{formatEuro(totalForBlock)}</strong></>}
                    </span>
                    <button className="button" style={{ padding: '6px 12px' }} onClick={() => openOneOffModal()}>
                      + Add one-off invoice
                    </button>
                  </div>
                </div>
                {rows.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="clients-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th style={{ textAlign: 'right' }}>Amount (net)</th>
                          <th style={{ textAlign: 'right' }}>VAT</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ minWidth: 120 }}>Inv. #</th>
                          <th style={{ minWidth: 150 }}>Issue Date</th>
                          <th title="Statement of Account updated after invoice issued">SOA ✓</th>
                          <th title="Email with invoice sent to client">Email ✓</th>
                          <th style={{ minWidth: 150 }}>Payment Date</th>
                          <th title="Statement of Account updated after payment received">SOA ✓</th>
                          <th>Status</th>
                          <th>Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(inv => {
                          const c = clientById.get(inv.client_id)
                          const isService = inv.invoice_type === 'one_off_service'
                          return (
                            <tr key={inv.id}>
                              {renderProjectCell(c)}
                              <td>
                                <span style={{
                                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                                  background: isService ? '#dbeafe' : '#fef3c7',
                                  color:      isService ? '#1e40af' : '#92400e',
                                }}>
                                  {isService ? '💼 Service' : '💵 Reimbursement'}
                                </span>
                              </td>
                              <td style={{ fontStyle: 'italic', color: '#374151' }}>{inv.description || '—'}</td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatEuro(inv.amount_net)}</td>
                              <td style={{ textAlign: 'right' }}>
                                {Number(inv.vat_rate || 0) === 0
                                  ? <span style={{ color: '#9ca3af' }}>—</span>
                                  : `${(Number(inv.vat_rate) * 100).toFixed(0)}%`}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                                {formatEuro(inv.amount_total)}
                              </td>
                              {renderLifecycleCellsForInvoice(inv)}
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button className="row-btn danger" onClick={() => deleteOneOff(inv)}>🗑️</button>
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
              BLOCK 2 — Fixed Monthly Expense Reimbursement Invoices
              Only active clients where monthly_fixed_expense_net > 0.
              Same column structure as Block 1. Period sits in the
              Description cell ("March 2026 fixed expenses"), not the
              column header — so the same client can appear with two
              rows when two months' fixed reimbursements are invoiced
              in a single month.
              ================================================================= */}
          {(() => {
            // All DB invoices of this type for the selected month
            const dbInvoices = invoices.filter(i => i.invoice_type === 'fixed_expense')
            const clientIdsWithDbRow = new Set(dbInvoices.map(i => i.client_id))
            // Effective placeholder candidates — clients whose effective
            // fixed-expense amount (natural + inbound deferrals) > 0
            // AND who don't already have a saved invoice. A client
            // deferred AWAY from this period has effective = 0 and
            // shows up in the outbound list below.
            const placeholderClients = clients
              .filter(c =>
                c.active &&
                effectiveAmountFor(c, 'fixed_expense') > 0 &&
                !clientIdsWithDbRow.has(c.id)
              )
            // Outbound-only: client's fixed-expense reimbursement deferred
            // away AND no inbound + no DB row, so only thing to surface
            // is the muted "deferred to X" note.
            const outboundClients = clients
              .filter(c =>
                c.active &&
                outboundDeferralFor(c, 'fixed_expense') &&
                effectiveAmountFor(c, 'fixed_expense') === 0 &&
                !clientIdsWithDbRow.has(c.id)
              )
              .map(c => ({ c, deferral: outboundDeferralFor(c, 'fixed_expense') }))
            const clientById = new Map(clients.map(c => [c.id, c]))
            const totalForBlock =
              dbInvoices.reduce((s, i) => s + Number(i.amount_net || 0), 0)
              + placeholderClients.reduce((s, c) => s + effectiveAmountFor(c, 'fixed_expense'), 0)
            const periodLabel = selectedMonth && selectedYear
              ? `${monthName(selectedMonth)} ${selectedYear} fixed expenses`
              : 'Fixed monthly expenses'
            const totalRows = dbInvoices.length + placeholderClients.length + outboundClients.length
            return (
              <section className="clients-block clients-block-fixed">
                <div className="clients-block-header">
                  <h3>🔁 Fixed Monthly Expense Reimbursement Invoices</h3>
                  <div className="block-subtitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {totalRows === 0
                        ? 'No fixed-expense reimbursements yet for this month.'
                        : <>
                            {totalRows} row{totalRows === 1 ? '' : 's'} · total <strong>{formatEuro(totalForBlock)}</strong>
                            <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>
                              (no VAT — pass-through cost)
                            </span>
                          </>}
                    </span>
                    <button className="button" style={{ padding: '6px 12px' }} onClick={() => openOneOffModal('', 'fixed_expense')}>
                      + Add fixed reimbursement
                    </button>
                  </div>
                </div>
                {totalRows > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                  <table className="clients-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ minWidth: 120 }}>Inv. #</th>
                        <th style={{ minWidth: 150 }}>Issue Date</th>
                        <th title="Statement of Account updated after invoice issued">SOA ✓</th>
                        <th title="Email with invoice sent to client">Email ✓</th>
                        <th style={{ minWidth: 150 }}>Payment Date</th>
                        <th title="Statement of Account updated after payment received">SOA ✓</th>
                        <th>Status</th>
                        <th title="Defer this month's fixed reimbursement to a later month, or undo a deferral">Defer</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Placeholder rows (auto-drafted with effective amount). */}
                      {placeholderClients.map(c => {
                        const effectiveNet = effectiveAmountFor(c, 'fixed_expense')
                        const bk           = periodBreakdown(c, 'fixed_expense')
                        return (
                          <tr key={`placeholder-${c.id}`}>
                            {renderProjectCell(c)}
                            <td>
                              {renderBreakdownCell(c, null, null, 'fixed_expense')}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="lifecycle-input lifecycle-input-mono"
                                style={{ textAlign: 'right', width: 90 }}
                                defaultValue={effectiveNet}
                                onBlur={(e) => {
                                  const next = parseFloat(e.target.value)
                                  if (!Number.isNaN(next) && next !== effectiveNet) {
                                    upsertInvoice(c, 'fixed_expense', { amount_net: next, vat_rate: 0 })
                                  }
                                }}
                              />
                            </td>
                            {renderLifecycleCells(c, 'fixed_expense')}
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                              {bk.outbound ? (
                                <button
                                  className="row-btn"
                                  disabled={isTargetInvoiceIssued(c, 'fixed_expense')}
                                  title={isTargetInvoiceIssued(c, 'fixed_expense')
                                    ? `Locked — target invoice already issued.`
                                    : `Cancel deferral`}
                                  style={{ fontSize: 11, padding: '3px 6px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4 }}
                                  onClick={() => {
                                    if (isTargetInvoiceIssued(c, 'fixed_expense')) return
                                    if (window.confirm(`Undo the fixed-expense deferral of ${monthName(selectedMonth)} ${selectedYear} for ${c.trade_name || c.legal_name}?`)) {
                                      removeDeferral(bk.outbound.id)
                                    }
                                  }}
                                >
                                  ↩ Undo
                                </button>
                              ) : Number(c.monthly_fixed_expense_net || 0) > 0 ? (
                                <button
                                  className="row-btn"
                                  style={{ fontSize: 11, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4 }}
                                  title={`Postpone ${monthName(selectedMonth)} ${selectedYear}'s fixed reimbursement to a later month`}
                                  onClick={() => openDeferModal(c, 'fixed_expense')}
                                >
                                  → Defer
                                </button>
                              ) : null}
                            </td>
                            <td></td>
                          </tr>
                        )
                      })}
                      {/* DB rows — each is its own invoice. */}
                      {dbInvoices.map(inv => {
                        const c = clientById.get(inv.client_id) || {}
                        const outbound = outboundDeferralFor(c, 'fixed_expense')
                        return (
                          <tr key={inv.id}>
                            {renderProjectCell(c)}
                            <td>
                              {renderBreakdownCell(c, inv.amount_net, inv.description, 'fixed_expense')}
                              {outbound && !periodBreakdown(c, 'fixed_expense').outbound && (
                                <div style={{
                                  display: 'inline-block', marginTop: 4,
                                  padding: '1px 8px',
                                  background: '#dbeafe', color: '#1e40af',
                                  borderRadius: 10, fontSize: 11, fontWeight: 600,
                                }}>
                                  → Also deferred to {monthName(outbound.target_month)} {outbound.target_year}
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="lifecycle-input lifecycle-input-mono"
                                style={{ textAlign: 'right', width: 90 }}
                                defaultValue={Number(inv.amount_net || 0)}
                                onBlur={(e) => {
                                  const next = parseFloat(e.target.value)
                                  if (!Number.isNaN(next) && next !== Number(inv.amount_net || 0)) {
                                    supabase.from('invoices')
                                      .update({ amount_net: next, amount_total: next, updated_at: new Date().toISOString() })
                                      .eq('id', inv.id).select('*').single()
                                      .then(({ data, error }) => {
                                        if (error) { alert(`Save failed: ${error.message}`); return }
                                        setInvoices(prev => prev.map(i => i.id === data.id ? data : i))
                                      })
                                  }
                                }}
                              />
                            </td>
                            {renderLifecycleCellsForInvoice(inv)}
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                              {outbound ? (
                                <button
                                  className="row-btn"
                                  disabled={isTargetInvoiceIssued(c, 'fixed_expense')}
                                  title={isTargetInvoiceIssued(c, 'fixed_expense')
                                    ? `Locked — target invoice already issued.`
                                    : `Cancel deferral`}
                                  style={{ fontSize: 11, padding: '3px 6px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4 }}
                                  onClick={() => {
                                    if (isTargetInvoiceIssued(c, 'fixed_expense')) return
                                    if (window.confirm(`Undo the fixed-expense deferral of ${monthName(selectedMonth)} ${selectedYear} for ${c.trade_name || c.legal_name}?`)) {
                                      removeDeferral(outbound.id)
                                    }
                                  }}
                                >
                                  ↩ Undo
                                </button>
                              ) : Number(c.monthly_fixed_expense_net || 0) > 0 ? (
                                <button
                                  className="row-btn"
                                  style={{ fontSize: 11, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4 }}
                                  title={`Route ${monthName(selectedMonth)} ${selectedYear}'s fixed reimbursement to a later month`}
                                  onClick={() => openDeferModal(c, 'fixed_expense')}
                                >
                                  → Defer
                                </button>
                              ) : null}
                            </td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <button className="row-btn danger" onClick={() => deleteOneOff(inv)}>🗑️</button>
                            </td>
                          </tr>
                        )
                      })}
                      {/* Outbound-only muted rows — fixed reimbursement deferred forward. */}
                      {outboundClients.map(({ c, deferral }) => {
                        const targetLabel  = `${monthName(deferral.target_month)} ${deferral.target_year}`
                        const targetIssued = isTargetInvoiceIssued(c, 'fixed_expense')
                        return (
                          <tr key={`outbound-fe-${deferral.id}`} style={{ background: '#f9fafb', color: '#9ca3af' }}>
                            {renderProjectCell(c)}
                            <td style={{ fontStyle: 'italic', color: '#9ca3af' }}>
                              <span style={{ textDecoration: 'line-through' }}>
                                {monthName(selectedMonth)} {selectedYear} fixed expenses
                              </span>
                              <div style={{
                                display: 'inline-block', marginLeft: 8,
                                padding: '1px 8px',
                                background: '#dbeafe', color: '#1e40af',
                                borderRadius: 10, fontSize: 11, fontWeight: 600,
                                fontStyle: 'normal',
                              }}>
                                → Deferred to {targetLabel}
                              </div>
                            </td>
                            <td style={{ textAlign: 'right', textDecoration: 'line-through', color: '#9ca3af', fontFamily: 'monospace' }}>
                              {formatEuro(Number(c.monthly_fixed_expense_net || 0))}
                            </td>
                            <td colSpan="6" style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
                              Billed in {targetLabel}
                            </td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                              <button
                                className="row-btn"
                                disabled={targetIssued}
                                title={targetIssued
                                  ? `Locked — ${targetLabel} invoice already issued.`
                                  : `Bring ${monthName(selectedMonth)} ${selectedYear}'s fixed reimbursement back here.`}
                                style={{
                                  fontSize: 11, padding: '3px 6px',
                                  background: targetIssued ? '#f3f4f6' : '#fff',
                                  color: targetIssued ? '#9ca3af' : '#374151',
                                  border: '1px solid #d1d5db', borderRadius: 4,
                                  cursor: targetIssued ? 'not-allowed' : 'pointer',
                                }}
                                onClick={() => {
                                  if (targetIssued) return
                                  if (window.confirm(`Undo the fixed-expense deferral of ${monthName(selectedMonth)} ${selectedYear} for ${c.trade_name || c.legal_name}?`)) {
                                    removeDeferral(deferral.id)
                                  }
                                }}
                              >
                                ↩ Undo
                              </button>
                            </td>
                            <td></td>
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
            // All DB invoices of this type for the selected month
            const dbInvoices = invoices.filter(i => i.invoice_type === 'variable_expense')
            // Effective candidates: active clients whose EFFECTIVE amount
            // (natural + inbound deferrals - 0 if deferred away) is > 0,
            // AND who don't already have a saved invoice row this month.
            const effectiveClients = clients
              .filter(c => c.active && effectiveReimbursableFor(c) > 0)
              .map(c => ({ c, effective: effectiveReimbursableFor(c) }))
              .sort((a, b) => b.effective - a.effective)
            const clientIdsWithDbRow = new Set(dbInvoices.map(i => i.client_id))
            const placeholderRows = effectiveClients.filter(({ c }) => !clientIdsWithDbRow.has(c.id))
            // Outbound-ONLY rows (rendered as muted muted-with-badge rows):
            // - client deferred this month's expenses forward
            // - has nothing inbound (effective bill is 0)
            // - has no saved DB invoice this month either (those get the
            //   deferral indicator + Defer/Undo button inline instead, to
            //   avoid rendering the same client twice in different styles)
            const outboundClients = clients
              .filter(c =>
                c.active &&
                outboundDeferralFor(c) &&
                effectiveReimbursableFor(c) === 0 &&
                !clientIdsWithDbRow.has(c.id)
              )
              .map(c => ({ c, deferral: outboundDeferralFor(c), natural: reimbursableFor(c) }))
              .sort((a, b) => b.natural - a.natural)
            const clientById = new Map(clients.map(c => [c.id, c]))
            const totalForBlock =
              dbInvoices.reduce((s, i) => s + Number(i.amount_net || 0), 0)
              + placeholderRows.reduce((s, r) => s + r.effective, 0)
            const periodLabel = selectedMonth && selectedYear
              ? `${monthName(selectedMonth)} ${selectedYear} expenses to be reimbursed`
              : 'Reimbursable expenses'
            const totalRows = dbInvoices.length + placeholderRows.length + outboundClients.length
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
                  <div className="block-subtitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {totalRows === 0
                        ? 'No variable-expense reimbursements yet for this month.'
                        : <>
                            {totalRows} row{totalRows === 1 ? '' : 's'} · total <strong>{formatEuro(totalForBlock)}</strong>
                            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                              Auto-drafted from the selected month's reimbursable expenses;
                              you can override or manually add catch-up rows via the button.
                            </div>
                          </>}
                    </span>
                    <button className="button" style={{ padding: '6px 12px' }} onClick={() => openOneOffModal('', 'variable_expense')}>
                      + Add variable reimbursement
                    </button>
                  </div>
                </div>
                {/* Orphan reimbursable expenses — client_name on the expense
                    doesn't match any client record. Surfaces them so the
                    money never goes invisible. One-click "+ Create client"
                    fixes each orphan. */}
                {orphanReimbursables.length > 0 && (
                  <div style={{
                    background: '#fef3c7',
                    border: '1px solid #fcd34d',
                    borderRadius: 4,
                    padding: '10px 12px',
                    marginBottom: 10,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 6 }}>
                      ⚠️ {orphanReimbursables.length} unmatched reimbursable expense group{orphanReimbursables.length === 1 ? '' : 's'}
                    </div>
                    <div style={{ fontSize: 11, color: '#78350f', marginBottom: 8 }}>
                      These expense rows have a client name that doesn't match any client record.
                      Click <strong>+ Create client</strong> to add the client and link these expenses to it.
                    </div>
                    <table style={{ width: '100%', fontSize: 13 }}>
                      <tbody>
                        {orphanReimbursables.map(o => (
                          <tr key={o.name} style={{ borderTop: '1px solid #fcd34d' }}>
                            <td style={{ padding: '6px 4px', fontWeight: 600 }}>{o.name}</td>
                            <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'monospace', color: '#7c2d12' }}>
                              {formatEuro(o.total)}
                            </td>
                            <td style={{ padding: '6px 4px', textAlign: 'right', width: 200 }}>
                              <button
                                onClick={() => createClientFromOrphan(o.name)}
                                style={{
                                  padding: '4px 10px',
                                  background: '#fff',
                                  color: '#92400e',
                                  border: '1px solid #f59e0b',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontSize: 12,
                                }}
                              >
                                + Create client "{o.name}"
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {totalRows > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                  <table className="clients-table">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Description</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                        <th style={{ minWidth: 120 }}>Inv. #</th>
                        <th style={{ minWidth: 150 }}>Issue Date</th>
                        <th title="Statement of Account updated after invoice issued">SOA ✓</th>
                        <th title="Email with invoice sent to client">Email ✓</th>
                        <th style={{ minWidth: 150 }}>Payment Date</th>
                        <th title="Statement of Account updated after payment received">SOA ✓</th>
                        <th>Status</th>
                        <th title="Defer this month's reimbursables to a later month, or undo a deferral">Defer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* No VAT applied — expense reimbursements are
                          pass-through costs, not services. The original
                          expense already had its own VAT treatment. */}
                      {/* Placeholder rows first (auto-drafted from expenses,
                          including any inbound deferrals from earlier months). */}
                      {placeholderRows.map(({ c, effective }) => {
                        const bk = reimbursableBreakdown(c)
                        const targetIssued = isTargetInvoiceIssued(c)
                        return (
                          <tr key={`placeholder-${c.id}`}>
                            {renderProjectCell(c)}
                            <td style={{ color: '#374151' }}>
                              {renderBreakdownCell(c)}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="lifecycle-input lifecycle-input-mono"
                                style={{ textAlign: 'right', width: 90, color: '#7c2d12' }}
                                defaultValue={effective}
                                onBlur={(e) => {
                                  const next = parseFloat(e.target.value)
                                  if (!Number.isNaN(next) && next !== effective) {
                                    upsertInvoice(c, 'variable_expense', { amount_net: next, vat_rate: 0 })
                                  }
                                }}
                              />
                            </td>
                            {renderLifecycleCells(c, 'variable_expense')}
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                              {/* Context-aware action button:
                                  - If THIS month is already deferred away, show ↩ Undo
                                  - Else if there's a natural amount to defer, show → Defer
                                  - Else (only inbound, nothing natural here) hide button */}
                              {bk.outbound ? (
                                <button
                                  className="row-btn"
                                  disabled={targetIssued}
                                  title={targetIssued
                                    ? `Locked — the ${monthName(bk.outbound.target_month)} ${bk.outbound.target_year} invoice is already issued.`
                                    : `Cancel the deferral and bring ${monthName(selectedMonth)}'s expenses back here.`}
                                  style={{
                                    fontSize: 11, padding: '3px 8px',
                                    background: targetIssued ? '#f3f4f6' : '#fff',
                                    color: targetIssued ? '#9ca3af' : '#374151',
                                    border: '1px solid #d1d5db', borderRadius: 4,
                                    cursor: targetIssued ? 'not-allowed' : 'pointer',
                                  }}
                                  onClick={() => {
                                    if (targetIssued) return
                                    if (window.confirm(`Undo the deferral of ${monthName(selectedMonth)} ${selectedYear} for ${c.trade_name || c.legal_name}?`)) {
                                      removeDeferral(bk.outbound.id)
                                    }
                                  }}
                                >
                                  ↩ Undo defer
                                </button>
                              ) : bk.natural > 0 ? (
                                <button
                                  className="row-btn"
                                  style={{ fontSize: 11, padding: '3px 8px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
                                  title={`Postpone ${monthName(selectedMonth)} ${selectedYear}'s reimbursables to a later month`}
                                  onClick={() => openDeferModal(c)}
                                >
                                  → Defer
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        )
                      })}
                      {/* DB rows (saved invoices). Render the same per-month
                          breakdown UI as placeholder rows so the user keeps
                          seeing the line-by-line contribution per month even
                          after an invoice is created. Pass the saved amount
                          so we can flag a mismatch if deferrals changed.
                          Also: defer/undo this client-month even after the
                          invoice exists — the saved amount stays put; the
                          deferral is informational ("these expenses ALSO
                          appear in target month's invoice"). */}
                      {dbInvoices.map(inv => {
                        const c = clientById.get(inv.client_id) || {}
                        const outbound = outboundDeferralFor(c)
                        const natural  = reimbursableFor(c)
                        const targetIssued = outbound ? isTargetInvoiceIssued(c) : false
                        return (
                          <tr key={inv.id}>
                            {renderProjectCell(c)}
                            <td style={{ color: '#374151' }}>
                              {renderBreakdownCell(c, inv.amount_net, inv.description)}
                              {/* Outbound deferral badge — shown when THIS
                                  month's expenses have been routed forward,
                                  in addition to whatever this invoice covers. */}
                              {outbound && !reimbursableBreakdown(c).outbound && (
                                <div style={{
                                  display: 'inline-block', marginTop: 4,
                                  padding: '1px 8px',
                                  background: '#dbeafe', color: '#1e40af',
                                  borderRadius: 10, fontSize: 11, fontWeight: 600,
                                }}>
                                  → Also deferred to {monthName(outbound.target_month)} {outbound.target_year}
                                </div>
                              )}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="lifecycle-input lifecycle-input-mono"
                                style={{ textAlign: 'right', width: 90, color: '#7c2d12' }}
                                defaultValue={Number(inv.amount_net || 0)}
                                onBlur={(e) => {
                                  const next = parseFloat(e.target.value)
                                  if (!Number.isNaN(next) && next !== Number(inv.amount_net || 0)) {
                                    supabase.from('invoices')
                                      .update({ amount_net: next, amount_total: next, updated_at: new Date().toISOString() })
                                      .eq('id', inv.id).select('*').single()
                                      .then(({ data, error }) => {
                                        if (error) { alert(`Save failed: ${error.message}`); return }
                                        setInvoices(prev => prev.map(i => i.id === data.id ? data : i))
                                      })
                                  }
                                }}
                              />
                            </td>
                            {renderLifecycleCellsForInvoice(inv)}
                            {/* Two stacked actions: Defer/Undo + Delete.
                                Defer is for routing this month's expenses
                                forward (independent of the saved invoice
                                amount); Delete removes the invoice row. */}
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                                {outbound ? (
                                  <button
                                    className="row-btn"
                                    disabled={targetIssued}
                                    title={targetIssued
                                      ? `Locked — the ${monthName(outbound.target_month)} ${outbound.target_year} invoice is already issued.`
                                      : `Cancel the deferral and bring ${monthName(selectedMonth)}'s expenses back here.`}
                                    style={{
                                      fontSize: 11, padding: '3px 6px',
                                      background: targetIssued ? '#f3f4f6' : '#fff',
                                      color: targetIssued ? '#9ca3af' : '#374151',
                                      border: '1px solid #d1d5db', borderRadius: 4,
                                      cursor: targetIssued ? 'not-allowed' : 'pointer',
                                    }}
                                    onClick={() => {
                                      if (targetIssued) return
                                      if (window.confirm(`Undo the deferral of ${monthName(selectedMonth)} ${selectedYear} for ${c.trade_name || c.legal_name}?`)) {
                                        removeDeferral(outbound.id)
                                      }
                                    }}
                                  >
                                    ↩ Undo
                                  </button>
                                ) : natural > 0 ? (
                                  <button
                                    className="row-btn"
                                    style={{ fontSize: 11, padding: '3px 6px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
                                    title={`Route ${monthName(selectedMonth)} ${selectedYear}'s reimbursables to a later month's invoice (the saved invoice here is unchanged).`}
                                    onClick={() => openDeferModal(c)}
                                  >
                                    → Defer
                                  </button>
                                ) : null}
                                <button className="row-btn danger" onClick={() => deleteOneOff(inv)}>🗑️</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                      {/* Outbound deferral rows — this client's current
                          month was rolled forward to a later month. The
                          row is muted, struck-through on the amount, and
                          has an "Undo" button (disabled if the target
                          invoice is already issued). */}
                      {outboundClients.map(({ c, deferral, natural }) => {
                        const targetLabel = `${monthName(deferral.target_month)} ${deferral.target_year}`
                        const targetIssued = isTargetInvoiceIssued(c)
                        return (
                          <tr key={`outbound-${deferral.id}`} style={{ background: '#f9fafb', color: '#9ca3af' }}>
                            {renderProjectCell(c)}
                            <td style={{ fontStyle: 'italic', color: '#9ca3af' }}>
                              <span style={{ textDecoration: 'line-through' }}>{periodLabel}</span>
                              <div style={{
                                display: 'inline-block',
                                marginLeft: 8,
                                padding: '1px 8px',
                                background: '#dbeafe',
                                color: '#1e40af',
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 600,
                                fontStyle: 'normal',
                              }}>
                                → Deferred to {targetLabel}
                              </div>
                            </td>
                            <td style={{ textAlign: 'right', textDecoration: 'line-through', color: '#9ca3af', fontFamily: 'monospace' }}>
                              {formatEuro(natural)}
                            </td>
                            {/* Empty lifecycle cells for the deferred row — no
                                invoice to track here (the target month owns it). */}
                            <td colSpan="6" style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', fontStyle: 'italic' }}>
                              Billed in {targetLabel}
                            </td>
                            <td></td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
                              <button
                                className="row-btn"
                                disabled={targetIssued}
                                title={targetIssued
                                  ? `Locked — the ${targetLabel} invoice is already issued. Clear its Inv# + Date first to undo.`
                                  : `Cancel the deferral and bring these expenses back to ${monthName(selectedMonth)} ${selectedYear}.`}
                                style={{
                                  fontSize: 11,
                                  padding: '3px 8px',
                                  background: targetIssued ? '#f3f4f6' : '#fff',
                                  color: targetIssued ? '#9ca3af' : '#374151',
                                  border: '1px solid #d1d5db',
                                  borderRadius: 4,
                                  cursor: targetIssued ? 'not-allowed' : 'pointer',
                                }}
                                onClick={() => {
                                  if (targetIssued) return
                                  if (window.confirm(`Undo this deferral?\n\n${c.trade_name || c.legal_name}'s ${monthName(selectedMonth)} ${selectedYear} expenses will return to this month.`)) {
                                    removeDeferral(deferral.id)
                                  }
                                }}
                              >
                                ↩ Undo
                              </button>
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
              BLOCK 5 — Credit Notes (live)
              For reversing or correcting previously-issued invoices. Same
              lifecycle structure as the other blocks (Inv # → Issue Date
              → SOA → Email → Payment Date → SOA → Status). Description
              column is intentionally wider here because the user typically
              writes longer text referencing the original invoice number
              (e.g. "Credit note for invoice 2026-03-001 — overcharge").
              VAT is configurable per credit note since it mirrors whatever
              invoice it's reversing.
              ================================================================= */}
          {(() => {
            const rows = invoices
              .filter(i => i.invoice_type === 'credit_note')
              .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
            const totalForBlock = rows.reduce((s, i) => s + Number(i.amount_total || 0), 0)
            const clientById = new Map(clients.map(c => [c.id, c]))
            return (
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
                  <div className="block-subtitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {rows.length === 0
                        ? 'No credit notes for this month yet.'
                        : <>{rows.length} credit note{rows.length === 1 ? '' : 's'} · total <strong>{formatEuro(totalForBlock)}</strong></>}
                    </span>
                    <button className="button" style={{ padding: '6px 12px' }} onClick={() => openOneOffModal('', 'credit_note')}>
                      + Add credit note
                    </button>
                  </div>
                </div>
                {rows.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="clients-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          {/* Wider description column — user typically writes longer
                              text referencing the original invoice (per credit note). */}
                          <th style={{ minWidth: 240 }}>Description</th>
                          <th style={{ textAlign: 'right' }}>Amount (net)</th>
                          <th style={{ textAlign: 'right' }}>VAT</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ minWidth: 120 }}>Inv. #</th>
                          <th style={{ minWidth: 150 }}>Issue Date</th>
                          <th title="Statement of Account updated after credit note issued">SOA ✓</th>
                          <th title="Email with credit note sent to client">Email ✓</th>
                          <th style={{ minWidth: 150 }}>Settled Date</th>
                          <th title="Statement of Account updated after credit applied">SOA ✓</th>
                          <th>Status</th>
                          <th>Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(inv => {
                          const c = clientById.get(inv.client_id) || {}
                          return (
                            <tr key={inv.id}>
                              {renderProjectCell(c)}
                              <td style={{ fontStyle: 'italic', color: '#374151' }}>
                                {inv.description || '—'}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatEuro(inv.amount_net)}</td>
                              <td style={{ textAlign: 'right' }}>
                                {Number(inv.vat_rate || 0) === 0
                                  ? <span style={{ color: '#9ca3af' }}>—</span>
                                  : `${(Number(inv.vat_rate) * 100).toFixed(0)}%`}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                                {formatEuro(inv.amount_total)}
                              </td>
                              {renderLifecycleCellsForInvoice(inv)}
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button className="row-btn danger" onClick={() => deleteOneOff(inv)}>🗑️</button>
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
              BLOCK 6 — Pro Forma Invoices (live)
              Pro formas are quotes/previews, NOT tax documents. They never
              file with VIES/VAT and never get "paid" — the matching real
              invoice (separate row, issued once the client accepts) handles
              all that. So this block has a lighter lifecycle: PF# + Date +
              Email sent. Status flow: Draft → Issued → Sent.

              Numbering: YYYY-MM-NNN (same shape as regular invoices) but
              in its own per-month sequence within this block. Date is
              locked to the top-bar month (consistent UX with Block 1).
              ================================================================= */}
          {(() => {
            const rows = invoices
              .filter(i => i.invoice_type === 'pro_forma')
              .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
            const totalForBlock = rows.reduce((s, i) => s + Number(i.amount_total || 0), 0)
            const clientById = new Map(clients.map(c => [c.id, c]))
            return (
              <section className="clients-block clients-block-proforma">
                <div className="clients-block-header">
                  <h3>
                    📋 Pro Forma Invoices
                    {selectedMonth && selectedYear && (
                      <span style={{ fontWeight: 400, fontSize: 14, color: '#6b7280', marginLeft: 8 }}>
                        — {monthName(selectedMonth)} {selectedYear}
                      </span>
                    )}
                  </h3>
                  <div className="block-subtitle" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {rows.length === 0
                        ? 'No pro forma invoices for this month yet.'
                        : <>{rows.length} pro forma{rows.length === 1 ? '' : 's'} · total <strong>{formatEuro(totalForBlock)}</strong></>}
                    </span>
                    <button className="button" style={{ padding: '6px 12px' }} onClick={() => openOneOffModal('', 'pro_forma')}>
                      + Add pro forma
                    </button>
                  </div>
                  <small style={{ color: '#6b7280', fontSize: 11, fontStyle: 'italic', display: 'block', marginTop: 4 }}>
                    Pro formas aren't tax documents — no VIES/VAT filing, no payment tracking. They're quotes/previews.
                    The real invoice gets issued separately (Block 1 or 2) once the client accepts.
                  </small>
                </div>
                {rows.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="clients-table">
                      <thead>
                        <tr>
                          <th>Project</th>
                          <th style={{ minWidth: 240 }}>Description</th>
                          <th style={{ textAlign: 'right' }}>Amount (net)</th>
                          <th style={{ textAlign: 'right' }}>VAT</th>
                          <th style={{ textAlign: 'right' }}>Total</th>
                          <th style={{ minWidth: 120 }}>PF #</th>
                          <th style={{ minWidth: 150 }}>Date</th>
                          <th title="Email with pro forma sent to client">Email ✓</th>
                          <th>Status</th>
                          <th>Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(inv => {
                          const c = clientById.get(inv.client_id) || {}
                          return (
                            <tr key={inv.id}>
                              {renderProjectCell(c)}
                              <td style={{ fontStyle: 'italic', color: '#374151' }}>
                                {inv.description || '—'}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>{formatEuro(inv.amount_net)}</td>
                              <td style={{ textAlign: 'right' }}>
                                {Number(inv.vat_rate || 0) === 0
                                  ? <span style={{ color: '#9ca3af' }}>—</span>
                                  : `${(Number(inv.vat_rate) * 100).toFixed(0)}%`}
                              </td>
                              <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                                {formatEuro(inv.amount_total)}
                              </td>
                              {renderProFormaLifecycleCells(inv)}
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button className="row-btn danger" onClick={() => deleteOneOff(inv)}>🗑️</button>
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
                    <th>Project</th>
                    <th>Contact</th>
                    <th style={{ textAlign: 'right' }}>Fee (net)</th>
                    <th>Active</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clients.filter(c => !c.active).map(c => (
                    <tr key={c.id} style={{ opacity: 0.55 }}>
                      {renderProjectCell(c)}
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
      {/* ===== Add One-off Invoice modal ===== */}
      {oneOffForm && (
        <div className="modal-overlay" onClick={closeOneOffModal}>
          <div className="modal-content clients-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <h3>+ Add invoice</h3>
              <button className="modal-close" onClick={closeOneOffModal}>×</button>
            </div>
            <div className="modal-body">
              {oneOffError && <div className="message error" style={{ marginBottom: 12 }}>{oneOffError}</div>}
              <div className="form-grid">
                <div className="form-group full-row">
                  <label>Client *</label>
                  <select
                    value={oneOffForm.client_id}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val === '__new__') {
                        // Open the client-add modal first; user will come back
                        // here after creating the client. We stash the partial
                        // one-off form in a closure to restore later (kept in
                        // state already since we don't close it).
                        openAdd()
                      } else {
                        setOneOffForm(f => ({ ...f, client_id: val }))
                      }
                    }}
                    className="form-input"
                  >
                    <option value="">— Pick a client —</option>
                    {clients.filter(c => c.active).map(c => (
                      <option key={c.id} value={c.id}>
                        {c.trade_name ? `${c.trade_name} (${c.legal_name})` : c.legal_name}
                      </option>
                    ))}
                    <option value="__new__">+ Add new client…</option>
                  </select>
                  <small style={{ color: '#6b7280', fontSize: 11 }}>
                    Need a new one? Pick "+ Add new client…" — the regular Add
                    Client form will open. After saving, come back to this
                    modal and pick the new client from the list.
                  </small>
                </div>

                <div className="form-group full-row">
                  <label>Type *</label>
                  <select
                    value={oneOffForm.invoice_type}
                    onChange={(e) => {
                      const next = e.target.value
                      setOneOffForm(f => ({
                        ...f,
                        invoice_type: next,
                        // When switching to a non-VAT type, force vat_rate to 0
                        // so the saved row is clean. Switching back to service
                        // restores the Cyprus standard default.
                        vat_rate: TYPE_CARRIES_VAT[next] ? '0.19' : '0',
                      }))
                    }}
                    className="form-input"
                  >
                    {Object.entries(TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>VAT rate</label>
                  {!TYPE_CARRIES_VAT[oneOffForm.invoice_type] ? (
                    <div style={{ padding: '6px 0', color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>
                      No VAT — pass-through cost.
                    </div>
                  ) : (
                    <select
                      value={oneOffForm.vat_rate}
                      onChange={(e) => setOneOffForm(f => ({ ...f, vat_rate: e.target.value }))}
                      className="form-input"
                    >
                      <option value="0">0% (no VAT)</option>
                      <option value="0.05">5% (reduced)</option>
                      <option value="0.09">9% (reduced)</option>
                      <option value="0.19">19% (standard Cyprus)</option>
                    </select>
                  )}
                </div>

                <div className="form-group full-row">
                  <div style={{
                    padding: '8px 10px',
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    borderRadius: 4,
                    fontSize: 12,
                    color: '#075985',
                  }}>
                    📅 This invoice will be filed under <strong>{monthName(selectedMonth)} {selectedYear}</strong> —
                    the issue month from the top bar. VIES + VAT reporting use the
                    issue month, not the period the invoice covers. If this is a
                    catch-up or advance billing, mention the actual period in the
                    description (e.g. "January 2026 fee — late catch-up").
                  </div>
                </div>

                <div className="form-group full-row">
                  <label>Description *</label>
                  <input
                    type="text"
                    value={oneOffForm.description}
                    onChange={(e) => setOneOffForm(f => ({ ...f, description: e.target.value }))}
                    className="form-input"
                    placeholder={TYPE_DESCRIPTION_PLACEHOLDER[oneOffForm.invoice_type] || ''}
                  />
                </div>

                <div className="form-group">
                  <label>Amount (net) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={oneOffForm.amount_net}
                    onChange={(e) => setOneOffForm(f => ({ ...f, amount_net: e.target.value }))}
                    className="form-input"
                    placeholder="0.00"
                  />
                </div>

                <div className="form-group">
                  <label>Total (computed)</label>
                  <div style={{ padding: '6px 0', fontFamily: 'monospace', fontWeight: 600, fontSize: 16 }}>
                    {(() => {
                      const amt = parseFloat(oneOffForm.amount_net)
                      if (Number.isNaN(amt)) return '€—'
                      const vat = TYPE_CARRIES_VAT[oneOffForm.invoice_type]
                        ? parseFloat(oneOffForm.vat_rate || '0')
                        : 0
                      return formatEuro(amt * (1 + (Number.isNaN(vat) ? 0 : vat)))
                    })()}
                  </div>
                </div>

                <div className="form-group full-row">
                  <label>Notes (optional)</label>
                  <textarea
                    rows={2}
                    value={oneOffForm.notes}
                    onChange={(e) => setOneOffForm(f => ({ ...f, notes: e.target.value }))}
                    className="form-input"
                    placeholder="Internal note about this invoice"
                  />
                </div>

                <div className="form-group full-row">
                  <small style={{ color: '#6b7280', fontSize: 11 }}>
                    After saving, the invoice appears in its block with the
                    same Inv # / Issue Date / SOA / Email / Payment Date /
                    SOA lifecycle inputs as auto-drafted invoices.
                  </small>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeOneOffModal} className="btn-secondary">Cancel</button>
              <button onClick={saveOneOff} className="button">
                ➕ Add invoice
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* ===== Delete-client confirmation modal ===== */}
      {/* Deliberate friction: the user must type the client's trade_name
          (or legal_name if trade is empty) before the Delete button enables.
          Shows impact stats — invoices that will cascade-delete, plus any
          free-text expense rows that will lose their client link. */}
      {deleting && (
        <div className="modal-overlay" onClick={deleting.busy ? undefined : closeDeleteModal}>
          <div
            className="modal-content clients-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560 }}
          >
            <div className="modal-header" style={{ background: '#fef2f2', borderBottom: '1px solid #fecaca' }}>
              <h3 style={{ color: '#991b1b', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>⚠️</span> Delete client?
              </h3>
              <button className="modal-close" onClick={closeDeleteModal} disabled={deleting.busy}>×</button>
            </div>
            <div className="modal-body">
              {deleting.error && (
                <div className="message error" style={{ marginBottom: 12 }}>{deleting.error}</div>
              )}

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>You are about to permanently delete:</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: '#111827' }}>
                  {deleting.client.trade_name || deleting.client.legal_name}
                </div>
                {deleting.client.trade_name && deleting.client.legal_name &&
                 deleting.client.trade_name !== deleting.client.legal_name && (
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    Legal name: {deleting.client.legal_name}
                  </div>
                )}
              </div>

              {/* Impact stats */}
              <div style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 6,
                padding: '12px 14px',
                marginBottom: 16,
                fontSize: 13,
              }}>
                <div style={{ fontWeight: 600, color: '#991b1b', marginBottom: 6 }}>
                  Impact:
                </div>
                {deleting.impact === null ? (
                  <div style={{ color: '#6b7280', fontStyle: 'italic' }}>Loading impact…</div>
                ) : (
                  <ul style={{ margin: 0, paddingLeft: 18, color: '#7f1d1d' }}>
                    <li>
                      <strong>{deleting.impact.invoices}</strong>{' '}
                      invoice row{deleting.impact.invoices === 1 ? '' : 's'} will be{' '}
                      <strong>permanently deleted</strong> (cascade).
                      {deleting.impact.invoices > 0 && (
                        <span style={{ color: '#991b1b', fontWeight: 600 }}> Lifecycle data lost.</span>
                      )}
                    </li>
                    <li style={{ marginTop: 4 }}>
                      <strong>{deleting.impact.expenses}</strong>{' '}
                      expense row{deleting.impact.expenses === 1 ? '' : 's'} tagged with this name will become{' '}
                      <strong>orphans</strong> (rows stay; will surface in the orphan warning box of Block 4).
                    </li>
                  </ul>
                )}
              </div>

              <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                This cannot be undone. To confirm, type the client name exactly:
              </div>
              <div style={{
                fontFamily: 'monospace',
                background: '#f3f4f6',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                padding: '6px 10px',
                marginBottom: 8,
                fontSize: 14,
                color: '#111827',
                userSelect: 'none',
              }}>
                {deleteConfirmTarget(deleting.client)}
              </div>
              <input
                type="text"
                className="form-input"
                value={deleting.typed}
                onChange={(e) => setDeleting(d => d ? { ...d, typed: e.target.value } : d)}
                placeholder="Type the name above to enable Delete"
                autoFocus
                disabled={deleting.busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && deleteTypeMatches && !deleting.busy) {
                    confirmDelete()
                  }
                }}
              />
              {deleting.typed.length > 0 && !deleteTypeMatches && (
                <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
                  Doesn't match — check spelling (case doesn't matter).
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button onClick={closeDeleteModal} className="btn-secondary" disabled={deleting.busy}>
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="button"
                disabled={!deleteTypeMatches || deleting.busy || deleting.impact === null}
                style={{
                  background: deleteTypeMatches && !deleting.busy ? '#dc2626' : '#fca5a5',
                  color: '#fff',
                  cursor: deleteTypeMatches && !deleting.busy ? 'pointer' : 'not-allowed',
                }}
              >
                {deleting.busy ? '🗑️ Deleting…' : '🗑️ Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Defer-target picker modal ===== */}
      {/* Opens from the "→ Defer" button in Block 4. User picks the
          target year+month; we INSERT a row into expense_deferrals.
          Block 4 of the source month then renders that client's row
          as muted ("→ Deferred to X"), and Block 4 of the target
          month sums in the deferred amount. */}
      {deferModal && (
        <div className="modal-overlay" onClick={deferModal.busy ? undefined : closeDeferModal}>
          <div
            className="modal-content clients-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480 }}
          >
            <div className="modal-header">
              <h3>→ Defer to a later month</h3>
              <button className="modal-close" onClick={closeDeferModal} disabled={deferModal.busy}>×</button>
            </div>
            <div className="modal-body">
              {deferModal.error && (
                <div className="message error" style={{ marginBottom: 12 }}>{deferModal.error}</div>
              )}

              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Postponing reimbursables for:</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, color: '#111827' }}>
                  {deferModal.client.trade_name || deferModal.client.legal_name}
                </div>
                <div style={{ fontSize: 13, color: '#374151', marginTop: 4 }}>
                  Source month: <strong>{monthName(deferModal.sourceMonth)} {deferModal.sourceYear}</strong>
                  {' '}· amount: <strong>{formatEuro(reimbursableFor(deferModal.client))}</strong>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>
                  Target month
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={deferModal.targetMonth}
                    onChange={(e) => setDeferModal(d => d ? { ...d, targetMonth: parseInt(e.target.value, 10) } : d)}
                    className="form-input"
                    style={{ flex: 1 }}
                    disabled={deferModal.busy}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{monthName(m)}</option>
                    ))}
                  </select>
                  <select
                    value={deferModal.targetYear}
                    onChange={(e) => setDeferModal(d => d ? { ...d, targetYear: parseInt(e.target.value, 10) } : d)}
                    className="form-input"
                    style={{ width: 120 }}
                    disabled={deferModal.busy}
                  >
                    {/* Current source year + 3 future years usually enough. */}
                    {[0, 1, 2, 3].map(offset => {
                      const y = deferModal.sourceYear + offset
                      return <option key={y} value={y}>{y}</option>
                    })}
                  </select>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
                  These expenses will be bundled into the {' '}
                  <strong>{monthName(deferModal.targetMonth)} {deferModal.targetYear}</strong>{' '}
                  variable expense invoice for this client.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={closeDeferModal} className="btn-secondary" disabled={deferModal.busy}>
                Cancel
              </button>
              <button
                onClick={saveDeferral}
                className="button"
                disabled={deferModal.busy}
              >
                {deferModal.busy ? 'Saving…' : '→ Defer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
