import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import {
  parseISODate,
  nextMainRefSeq,
  nextMainRefSeqBatch,
  nextSubRefSeq,
  decideSubRefSeries,
  isSubRefManual,
  uuid,
} from '../../lib/refUtils'
import '../BankParser/BankParser.css'

/**
 * AddExpense — manual entry of cash, outgoing-only expenses.
 *
 * Scope (locked by user on May 12, 2026):
 *   - Cash account only (account_id = NULL on the expense row)
 *   - Outgoing direction only
 *   - Month-locked date (must fall within selected month/year)
 *   - Reuses Finalize logic for main-ref, sub-ref, reimbursable, shareholder tag, split mode
 *   - Duplicate detection: warn-but-allow on save (checks bank_transactions + expenses
 *     for similar amount + date + vendor in a ±3 day window)
 */
export function AddExpense({ selectedCompany, selectedMonth, selectedYear, onSwitchTab }) {
  const [companyId, setCompanyId] = useState(null)
  const [categories, setCategories] = useState([])
  const [subcategories, setSubcats] = useState([])
  const [allSubcats, setAllSubcats] = useState([])
  const [clientList, setClientList] = useState([])

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [saveError, setSaveError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(null)

  // Duplicate detection state
  const [duplicates, setDuplicates] = useState([])
  const [duplicatesChecked, setDuplicatesChecked] = useState(false)
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false)

  // Cash expenses table state (current selected month)
  const [cashExpenses, setCashExpenses] = useState([])
  const [cashTableLoading, setCashTableLoading] = useState(false)

  // Autocomplete suggestions — distinct vendor/description pairs from past expenses
  // for this company. Used to populate datalists on the vendor + description fields.
  const [vendorDescriptionPairs, setVendorDescriptionPairs] = useState([])

  // Edit mode — when an existing entry is being edited, this holds the row.
  // While editing, the form's Save Changes UPDATEs that row instead of INSERTing.
  const [editingEntry, setEditingEntry] = useState(null)
  const isEditMode = !!editingEntry

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState(null) // holds the expense row pending confirmation

  // -------------------------------------------------------------
  // Date defaulting: today if within selected month, otherwise the 1st
  // -------------------------------------------------------------
  const defaultDate = useMemo(() => {
    const today = new Date()
    if (today.getFullYear() === selectedYear && (today.getMonth() + 1) === selectedMonth) {
      return today.toISOString().slice(0, 10)
    }
    const mm = String(selectedMonth).padStart(2, '0')
    return `${selectedYear}-${mm}-01`
  }, [selectedMonth, selectedYear])

  // Form state
  const PREDEFINED_CLIENTS = [
    'Urban City', 'Blue Lagoon', 'Green Field Hotel', 'Kypseli',
    'BAD City Hall', 'BAD City SPA Hotel', 'Evia Mare', 'Other'
  ]
  const blankForm = {
    date: defaultDate,
    amount: '',
    vendor: '',
    description: '',
    category_id: '',
    subcategory_id: '',
    subcategory_name: '',
    is_reimbursable: false,
    client_name: '',
    custom_client_name: '',
    shareholder_code: '',
    manual_sub_ref_month: '',
    manual_sub_ref_seq: '',
  }
  const [form, setForm] = useState(blankForm)

  // -------------------------------------------------------------
  // Split mode (4 portions — outgoing only)
  // -------------------------------------------------------------
  const [isSplit, setIsSplit] = useState(false)
  const PORTION_TYPES = [
    { key: 'company', label: 'Company portion',              accent: '#185FA5' },
    { key: 'yk',      label: 'YK shareholder portion',       accent: '#3C3489' },
    { key: 'bk',      label: 'BK shareholder portion',       accent: '#3C3489' },
    { key: 'client',  label: 'Client portion (reimbursable)', accent: '#993556' },
  ]
  const blankPortions = PORTION_TYPES.reduce((acc, t) => ({
    ...acc,
    [t.key]: {
      amount: '',
      category_id: '',
      subcategory_id: '',
      subcategory_name: '',
      client_name: '',
      custom_client_name: '',
    }
  }), {})
  const [portions, setPortions] = useState(blankPortions)

  const totalAmount = Math.abs(Number(form.amount || 0))
  const portionTotal = useMemo(() =>
    PORTION_TYPES.reduce((sum, t) => sum + (parseFloat(portions[t.key].amount) || 0), 0),
    [portions]
  )
  const portionMatchesTotal = totalAmount > 0 && Math.abs(portionTotal - totalAmount) < 0.005

  const updatePortion = (key, patch) => {
    setPortions(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  const selectedCategory = useMemo(
    () => categories.find(c => c.id === form.category_id) || null,
    [categories, form.category_id]
  )
  const subRefSeries = useMemo(
    () => decideSubRefSeries(selectedCategory, form.is_reimbursable),
    [selectedCategory, form.is_reimbursable]
  )
  const subRefIsManual = useMemo(
    () => isSubRefManual(selectedCategory, form.is_reimbursable),
    [selectedCategory, form.is_reimbursable]
  )

  // -------------------------------------------------------------
  // Autocomplete derived lists (from vendorDescriptionPairs)
  //   vendorSuggestions     — distinct vendors sorted by frequency (most-used first)
  //   descriptionSuggestions — distinct descriptions, scoped to the current vendor
  //                            if known; otherwise all descriptions
  // -------------------------------------------------------------
  const vendorSuggestions = useMemo(() => {
    const counts = new Map()
    for (const row of vendorDescriptionPairs) {
      const v = (row.vendor || '').trim()
      if (!v) continue
      counts.set(v, (counts.get(v) || 0) + 1)
    }
    // Sort by frequency desc, then alphabetically
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([v]) => v)
  }, [vendorDescriptionPairs])

  const descriptionSuggestions = useMemo(() => {
    const currentVendor = (form.vendor || '').trim().toLowerCase()
    const counts = new Map()
    const scoped = currentVendor
      ? vendorDescriptionPairs.filter(r => (r.vendor || '').trim().toLowerCase() === currentVendor)
      : vendorDescriptionPairs
    for (const row of scoped) {
      const d = (row.description || '').trim()
      if (!d) continue
      counts.set(d, (counts.get(d) || 0) + 1)
    }
    let list = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([d]) => d)

    // If vendor-scoped list is empty AND user has typed a vendor, fall back to
    // global descriptions so they still get suggestions
    if (currentVendor && list.length === 0) {
      const allCounts = new Map()
      for (const row of vendorDescriptionPairs) {
        const d = (row.description || '').trim()
        if (!d) continue
        allCounts.set(d, (allCounts.get(d) || 0) + 1)
      }
      list = [...allCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([d]) => d)
    }
    return list
  }, [vendorDescriptionPairs, form.vendor])

  // -------------------------------------------------------------
  // Initial load: company id, categories, subcategories, clients
  // -------------------------------------------------------------
  useEffect(() => {
    const init = async () => {
      try {
        // Company
        const { data: comp, error: compErr } = await supabase
          .from('companies')
          .select('id')
          .eq('name', selectedCompany)
          .single()
        if (compErr) throw compErr
        setCompanyId(comp.id)

        // Categories (outgoing only)
        const { data: cats, error: catErr } = await supabase
          .from('expense_categories')
          .select('*')
          .eq('is_active', true)
          .eq('direction', 'out')
          .order('sort_order')
        if (catErr) throw catErr
        setCategories(cats || [])

        // All subcategories (for split mode per-portion picker)
        const { data: subs } = await supabase
          .from('expense_subcategories')
          .select('id, category_id, name, sort_order')
          .order('sort_order')
        setAllSubcats(subs || [])

        // Client list (from Client Reimbursement subcategories)
        const { data: clientCat } = await supabase
          .from('expense_categories')
          .select('id')
          .eq('name', 'Client Reimbursement')
          .single()
        if (clientCat) {
          const { data: clientSubs } = await supabase
            .from('expense_subcategories')
            .select('name, is_custom, sort_order')
            .eq('category_id', clientCat.id)
            .order('sort_order')
          setClientList(clientSubs || [])
        }
      } catch (e) {
        console.error('AddExpense init error:', e)
        setLoadError('Failed to load form data. Did you run the V2 migration?')
      }
    }
    init()
  }, [selectedCompany])

  // Load subcategories for the selected category (single mode)
  useEffect(() => {
    setSubcats([])
    setForm(f => ({ ...f, subcategory_id: '', subcategory_name: '' }))
    if (!form.category_id) return
    ;(async () => {
      const { data, error } = await supabase
        .from('expense_subcategories')
        .select('*')
        .eq('category_id', form.category_id)
        .order('sort_order')
      if (!error) setSubcats(data || [])
    })()
  }, [form.category_id])

  // Reset duplicate state if user changes amount/date/vendor
  useEffect(() => {
    setDuplicatesChecked(false)
    setDuplicatesAcknowledged(false)
    setDuplicates([])
  }, [form.amount, form.date, form.vendor])

  // Auto-clear save error / success when the user starts editing again.
  // Avoids the "stale error sitting under a now-valid form" UX problem.
  useEffect(() => {
    setSaveError(null)
    setSaveSuccess(null)
  }, [form, portions, isSplit])

  // Reset date default when month/year change (only if user hasn't touched it yet —
  // here we just always update to keep the form anchored to the selected month)
  useEffect(() => {
    setForm(f => ({ ...f, date: defaultDate }))
  }, [defaultDate])

  // -------------------------------------------------------------
  // Date month-lock check
  // -------------------------------------------------------------
  const dateInSelectedMonth = useMemo(() => {
    if (!form.date) return false
    const parts = parseISODate(form.date)
    return parts && parts.year === selectedYear && parts.month === selectedMonth
  }, [form.date, selectedMonth, selectedYear])

  // -------------------------------------------------------------
  // Subcategory picker change
  // -------------------------------------------------------------
  const handleSubcategoryChange = (subId) => {
    const sub = subcategories.find(s => s.id === subId)
    setForm(f => ({
      ...f,
      subcategory_id: subId,
      subcategory_name: sub ? sub.name : '',
    }))
  }

  // -------------------------------------------------------------
  // Duplicate detection — checks bank_transactions + expenses within ±3 days
  // for similar amount (±€0.50) and similar vendor (case-insensitive substring)
  // -------------------------------------------------------------
  const checkDuplicates = async () => {
    if (!companyId || !form.amount || !form.date || !form.vendor?.trim()) return []

    const amt = parseFloat(form.amount)
    const amtLow = amt - 0.5
    const amtHigh = amt + 0.5

    // ±7 days — bank posting often lags purchase by several days,
    // so a tighter window misses real matches.
    const DAY_WINDOW = 7
    const date = new Date(form.date)
    const dayBefore = new Date(date)
    dayBefore.setDate(date.getDate() - DAY_WINDOW)
    const dayAfter = new Date(date)
    dayAfter.setDate(date.getDate() + DAY_WINDOW)
    const isoLow = dayBefore.toISOString().slice(0, 10)
    const isoHigh = dayAfter.toISOString().slice(0, 10)

    const vendorLower = form.vendor.trim().toLowerCase()

    // -----------------------------------------------------------------
    // Bank transactions in window — sign-safe. Bank txs store outgoing
    // amounts as negative numbers, so we fetch by date range only and
    // filter by absolute amount in JS.
    // -----------------------------------------------------------------
    const { data: bankMatchesRaw } = await supabase
      .from('bank_transactions')
      .select('id, transaction_date, description, amount, status, matched_expense_id, accounts(name)')
      .eq('company_id', companyId)
      .gte('transaction_date', isoLow)
      .lte('transaction_date', isoHigh)

    const bankMatches = (bankMatchesRaw || []).filter(b => {
      const a = Math.abs(Number(b.amount || 0))
      return a >= amtLow && a <= amtHigh
    })

    // Expenses in window — full detail so the duplicate banner can show side-by-side context
    const { data: expenseMatches } = await supabase
      .from('expenses')
      .select(`
        id, date, vendor, description, amount, reference_number,
        sub_ref_series, sub_ref_month, sub_ref_seq,
        is_reimbursable, client_name, shareholder_code, status,
        subcategory_name, split_group_id, split_portion_index,
        account_id, bank_transaction_id, accounts(name),
        expense_categories(name)
      `)
      .eq('company_id', companyId)
      .gte('date', isoLow)
      .lte('date', isoHigh)
      .gte('amount', amtLow)
      .lte('amount', amtHigh)

    // -----------------------------------------------------------------
    // Split-group total check — if the user is entering the SUM of a
    // previously-split expense, the individual portions won't match by
    // amount (each is smaller). So we fetch all split portions in the
    // date window (regardless of amount), group by split_group_id,
    // sum the portions, and flag groups whose total matches.
    // -----------------------------------------------------------------
    const { data: splitPortions } = await supabase
      .from('expenses')
      .select(`
        id, date, vendor, amount, reference_number,
        split_group_id, split_portion_index,
        account_id, bank_transaction_id, accounts(name),
        expense_categories(name), subcategory_name,
        is_reimbursable, client_name, shareholder_code
      `)
      .eq('company_id', companyId)
      .not('split_group_id', 'is', null)
      .gte('date', isoLow)
      .lte('date', isoHigh)

    const splitGroupTotals = new Map()  // split_group_id → { total, portions: [] }
    for (const p of (splitPortions || [])) {
      if (!splitGroupTotals.has(p.split_group_id)) {
        splitGroupTotals.set(p.split_group_id, { total: 0, portions: [] })
      }
      const g = splitGroupTotals.get(p.split_group_id)
      g.total += Number(p.amount || 0)
      g.portions.push(p)
    }
    // Filter to groups whose total matches the entered amount within tolerance
    const matchingSplitGroups = []
    for (const [groupId, g] of splitGroupTotals.entries()) {
      if (g.total >= amtLow && g.total <= amtHigh) {
        g.portions.sort((a, b) => (a.split_portion_index ?? 0) - (b.split_portion_index ?? 0))
        matchingSplitGroups.push({ groupId, ...g })
      }
    }

    // Vendor similarity check — returns true if names overlap meaningfully.
    // No longer used as a filter (any amount+date match is flagged);
    // now used purely to label each match's strength.
    const vendorIsSimilar = (otherStr) => {
      const other = (otherStr || '').toLowerCase().trim()
      if (!other || !vendorLower) return false
      if (other.includes(vendorLower) || vendorLower.includes(other)) return true
      const otherFirst = other.split(/\s+/)[0]
      const ourFirst = vendorLower.split(/\s+/)[0]
      if (otherFirst && otherFirst.length >= 3 && vendorLower.includes(otherFirst)) return true
      if (ourFirst && ourFirst.length >= 3 && other.includes(ourFirst)) return true
      return false
    }

    // Amount-equality check — exact match if amounts are within €0.01 (rounding)
    const amountIsExact = (otherAmt) => Math.abs(Number(otherAmt) - amt) < 0.01

    // Date-equality check — exact match if same calendar day
    const dateIsExact = (otherIso) => otherIso === form.date

    const accountLabel = (acctName) => {
      if (!acctName) return 'Cash'
      if (acctName.includes('Mastercard')) return 'RMC'
      if (acctName.includes('Current')) return 'RCC'
      return acctName
    }

    // Strength classification:
    //   strong  — same exact date AND amount AND similar vendor (very likely duplicate)
    //   medium  — same exact date AND amount (different vendor)
    //   weak    — within ±3 days OR ±€0.50 (worth a glance but probably fine)
    const classifyStrength = (otherDate, otherAmt, otherVendor) => {
      const exactDate = dateIsExact(otherDate)
      const exactAmt  = amountIsExact(otherAmt)
      const vendorOk  = vendorIsSimilar(otherVendor)
      if (exactDate && exactAmt && vendorOk)  return 'strong'
      if (exactDate && exactAmt)              return 'medium'
      return 'weak'
    }

    // Build a set of bank_transaction_ids that already appear as expenses in our
    // results (those expenses were created from those bank txs via Bank Parser).
    // We'll skip the bank tx in that case to avoid showing the same payment twice.
    const linkedBankTxIds = new Set(
      (expenseMatches || [])
        .filter(e => e.bank_transaction_id)
        .map(e => e.bank_transaction_id)
    )

    const results = []
    for (const b of (bankMatches || [])) {
      // Skip if its finalized expense will already be shown
      if (linkedBankTxIds.has(b.id)) continue
      // Compare absolute amount so the sign of the bank tx doesn't confuse strength
      const absAmt = Math.abs(Number(b.amount || 0))
      results.push({
        type: 'bank',
        id: b.id,
        date: b.transaction_date,
        amount: absAmt,
        vendor: b.description,
        status: b.status,
        accountLabel: accountLabel(b.accounts?.name),
        strength: classifyStrength(b.transaction_date, absAmt, b.description),
        vendorSimilar: vendorIsSimilar(b.description),
        unfinalized: b.status === 'unmatched',
      })
    }
    for (const e of (expenseMatches || [])) {
      // Skip the row currently being edited — it's not a duplicate of itself
      if (editingEntry && e.id === editingEntry.id) continue
      results.push({
        type: 'expense',
        id: e.id,
        date: e.date,
        amount: e.amount,
        vendor: e.vendor,
        description: e.description,
        referenceNumber: e.reference_number,
        subRef: e.sub_ref_series
          ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
          : null,
        category: e.expense_categories?.name,
        subcategory: e.subcategory_name,
        isReimbursable: !!e.is_reimbursable,
        clientName: e.client_name,
        shareholderCode: e.shareholder_code,
        status: e.status,
        accountLabel: accountLabel(e.accounts?.name),
        isSplit: !!e.split_group_id,
        splitPortion: e.split_portion_index,
        source: e.account_id ? 'Bank Parser' : 'Manual (Cash)',
        strength: classifyStrength(e.date, e.amount, e.vendor),
        vendorSimilar: vendorIsSimilar(e.vendor),
      })
    }

    // Track which expense IDs are already shown as standalone matches —
    // we don't want to duplicate them when also surfacing their split-group.
    const shownExpenseIds = new Set(results.filter(r => r.type === 'expense').map(r => r.id))

    // Add matching split groups (as a single 'split-group' entry per group)
    for (const g of matchingSplitGroups) {
      // If any portion in this group is already in the standalone expense results,
      // drop those standalone entries — the group card is more informative.
      g.portions.forEach(p => shownExpenseIds.delete(p.id))
      const portionAmounts = g.portions.map(p => Number(p.amount || 0))
      const firstPortion = g.portions[0]
      const linkedBankTxId = g.portions.find(p => p.bank_transaction_id)?.bank_transaction_id
      results.push({
        type: 'split-group',
        id: g.groupId,
        date: firstPortion?.date,
        amount: g.total,
        vendor: firstPortion?.vendor,
        accountLabel: accountLabel(firstPortion?.accounts?.name),
        source: linkedBankTxId ? 'Bank Parser (split)' : 'Manual split',
        referenceNumber: g.portions.map(p => p.reference_number).filter(Boolean).join(', '),
        portionsBreakdown: g.portions.map(p => ({
          ref: p.reference_number,
          amount: Number(p.amount || 0),
          category: p.expense_categories?.name,
          subcategory: p.subcategory_name,
          shareholder: p.shareholder_code,
          reimbursable: p.is_reimbursable,
          client: p.client_name,
        })),
        portionCount: g.portions.length,
        portionAmounts,
        strength: classifyStrength(firstPortion?.date, g.total, firstPortion?.vendor),
        vendorSimilar: vendorIsSimilar(firstPortion?.vendor),
      })
    }
    // Filter standalone results to exclude any that were absorbed by a split-group card
    const finalResults = results.filter(r => r.type !== 'expense' || shownExpenseIds.has(r.id))

    // Sort: pending bank txs first (they're the most actionable — should be
    // finalized via Bank Parser instead of added as cash), then by strength.
    const strengthRank = { strong: 0, medium: 1, weak: 2 }
    finalResults.sort((a, b) => {
      // Pending bank txs always to the top
      if (a.unfinalized && !b.unfinalized) return -1
      if (b.unfinalized && !a.unfinalized) return 1
      return strengthRank[a.strength] - strengthRank[b.strength]
    })
    return finalResults
  }

  // -------------------------------------------------------------
  // Cash expenses table — loads all cash entries for the selected month
  // -------------------------------------------------------------
  const loadCashExpenses = async () => {
    if (!companyId) return
    setCashTableLoading(true)
    try {
      const mm = String(selectedMonth).padStart(2, '0')
      const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
      const isoLow = `${selectedYear}-${mm}-01`
      const isoHigh = `${selectedYear}-${mm}-${String(lastDay).padStart(2, '0')}`

      const { data, error } = await supabase
        .from('expenses')
        .select(`
          id, date, vendor, description, amount, reference_number,
          main_ref_year, main_ref_month, main_ref_seq,
          sub_ref_series, sub_ref_month, sub_ref_seq,
          is_reimbursable, client_name, shareholder_code, status,
          category_id, subcategory_id, subcategory_name,
          split_group_id, split_portion_index,
          expense_categories(name)
        `)
        .eq('company_id', companyId)
        .is('account_id', null)              // Cash only
        .eq('direction', 'out')
        .gte('date', isoLow)
        .lte('date', isoHigh)
        .order('main_ref_seq', { ascending: false })

      if (error) throw error
      setCashExpenses(data || [])
    } catch (e) {
      console.error('loadCashExpenses error:', e)
      setCashExpenses([])
    } finally {
      setCashTableLoading(false)
    }
  }

  // -------------------------------------------------------------
  // Autocomplete suggestions — load distinct (vendor, description) pairs
  // from all expenses for this company. Used to populate datalists.
  // -------------------------------------------------------------
  const loadAutocompleteSuggestions = async () => {
    if (!companyId) return
    try {
      const { data, error } = await supabase
        .from('expenses')
        .select('vendor, description')
        .eq('company_id', companyId)
        .not('vendor', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(500)  // Cap to recent 500 to keep payload small
      if (error) throw error
      setVendorDescriptionPairs(data || [])
    } catch (e) {
      console.error('loadAutocompleteSuggestions error:', e)
      setVendorDescriptionPairs([])
    }
  }

  // Reload the cash table whenever the company / month / year changes
  useEffect(() => {
    loadCashExpenses()
    loadAutocompleteSuggestions()
    // Also exit edit mode if the user changes month — the row being edited
    // is no longer in scope.
    if (editingEntry) {
      const parts = parseISODate(editingEntry.date)
      if (!parts || parts.year !== selectedYear || parts.month !== selectedMonth) {
        cancelEdit()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedMonth, selectedYear])

  // -------------------------------------------------------------
  // Edit / Delete actions on the cash table
  // -------------------------------------------------------------
  const handleEditRow = (expense) => {
    setEditingEntry(expense)
    // Pre-fill the form with the row's values
    const client = expense.client_name && PREDEFINED_CLIENTS.includes(expense.client_name)
      ? expense.client_name
      : (expense.client_name ? 'Other' : '')
    const customClient = expense.client_name && !PREDEFINED_CLIENTS.includes(expense.client_name)
      ? expense.client_name
      : ''

    setForm({
      date:             expense.date,
      amount:           String(expense.amount ?? ''),
      vendor:           expense.vendor || '',
      description:      expense.description || '',
      category_id:      expense.category_id || '',
      subcategory_id:   expense.subcategory_id || '',
      subcategory_name: expense.subcategory_name || '',
      is_reimbursable:  !!expense.is_reimbursable,
      client_name:      client,
      custom_client_name: customClient,
      shareholder_code: expense.shareholder_code || '',
      manual_sub_ref_month: expense.sub_ref_series === 'S' ? String(expense.sub_ref_month || '') : '',
      manual_sub_ref_seq:   expense.sub_ref_series === 'S' ? String(expense.sub_ref_seq || '')   : '',
    })
    // Editing always uses single mode (split editing is out of scope for v1)
    setIsSplit(false)
    setPortions(blankPortions)
    // Scroll the form into view
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelEdit = () => {
    setEditingEntry(null)
    setForm({ ...blankForm, date: defaultDate })
    setPortions(blankPortions)
    setIsSplit(false)
    setSaveError(null)
    setSaveSuccess(null)
  }

  const handleDeleteRow = async (expense) => {
    try {
      const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', expense.id)
      if (error) throw error
      setConfirmDelete(null)
      // If we were editing the row we just deleted, exit edit mode
      if (editingEntry && editingEntry.id === expense.id) cancelEdit()
      await loadCashExpenses()
      loadAutocompleteSuggestions()
      setSaveSuccess(`Deleted · ${expense.reference_number || 'expense'}`)
    } catch (err) {
      console.error('Delete error:', err)
      setSaveError(err.message || 'Failed to delete expense')
      setConfirmDelete(null)
    }
  }

  // -------------------------------------------------------------
  // Save
  // -------------------------------------------------------------
  const handleSave = async () => {
    setSaveError(null)
    setSaveSuccess(null)

    // ---- Validation ----
    if (!companyId) { setSaveError('Company not loaded yet'); return }
    if (!form.date) { setSaveError('Date is required'); return }
    if (!dateInSelectedMonth) {
      setSaveError(`Date must be within the selected month (${String(selectedMonth).padStart(2, '0')}/${selectedYear}). Change the dashboard month to enter expenses for a different period.`)
      return
    }
    if (!form.amount || parseFloat(form.amount) <= 0) {
      setSaveError('Amount must be greater than 0'); return
    }
    if (!form.vendor?.trim()) { setSaveError('Vendor is required'); return }

    if (isSplit) {
      return handleSplitSave()
    }

    if (!form.category_id) { setSaveError('Category is required'); return }
    if (subcategories.length > 0 && !form.subcategory_id) {
      setSaveError('Subcategory is required'); return
    }
    // Shareholder always required for cash entries — cash always comes from a
    // shareholder's pocket and must be attributed.
    if (!form.shareholder_code) {
      setSaveError(
        selectedCategory?.needs_shareholder_tag
          ? 'Please choose a shareholder (YK or BK) — this category requires it.'
          : 'Please choose which shareholder (YK or BK) paid this cash.'
      ); return
    }
    if (form.is_reimbursable) {
      const clientName = form.client_name === 'Other' ? form.custom_client_name?.trim() : form.client_name
      if (!clientName) { setSaveError('Please select a client/project for the reimbursable expense'); return }
    }
    if (subRefIsManual) {
      const m = parseInt(form.manual_sub_ref_month)
      const s = parseInt(form.manual_sub_ref_seq)
      if (!(m >= 1 && m <= 12)) { setSaveError('Sub-reference month must be 1–12'); return }
      if (!(s >= 1)) { setSaveError('Sub-reference sequence must be ≥ 1'); return }
    }

    // ---- Duplicate check (warn-but-allow) ----
    if (!duplicatesChecked) {
      const dups = await checkDuplicates()
      setDuplicates(dups)
      setDuplicatesChecked(true)
      if (dups.length > 0) {
        // Stop here — user must acknowledge the warning before save proceeds
        return
      }
    } else if (duplicates.length > 0 && !duplicatesAcknowledged) {
      return
    }

    try {
      setLoading(true)

      const dateParts = parseISODate(form.date)

      // Main reference: keep existing in edit mode, allocate new on insert
      let mainSeq, referenceNumber
      if (isEditMode) {
        mainSeq = editingEntry.main_ref_seq
        referenceNumber = editingEntry.reference_number
      } else {
        mainSeq = await nextMainRefSeq(companyId, dateParts.year, dateParts.month)
        const yy = String(dateParts.year).slice(-2)
        referenceNumber = `${yy}/${dateParts.month}/${mainSeq}`
      }

      // Sub reference: in edit mode keep existing if series & month match, otherwise reassign
      let subSeries = null, subMonth = null, subSeq = null
      if (subRefSeries) {
        subSeries = subRefSeries
        if (subRefIsManual) {
          subMonth = parseInt(form.manual_sub_ref_month)
          subSeq = parseInt(form.manual_sub_ref_seq)
        } else if (
          isEditMode
          && editingEntry.sub_ref_series === subRefSeries
          && editingEntry.sub_ref_month === dateParts.month
        ) {
          subMonth = editingEntry.sub_ref_month
          subSeq = editingEntry.sub_ref_seq
        } else {
          subMonth = dateParts.month
          subSeq = await nextSubRefSeq(companyId, subSeries, subMonth)
        }
      }

      const resolvedClient = form.is_reimbursable
        ? (form.client_name === 'Other' ? form.custom_client_name?.trim() : form.client_name)
        : null

      const expenseRow = {
        company_id:         companyId,
        category_id:        form.category_id,
        account_id:         null,                       // Cash
        date:               form.date,
        amount:             parseFloat(form.amount),
        currency:           'EUR',
        description:        form.description?.trim() || null,
        vendor:             form.vendor.trim(),
        reference_number:   referenceNumber,
        expense_type:       'regular',
        direction:          'out',
        main_ref_year:      dateParts.year,
        main_ref_month:     dateParts.month,
        main_ref_seq:       mainSeq,
        sub_ref_series:     subSeries,
        sub_ref_month:      subMonth,
        sub_ref_seq:        subSeq,
        subcategory_id:     form.subcategory_id || null,
        subcategory_name:   form.subcategory_name || null,
        is_reimbursable:    form.is_reimbursable,
        requires_reimbursement: form.is_reimbursable,
        client_name:        resolvedClient,
        shareholder_code:   form.shareholder_code || null,
        bank_transaction_id: null,                      // Manual entry — no bank tx
        status:             isEditMode ? editingEntry.status : 'pending',
      }

      if (isEditMode) {
        const { error: updErr } = await supabase
          .from('expenses')
          .update({ ...expenseRow, updated_at: new Date().toISOString() })
          .eq('id', editingEntry.id)
        if (updErr) throw updErr
        setSaveSuccess(`Expense updated · ${referenceNumber}`)
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('expenses')
          .insert([expenseRow])
          .select('id, reference_number')
          .single()
        if (insertErr) throw insertErr
        setSaveSuccess(`Expense saved · ${inserted.reference_number}`)
      }

      resetForm()
      await loadCashExpenses()
      loadAutocompleteSuggestions()
    } catch (err) {
      console.error('AddExpense save error:', err)
      setSaveError(err.message || 'Failed to save expense')
    } finally {
      setLoading(false)
    }
  }

  // -------------------------------------------------------------
  // Split save
  // -------------------------------------------------------------
  const handleSplitSave = async () => {
    if (!form.shareholder_code) {
      setSaveError('Please choose which shareholder (YK or BK) paid this cash split.'); return
    }
    if (!portionMatchesTotal) {
      setSaveError(`Portion total (€${portionTotal.toFixed(2)}) must match the total amount (€${totalAmount.toFixed(2)})`); return
    }
    const active = PORTION_TYPES.filter(t => (parseFloat(portions[t.key].amount) || 0) > 0)
    if (active.length < 2) {
      setSaveError('Split needs at least 2 portions. Uncheck split mode for a single-portion expense.'); return
    }
    for (const t of active) {
      const p = portions[t.key]
      if (!p.category_id) { setSaveError(`${t.label}: category is required`); return }
      const portionSubs = allSubcats.filter(s => s.category_id === p.category_id)
      if (portionSubs.length > 0 && !p.subcategory_id) {
        setSaveError(`${t.label}: subcategory is required`); return
      }
      if (t.key === 'client') {
        const clientFinal = p.client_name === 'Other' ? p.custom_client_name?.trim() : p.client_name
        if (!clientFinal) { setSaveError('Client portion: please select a client/project'); return }
      }
    }

    // Duplicate check (same logic — by total amount)
    if (!duplicatesChecked) {
      const dups = await checkDuplicates()
      setDuplicates(dups)
      setDuplicatesChecked(true)
      if (dups.length > 0) return
    } else if (duplicates.length > 0 && !duplicatesAcknowledged) {
      return
    }

    try {
      setLoading(true)
      const dateParts = parseISODate(form.date)

      // Allocate consecutive main_ref_seq numbers
      const seqs = await nextMainRefSeqBatch(companyId, dateParts.year, dateParts.month, active.length)
      const splitGroupId = uuid()
      const yy = String(dateParts.year).slice(-2)

      const rows = []
      for (let i = 0; i < active.length; i++) {
        const t = active[i]
        const p = portions[t.key]
        const cat = categories.find(c => c.id === p.category_id)
        const isReimbursable = t.key === 'client'
        const clientFinal = isReimbursable
          ? (p.client_name === 'Other' ? p.custom_client_name?.trim() : p.client_name)
          : null
        // Shareholder code per portion:
        //   YK portion → YK (the bucket)
        //   BK portion → BK (the bucket)
        //   Company / Client portion → the form-level paid-by shareholder
        const shareholderCode = t.key === 'yk'
          ? 'YK'
          : t.key === 'bk'
            ? 'BK'
            : (form.shareholder_code || null)

        let subSeries = decideSubRefSeries(cat, isReimbursable)
        let subMonth = null, subSeq = null
        if (subSeries) {
          subMonth = dateParts.month
          subSeq = await nextSubRefSeq(companyId, subSeries, subMonth)
        }

        rows.push({
          company_id:         companyId,
          category_id:        p.category_id,
          account_id:         null,                      // Cash
          date:               form.date,
          amount:             parseFloat(p.amount),
          currency:           'EUR',
          description:        form.description?.trim() || null,
          vendor:             form.vendor.trim(),
          reference_number:   `${yy}/${dateParts.month}/${seqs[i]}`,
          expense_type:       'regular',
          direction:          'out',
          main_ref_year:      dateParts.year,
          main_ref_month:     dateParts.month,
          main_ref_seq:       seqs[i],
          sub_ref_series:     subSeries,
          sub_ref_month:      subMonth,
          sub_ref_seq:        subSeq,
          subcategory_id:     p.subcategory_id || null,
          subcategory_name:   p.subcategory_name || null,
          is_reimbursable:    isReimbursable,
          requires_reimbursement: isReimbursable,
          client_name:        clientFinal,
          shareholder_code:   shareholderCode,
          bank_transaction_id: null,
          is_split:           true,
          split_group_id:     splitGroupId,
          split_portion_index: i + 1,
          status:             'pending',
        })
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('expenses')
        .insert(rows)
        .select('reference_number')
      if (insertErr) throw insertErr

      const refs = (inserted || []).map(r => r.reference_number).join(', ')
      setSaveSuccess(`Split saved · ${active.length} expenses · ${refs}`)
      resetForm()
      await loadCashExpenses()
      loadAutocompleteSuggestions()
    } catch (err) {
      console.error('AddExpense split save error:', err)
      setSaveError(err.message || 'Failed to save split expense')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setForm({ ...blankForm, date: defaultDate })
    setPortions(blankPortions)
    setIsSplit(false)
    setDuplicates([])
    setDuplicatesChecked(false)
    setDuplicatesAcknowledged(false)
    setEditingEntry(null)
  }

  // -------------------------------------------------------------
  // Render
  // -------------------------------------------------------------
  return (
    <div className="add-expense-page" style={{
      background: 'white',
      padding: 20,
      borderRadius: 8,
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, color: isEditMode ? '#b45309' : '#2E7D32' }}>
            {isEditMode ? `Edit Expense · ${editingEntry?.reference_number || ''}` : 'Add Expense'}
          </h2>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '4px 0 0' }}>
            {isEditMode
              ? <>Editing existing cash entry · changes will UPDATE the row · click <strong>Cancel edit</strong> to return to a fresh form</>
              : <>Manual entry · <strong>Cash · Outgoing</strong> · {String(selectedMonth).padStart(2, '0')}/{selectedYear} ({selectedCompany})</>
            }
          </p>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>
          Bank-paid expenses should be added via{' '}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); onSwitchTab && onSwitchTab('bank-parser') }}
            style={{ color: '#185FA5', textDecoration: 'underline' }}
          >
            Bank Statement Parser →
          </a>
        </div>
      </div>

      {loadError && <div className="message error">{loadError}</div>}
      {saveError && <div className="message error">{saveError}</div>}
      {saveSuccess && (
        <div className="message" style={{
          background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7',
          padding: 10, borderRadius: 4, marginBottom: 12,
        }}>
          ✓ {saveSuccess}
        </div>
      )}

      {/* Duplicate warning banner — rich cards showing every match's full details */}
      {duplicatesChecked && duplicates.length > 0 && !duplicatesAcknowledged && (
        <div style={{
          background: '#fef3c7', border: '1px solid #fcd34d',
          borderRadius: 4, padding: 12, marginBottom: 12,
        }}>
          <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
            ⚠ Possible duplicate{duplicates.length > 1 ? 's' : ''} detected
          </div>
          <div style={{ fontSize: 12, color: '#78350f', marginBottom: 10 }}>
            Found {duplicates.length} potential {duplicates.length > 1 ? 'matches' : 'match'} within ±3 days / ±€0.50.
            Checks both <strong>expenses already saved</strong> and <strong>bank transactions</strong> (matched + still-pending).
            Strength tags:{' '}
            <span style={{ color: '#991b1b', fontWeight: 600 }}>strong</span> = same date + amount + similar vendor,{' '}
            <span style={{ color: '#9a3412', fontWeight: 600 }}>medium</span> = same date + amount but different vendor,{' '}
            <span style={{ color: '#854d0e', fontWeight: 600 }}>weak</span> = close but not exact.
          </div>

          {/* Two-column layout: "You're entering" vs each match */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* Left card: your current entry */}
            <div style={{
              background: 'white', border: '1px dashed #d97706',
              borderRadius: 4, padding: 10,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#d97706', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                You're entering · 📋 Manual (Cash)
              </div>
              {/* Headline */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8,
                marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed #e5e7eb',
              }}>
                <span style={{
                  fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#92400e',
                }}>
                  (ref assigned on save)
                </span>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>
                  €{form.amount ? Number(form.amount).toFixed(2) : '0.00'}
                </span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  · {form.date ? (() => { const [y, m, dd] = form.date.split('-'); return `${dd}/${m}/${y}` })() : '—'}
                </span>
              </div>
              <DuplicateDetail
                vendor={form.vendor}
                amount={form.amount}
                date={form.date}
                category={categories.find(c => c.id === form.category_id)?.name}
                subcategory={form.subcategory_name}
                accountLabel="Cash"
                source="Manual (Cash)"
                isReimbursable={form.is_reimbursable}
                clientName={form.is_reimbursable ? (form.client_name === 'Other' ? form.custom_client_name : form.client_name) : null}
                shareholderCode={form.shareholder_code}
                description={form.description}
                hideRefAmountDate
              />
            </div>

            {/* Right column: scrollable list of matches */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
              {duplicates.map((d, i) => {
                // Build the prominent headline: refs + amount + date upfront
                const dateStr = (() => {
                  if (!d.date) return ''
                  const [y, m, dd] = d.date.split('-')
                  return `${dd}/${m}/${y}`
                })()
                const amountStr = `€${Number(d.amount || 0).toFixed(2)}`
                const refStr = d.referenceNumber
                  ? `${d.referenceNumber}${d.subRef ? ` · ${d.subRef}` : ''}`
                  : null

                // Strength colors
                const strengthStyle = {
                  strong: { bg: '#fecaca', fg: '#991b1b', label: 'Strong match' },
                  medium: { bg: '#fed7aa', fg: '#9a3412', label: 'Medium · different vendor' },
                  weak:   { bg: '#fef3c7', fg: '#854d0e', label: 'Weak · close but not exact' },
                }[d.strength] || { bg: '#fef3c7', fg: '#854d0e', label: 'Match' }

                return (
                  <div key={i} style={{
                    background: 'white',
                    border: `1px solid ${d.strength === 'strong' ? '#fca5a5' : d.strength === 'medium' ? '#fdba74' : '#fcd34d'}`,
                    borderLeft: `4px solid ${strengthStyle.fg}`,
                    borderRadius: 4, padding: 10,
                  }}>
                    {/* Strength badge + type chip + status — top row */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      marginBottom: 4, gap: 8,
                    }}>
                      <div style={{
                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                        color: d.type === 'bank' ? '#1e40af'
                             : d.type === 'split-group' ? '#7c2d12'
                             : (d.accountLabel === 'Cash' ? '#0c4a6e' : '#7c2d12')
                      }}>
                        {d.type === 'bank'
                          ? `🏦 Bank tx · ${d.accountLabel}${d.status === 'unmatched' ? ' · still pending' : ''}`
                          : d.type === 'split-group'
                            ? `🔀 Split group · ${d.portionCount} portions · ${d.source}`
                            : `📋 Expense · ${d.source}${d.isSplit ? ` · Split ${d.splitPortion}` : ''}`}
                      </div>
                      <span style={{
                        background: strengthStyle.bg, color: strengthStyle.fg,
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                        whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.3,
                      }}>
                        {strengthStyle.label}
                      </span>
                    </div>

                    {/* Headline — the three things you usually want first */}
                    <div style={{
                      display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8,
                      marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed #e5e7eb',
                    }}>
                      {refStr && (
                        <span style={{
                          fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#1f2937',
                        }}>
                          {refStr}
                        </span>
                      )}
                      <span style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>
                        {amountStr}
                      </span>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>· {dateStr}</span>
                    </div>

                    <DuplicateDetail
                      vendor={d.vendor}
                      amount={d.amount}
                      date={d.date}
                      category={d.category}
                      subcategory={d.subcategory}
                      accountLabel={d.accountLabel}
                      source={d.source}
                      referenceNumber={d.referenceNumber}
                      subRef={d.subRef}
                      isReimbursable={d.isReimbursable}
                      clientName={d.clientName}
                      shareholderCode={d.shareholderCode}
                      status={d.status}
                      description={d.description}
                      hideRefAmountDate /* shown in headline, no need to repeat */
                    />

                    {/* Per-portion breakdown for split groups */}
                    {d.type === 'split-group' && d.portionsBreakdown && (
                      <div style={{
                        marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e5e7eb',
                      }}>
                        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 4 }}>
                          Portion breakdown ({d.portionCount} parts totaling €{Number(d.amount).toFixed(2)}):
                        </div>
                        {d.portionsBreakdown.map((p, idx) => (
                          <div key={idx} style={{
                            fontSize: 11, color: '#374151', marginBottom: 2,
                            display: 'flex', justifyContent: 'space-between', gap: 4,
                          }}>
                            <span style={{ fontFamily: 'monospace' }}>
                              {p.ref || `Portion ${idx + 1}`}
                              {p.shareholder && <span style={{ color: '#3730a3', marginLeft: 4 }}>· {p.shareholder}</span>}
                              {p.reimbursable && <span style={{ color: '#7c2d12', marginLeft: 4 }}>· Reimb</span>}
                            </span>
                            <span>
                              {[p.category, p.subcategory].filter(Boolean).join(' → ')}
                              {' '}<strong>€{Number(p.amount).toFixed(2)}</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button
              onClick={() => setDuplicatesAcknowledged(true)}
              className="button"
              style={{ background: '#dc2626', borderColor: '#dc2626' }}
            >
              Save anyway →
            </button>
            <button
              onClick={() => { setDuplicatesChecked(false); setDuplicates([]) }}
              className="btn-secondary"
            >
              Cancel — let me review
            </button>
          </div>
        </div>
      )}

      {/* ---------- Form ---------- */}

      {/* Row 1: Date · Amount */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="form-group">
          <label>Payment date *</label>
          <input
            type="date"
            value={form.date}
            min={`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`}
            max={`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(new Date(selectedYear, selectedMonth, 0).getDate()).padStart(2, '0')}`}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="form-input"
          />
          {form.date && !dateInSelectedMonth && (
            <small style={{ color: '#dc2626', fontSize: 12 }}>
              Date is outside {String(selectedMonth).padStart(2, '0')}/{selectedYear}.
              Change the dashboard month to enter a different period.
            </small>
          )}
        </div>
        <div className="form-group">
          <label>Amount (€) *</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="form-input"
            placeholder="0.00"
          />
        </div>
      </div>

      {/* Vendor — datalist autocompletes from past entries */}
      <div className="form-group">
        <label>Vendor *</label>
        <input
          type="text"
          value={form.vendor}
          onChange={(e) => setForm({ ...form, vendor: e.target.value })}
          className="form-input"
          placeholder="Vendor / counterparty name (type to see past vendors)"
          list="addexpense-vendor-suggestions"
          autoComplete="off"
        />
        <datalist id="addexpense-vendor-suggestions">
          {vendorSuggestions.map(v => <option key={v} value={v} />)}
        </datalist>
        {vendorSuggestions.length > 0 && (
          <small style={{ color: '#6b7280', fontSize: 11 }}>
            {vendorSuggestions.length} known vendor{vendorSuggestions.length === 1 ? '' : 's'} for {selectedCompany}.
          </small>
        )}
      </div>

      {/* Split toggle */}
      <div className="form-group" style={{
        background: '#eef2ff', border: '1px solid #c7d2fe',
        borderRadius: 4, padding: 10,
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
          <input
            type="checkbox"
            checked={isSplit}
            onChange={(e) => setIsSplit(e.target.checked)}
          />
          <span style={{ fontWeight: 500 }}>Split this expense across portions</span>
        </label>
        {isSplit && (
          <small style={{ color: '#4338ca', fontSize: 12, marginTop: 4, display: 'block' }}>
            Each filled portion creates its own expense row with a consecutive main reference number, linked together.
          </small>
        )}
      </div>

      {/* In split mode, the paid-by shareholder picker lives here at the top
          (since the Company / Client portions don't have an auto-assigned shareholder). */}
      {isSplit && (
        <div className="form-group" style={{
          background: '#eef2ff', border: '1px solid #c7d2fe',
          borderRadius: 4, padding: 12,
        }}>
          <label style={{ color: '#3730a3' }}>
            Paid by (cash from) * <span style={{ color: '#6366f1', fontWeight: 400, fontSize: 12 }}>
              (which shareholder's cash paid this — applies to Company/Client portions; YK/BK portions keep their own tag)
            </span>
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {['YK', 'BK'].map(code => (
              <label key={code} style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                border: `2px solid ${form.shareholder_code === code ? '#3730a3' : '#c7d2fe'}`,
                background: form.shareholder_code === code ? '#e0e7ff' : 'white',
                borderRadius: 4, cursor: 'pointer', fontWeight: form.shareholder_code === code ? 600 : 400,
              }}>
                <input
                  type="radio"
                  name="split-paid-by"
                  value={code}
                  checked={form.shareholder_code === code}
                  onChange={(e) => setForm({ ...form, shareholder_code: e.target.value })}
                />
                {code}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* SPLIT MODE — portion grid */}
      {isSplit && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          {PORTION_TYPES.map(t => {
            const p = portions[t.key]
            const portionCats = (t.key === 'yk' || t.key === 'bk')
              ? categories.filter(c => c.needs_shareholder_tag)
              : categories
            const portionSubs = allSubcats.filter(s => s.category_id === p.category_id)
            const isActive = (parseFloat(p.amount) || 0) > 0
            return (
              <div key={t.key} style={{
                border: `0.5px solid ${isActive ? '#9ca3af' : '#e5e7eb'}`,
                borderLeft: `3px solid ${isActive ? t.accent : '#e5e7eb'}`,
                borderRadius: 4,
                padding: 10,
                opacity: isActive ? 1 : 0.7,
              }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: t.accent, marginBottom: 6 }}>
                  {t.label}
                </div>
                <label style={{ fontSize: 11, color: '#6b7280' }}>Amount (€)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={p.amount}
                  onChange={(e) => updatePortion(t.key, { amount: e.target.value })}
                  className="form-input"
                  style={{ marginBottom: 6 }}
                />
                <label style={{ fontSize: 11, color: '#6b7280' }}>Category *</label>
                <select
                  value={p.category_id}
                  onChange={(e) => updatePortion(t.key, {
                    category_id: e.target.value,
                    subcategory_id: '', subcategory_name: '',
                  })}
                  className="form-input"
                  style={{ marginBottom: 6 }}
                >
                  <option value="">— Select —</option>
                  {portionCats.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {portionSubs.length > 0 && (
                  <>
                    <label style={{ fontSize: 11, color: '#6b7280' }}>Subcategory *</label>
                    <select
                      value={p.subcategory_id}
                      onChange={(e) => {
                        const sub = portionSubs.find(s => s.id === e.target.value)
                        updatePortion(t.key, {
                          subcategory_id: e.target.value,
                          subcategory_name: sub ? sub.name : '',
                        })
                      }}
                      className="form-input"
                      style={{ marginBottom: 6 }}
                    >
                      <option value="">— Select —</option>
                      {portionSubs.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </>
                )}
                {t.key === 'client' && isActive && (
                  <>
                    <label style={{ fontSize: 11, color: '#6b7280' }}>Client / project *</label>
                    <select
                      value={p.client_name}
                      onChange={(e) => updatePortion('client', { client_name: e.target.value, custom_client_name: '' })}
                      className="form-input"
                      style={{ marginBottom: 4 }}
                    >
                      <option value="">— Select client —</option>
                      {clientList.map(c => (
                        <option key={c.name} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    {p.client_name === 'Other' && (
                      <input
                        type="text"
                        placeholder="Custom client name"
                        value={p.custom_client_name}
                        onChange={(e) => updatePortion('client', { custom_client_name: e.target.value })}
                        className="form-input"
                      />
                    )}
                  </>
                )}
              </div>
            )
          })}
          {/* Validation bar */}
          <div style={{
            gridColumn: '1 / -1',
            padding: '8px 12px',
            background: portionMatchesTotal ? '#d1fae5' : '#fef3c7',
            color: portionMatchesTotal ? '#065f46' : '#92400e',
            border: `1px solid ${portionMatchesTotal ? '#6ee7b7' : '#fcd34d'}`,
            borderRadius: 4,
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <span>Portions total: <strong>€{portionTotal.toFixed(2)}</strong></span>
            <span>
              {totalAmount === 0
                ? 'Enter a total amount first'
                : portionMatchesTotal
                  ? `matches total amount (€${totalAmount.toFixed(2)})`
                  : `does not match total amount (€${totalAmount.toFixed(2)})`}
            </span>
          </div>
        </div>
      )}

      {/* SINGLE MODE fields */}
      {!isSplit && (
        <>
          <div className="form-group">
            <label>Category *</label>
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="form-input"
            >
              <option value="">— Select category —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {subcategories.length > 0 && (
            <div className="form-group">
              <label>Subcategory *</label>
              <select
                value={form.subcategory_id}
                onChange={(e) => handleSubcategoryChange(e.target.value)}
                className="form-input"
              >
                <option value="">— Select subcategory —</option>
                {subcategories.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Shareholder — always required for cash entries (cash always comes from a
              shareholder's pocket). For shareholder-tagged categories, this also doubles
              as the "whose bucket" tag. */}
          <div className="form-group" style={{
            background: '#eef2ff', border: '1px solid #c7d2fe',
            borderRadius: 4, padding: 12,
          }}>
            <label style={{ color: '#3730a3' }}>
              {selectedCategory?.needs_shareholder_tag
                ? <>Shareholder * <span style={{ color: '#6366f1', fontWeight: 400, fontSize: 12 }}>(this category requires a shareholder tag)</span></>
                : <>Paid by (cash from) * <span style={{ color: '#6366f1', fontWeight: 400, fontSize: 12 }}>(which shareholder's cash paid for this)</span></>
              }
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <label style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                border: `2px solid ${form.shareholder_code === 'YK' ? '#3730a3' : '#c7d2fe'}`,
                background: form.shareholder_code === 'YK' ? '#e0e7ff' : 'white',
                borderRadius: 4, cursor: 'pointer', fontWeight: form.shareholder_code === 'YK' ? 600 : 400,
              }}>
                <input
                  type="radio"
                  name="paid-by-shareholder"
                  value="YK"
                  checked={form.shareholder_code === 'YK'}
                  onChange={(e) => setForm({ ...form, shareholder_code: e.target.value })}
                />
                YK
              </label>
              <label style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                border: `2px solid ${form.shareholder_code === 'BK' ? '#3730a3' : '#c7d2fe'}`,
                background: form.shareholder_code === 'BK' ? '#e0e7ff' : 'white',
                borderRadius: 4, cursor: 'pointer', fontWeight: form.shareholder_code === 'BK' ? 600 : 400,
              }}>
                <input
                  type="radio"
                  name="paid-by-shareholder"
                  value="BK"
                  checked={form.shareholder_code === 'BK'}
                  onChange={(e) => setForm({ ...form, shareholder_code: e.target.value })}
                />
                BK
              </label>
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={form.is_reimbursable}
                onChange={(e) => setForm({
                  ...form,
                  is_reimbursable: e.target.checked,
                  client_name: e.target.checked ? form.client_name : '',
                  custom_client_name: e.target.checked ? form.custom_client_name : '',
                })}
              />
              Mark as Reimbursable (assigns R sub-reference, overrides category default)
            </label>
          </div>

          {form.is_reimbursable && (
            <div className="form-group" style={{
              background: '#fef3c7', border: '1px solid #fcd34d',
              borderRadius: 4, padding: 12,
            }}>
              <label>Client / Project *</label>
              <select
                value={form.client_name}
                onChange={(e) => setForm({ ...form, client_name: e.target.value, custom_client_name: '' })}
                className="form-input"
              >
                <option value="">— Select client / project —</option>
                {clientList.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
              {form.client_name === 'Other' && (
                <input
                  type="text"
                  value={form.custom_client_name}
                  onChange={(e) => setForm({ ...form, custom_client_name: e.target.value })}
                  className="form-input"
                  placeholder="Enter custom client / project name"
                  style={{ marginTop: 8 }}
                />
              )}
              <small style={{ color: '#92400e', fontSize: 12, marginTop: 4, display: 'block' }}>
                This expense will be recoverable from the selected client.
                When they pay back, you'll match it under <strong>Client Reimbursement (incoming)</strong>.
              </small>
            </div>
          )}

          {/* Sub-reference preview */}
          {subRefSeries && !subRefIsManual && (
            <div className="form-group">
              <label>Sub-reference (auto)</label>
              <div style={{
                fontFamily: 'monospace', padding: 8,
                background: '#f0f9ff', border: '1px solid #bae6fd',
                borderRadius: 4, color: '#075985',
              }}>
                {subRefSeries}{parseISODate(form.date)?.month || '?'}/?
                <span style={{ marginLeft: 8, color: '#0369a1', fontSize: 12 }}>
                  (sequence assigned on save)
                </span>
              </div>
            </div>
          )}

          {subRefIsManual && (
            <div className="form-group">
              <label>Sub-reference (manual entry for Salaries/Contributions) *</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontSize: 16 }}>S</span>
                <input
                  type="number"
                  min={1} max={12}
                  placeholder="month"
                  value={form.manual_sub_ref_month}
                  onChange={(e) => setForm({ ...form, manual_sub_ref_month: e.target.value })}
                  className="form-input"
                  style={{ width: 80 }}
                />
                <span style={{ fontFamily: 'monospace', fontSize: 16 }}>/</span>
                <input
                  type="number"
                  min={1}
                  placeholder="seq"
                  value={form.manual_sub_ref_seq}
                  onChange={(e) => setForm({ ...form, manual_sub_ref_seq: e.target.value })}
                  className="form-input"
                  style={{ width: 100 }}
                />
              </div>
              <small style={{ color: '#6b7280', fontSize: 12 }}>
                The sub-ref month can be any month (not bound to dashboard selection) —
                reflects the accounting/work period, not necessarily the payment month.
              </small>
            </div>
          )}
        </>
      )}

      {/* Description (always shown) */}
      <div className="form-group">
        <label>Description (optional)</label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="form-input"
          placeholder={
            form.vendor && descriptionSuggestions.length > 0
              ? `Suggestions from past ${form.vendor.trim()} entries — type or pick`
              : 'Notes or extra detail (type to see past descriptions)'
          }
          list="addexpense-description-suggestions"
          autoComplete="off"
        />
        <datalist id="addexpense-description-suggestions">
          {descriptionSuggestions.map(d => <option key={d} value={d} />)}
        </datalist>
        {descriptionSuggestions.length > 0 && (
          <small style={{ color: '#6b7280', fontSize: 11 }}>
            {(() => {
              const currentVendor = (form.vendor || '').trim().toLowerCase()
              const scoped = currentVendor && vendorDescriptionPairs.some(r => (r.vendor || '').trim().toLowerCase() === currentVendor)
              return scoped
                ? `${descriptionSuggestions.length} past description${descriptionSuggestions.length === 1 ? '' : 's'} used with “${form.vendor.trim()}”.`
                : `${descriptionSuggestions.length} known description${descriptionSuggestions.length === 1 ? '' : 's'} from all expenses.`
            })()}
          </small>
        )}
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
        {(() => {
          // Visual state for the save button:
          //   - red + "Duplicate detected — review above" when a duplicate is found
          //     and the user hasn't yet clicked "Save anyway" in the banner
          //   - red + "Save anyway" when acknowledged
          //   - normal otherwise
          const hasUnacknowledgedDup = duplicatesChecked && duplicates.length > 0 && !duplicatesAcknowledged
          const hasAcknowledgedDup   = duplicatesChecked && duplicates.length > 0 && duplicatesAcknowledged

          const dangerStyle = (hasUnacknowledgedDup || hasAcknowledgedDup)
            ? { background: '#dc2626', borderColor: '#dc2626' }
            : undefined

          let label
          if (loading) {
            label = '💾 Saving...'
          } else if (hasUnacknowledgedDup) {
            label = '⚠ Duplicate detected — review above'
          } else if (hasAcknowledgedDup) {
            label = isEditMode
              ? `Save anyway · update ${editingEntry?.reference_number || ''}`
              : isSplit
                ? `Save anyway · ${PORTION_TYPES.filter(t => (parseFloat(portions[t.key].amount) || 0) > 0).length} portions`
                : 'Save anyway →'
          } else if (isEditMode) {
            label = `💾 Save Changes${editingEntry?.reference_number ? ` · ${editingEntry.reference_number}` : ''}`
          } else if (isSplit) {
            label = `✓ Save Split (${PORTION_TYPES.filter(t => (parseFloat(portions[t.key].amount) || 0) > 0).length} portions)`
          } else {
            label = '✓ Save Expense'
          }

          return (
            <button
              onClick={handleSave}
              className="button"
              style={dangerStyle}
              disabled={loading || !!loadError}
              title={hasUnacknowledgedDup ? 'Scroll up — possible duplicate above. Click “Save anyway →” in the banner to override.' : undefined}
            >
              {label}
            </button>
          )
        })()}
        {isEditMode ? (
          <button onClick={cancelEdit} className="btn-secondary" disabled={loading}>
            Cancel edit
          </button>
        ) : (
          <button onClick={resetForm} className="btn-secondary" disabled={loading}>
            Clear
          </button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
          Saved expenses appear in{' '}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); onSwitchTab && onSwitchTab('view-expenses') }}
            style={{ color: '#185FA5', textDecoration: 'underline' }}
          >View Expenses →</a>
        </div>
      </div>

      {/* ============================================================ */}
      {/* Cash payments this month — table of all manual cash entries   */}
      {/* ============================================================ */}
      <CashExpensesTable
        cashExpenses={cashExpenses}
        loading={cashTableLoading}
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        editingId={editingEntry?.id}
        onEdit={handleEditRow}
        onDelete={(expense) => setConfirmDelete(expense)}
      />

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div
            className="modal-content"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Delete cash expense?</h3>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0 }}>
                This will permanently delete the following expense. This cannot be undone.
              </p>
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: 4, padding: 10, fontSize: 13,
              }}>
                <div><strong>{confirmDelete.vendor}</strong> · €{Number(confirmDelete.amount).toFixed(2)}</div>
                <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                  Ref {confirmDelete.reference_number}
                  {confirmDelete.sub_ref_series && ` · ${confirmDelete.sub_ref_series}${confirmDelete.sub_ref_month}/${confirmDelete.sub_ref_seq}`}
                  {' · '}
                  {(() => { const [y, m, d] = confirmDelete.date.split('-'); return `${d}/${m}/${y}` })()}
                </div>
                {confirmDelete.split_group_id && (
                  <div style={{ color: '#b45309', fontSize: 12, marginTop: 6 }}>
                    ⚠ This is part of a split (portion {confirmDelete.split_portion_index}).
                    Deleting only this portion will leave the other portions intact —
                    you may need to clean those up too.
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => handleDeleteRow(confirmDelete)}
                className="button"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================
// DuplicateDetail — renders a compact card of expense/transaction details
// used in both the duplicate-comparison banner and the "you're entering" preview
// =============================================================
function DuplicateDetail({
  vendor, amount, date,
  category, subcategory,
  accountLabel, source,
  referenceNumber, subRef,
  isReimbursable, clientName, shareholderCode,
  status, description,
  hideRefAmountDate,
}) {
  const dateStr = (() => {
    if (!date) return '—'
    const [y, m, d] = date.split('-')
    return `${d}/${m}/${y}`
  })()

  const Row = ({ label, value, mono }) => (
    <div style={{ display: 'flex', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ width: 90, color: '#6b7280', flexShrink: 0 }}>{label}</div>
      <div style={{
        color: '#1f2937', fontWeight: 500,
        fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-word',
      }}>
        {value || '—'}
      </div>
    </div>
  )

  return (
    <div>
      <Row label="Vendor" value={vendor} />
      {!hideRefAmountDate && (
        <>
          <Row label="Amount" value={amount ? `€${Number(amount).toFixed(2)}` : '—'} />
          <Row label="Date" value={dateStr} />
          {referenceNumber && <Row label="Main ref" value={referenceNumber} mono />}
          {subRef && <Row label="Sub-ref" value={subRef} mono />}
        </>
      )}
      <Row label="Account" value={accountLabel} />
      {source && <Row label="Source" value={source} />}
      {(category || subcategory) && (
        <Row
          label="Category"
          value={[category, subcategory].filter(Boolean).join(' → ')}
        />
      )}
      {isReimbursable && (
        <Row
          label="Reimb"
          value={clientName ? `Yes · ${clientName}` : 'Yes'}
        />
      )}
      {shareholderCode && <Row label="Shareholder" value={shareholderCode} />}
      {status && <Row label="Status" value={status} />}
      {description && <Row label="Description" value={description} />}
    </div>
  )
}

// =============================================================
// CashExpensesTable — list of cash entries for the selected month
// with Edit + Delete actions
// =============================================================
function CashExpensesTable({
  cashExpenses,
  loading,
  selectedMonth,
  selectedYear,
  editingId,
  onEdit,
  onDelete,
}) {
  const fmtDate = (iso) => {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  const fmtSubRef = (e) => e.sub_ref_series
    ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}`
    : '—'

  const totalAmount = cashExpenses.reduce((s, e) => s + Number(e.amount || 0), 0)

  return (
    <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #e5e7eb' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'baseline', marginBottom: 12,
      }}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#1f2937' }}>
          Cash payments this month
          <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
            ({String(selectedMonth).padStart(2, '0')}/{selectedYear})
          </span>
        </h3>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          {cashExpenses.length} {cashExpenses.length === 1 ? 'entry' : 'entries'}
          {cashExpenses.length > 0 && ` · total €${totalAmount.toFixed(2)}`}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 20, color: '#6b7280', fontSize: 13 }}>Loading…</div>
      ) : cashExpenses.length === 0 ? (
        <div style={{
          padding: 20, color: '#6b7280', fontSize: 13,
          background: '#f9fafb', borderRadius: 4, textAlign: 'center',
        }}>
          No cash payments yet for this month. Add one above to see it here.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={th}>Date</th>
                <th style={th}>Main ref</th>
                <th style={th}>Sub ref</th>
                <th style={th}>Vendor</th>
                <th style={th}>Category</th>
                <th style={th} title="Which shareholder paid the cash">Paid by</th>
                <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                <th style={th}>Flags</th>
                <th style={th}>Status</th>
                <th style={{ ...th, width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cashExpenses.map(e => {
                const isEditing = editingId === e.id
                return (
                  <tr
                    key={e.id}
                    style={{
                      borderBottom: '1px solid #f3f4f6',
                      background: isEditing ? '#fef3c7' : '#dbeafe33', // subtle cash tint
                    }}
                  >
                    <td style={td}>{fmtDate(e.date)}</td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                      {e.reference_number || '—'}
                      {e.split_group_id && (
                        <span style={{ marginLeft: 4, color: '#7c2d12', fontSize: 11 }}>
                          (split {e.split_portion_index})
                        </span>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{fmtSubRef(e)}</td>
                    <td style={td}>{e.vendor || '—'}</td>
                    <td style={td}>
                      {e.expense_categories?.name || '—'}
                      {e.subcategory_name && (
                        <div style={{ fontSize: 11, color: '#6b7280' }}>→ {e.subcategory_name}</div>
                      )}
                    </td>
                    <td style={td}>
                      {e.shareholder_code ? (
                        <span style={chip('#e0e7ff', '#3730a3')}>
                          {e.shareholder_code}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af', fontSize: 11 }}>—</span>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 500 }}>
                      €{Number(e.amount || 0).toFixed(2)}
                    </td>
                    <td style={td}>
                      {e.is_reimbursable && (
                        <span style={chip('#fee2e2', '#7c2d12')}>
                          Reimb{e.client_name ? ` · ${e.client_name}` : ''}
                        </span>
                      )}
                      {e.shareholder_code && (
                        <span style={chip('#e0e7ff', '#3730a3')}>
                          {e.shareholder_code}
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      <span style={chip(
                        e.status === 'approved' ? '#d1fae5' : e.status === 'locked' ? '#e5e7eb' : '#fef3c7',
                        e.status === 'approved' ? '#065f46' : e.status === 'locked' ? '#374151' : '#92400e',
                      )}>
                        {e.status || 'pending'}
                      </span>
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => onEdit(e)}
                          disabled={isEditing}
                          title={isEditing ? 'Currently editing this entry' : 'Edit this entry'}
                          style={btnIcon(isEditing ? '#9ca3af' : '#185FA5')}
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => onDelete(e)}
                          title="Delete this entry"
                          style={btnIcon('#dc2626')}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const th = {
  textAlign: 'left', padding: '8px 10px', fontSize: 12,
  color: '#374151', fontWeight: 600,
}
const td = {
  padding: '8px 10px', verticalAlign: 'top',
}
const chip = (bg, fg) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 999,
  background: bg, color: fg, fontSize: 11, fontWeight: 500, marginRight: 4,
})
const btnIcon = (color) => ({
  background: 'white', border: `1px solid ${color}`, color,
  borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 13,
})
