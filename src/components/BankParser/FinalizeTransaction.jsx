import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import {
  parseISODate,
  nextMainRefSeq,
  nextMainRefSeqBatch,
  nextSubRefSeq,
  decideSubRefSeries,
  isSubRefManual,
  formatMainRef,
  formatSubRef,
  buildMainRef,
  uuid,
} from '../../lib/refUtils'
import { MonthMultiSelect } from '../MonthMultiSelect/MonthMultiSelect'
import './BankParser.css'

/**
 * FinalizeTransaction modal — categorizes a pending bank transaction and creates
 * the corresponding expenses row (Path 1 workflow).
 *
 * On submit it:
 *   1. Computes main_ref (next seq for company + payment-date year/month)
 *   2. Decides sub_ref series (R if reimbursable, else category-derived T/S)
 *   3. Auto-assigns sub_ref_seq for T and R; user provides month + seq for S
 *   4. INSERT into expenses
 *   5. UPDATE bank_transactions.status='matched', matched_expense_id = new id
 */
export function FinalizeTransaction({ transaction, companyId, companyName, existingExpense, onClose, onSave }) {
  const isEditMode = !!existingExpense
  const [categories, setCategories]   = useState([])
  const [subcategories, setSubcats]   = useState([])
  const [clientList, setClientList]   = useState([])
  const [loading, setLoading]         = useState(false)
  const [loadError, setLoadError]     = useState(null)
  const [saveError, setSaveError]     = useState(null)

  // Direction is derived from the bank transaction type
  const direction = transaction.transaction_type === 'credit' ? 'in' : 'out'

  // Form state — pre-fill from existing expense if in edit mode
  const PREDEFINED_CLIENTS = ['Urban City','Blue Lagoon','Green Field Hotel','Kypseli','BAD City Hall','BAD City SPA Hotel','Evia Mare','Other']
  const initialClient = isEditMode
    ? (existingExpense.client_name && PREDEFINED_CLIENTS.includes(existingExpense.client_name)
        ? existingExpense.client_name
        : (existingExpense.client_name ? 'Other' : ''))
    : ''
  const initialCustomClient = isEditMode && existingExpense.client_name && !PREDEFINED_CLIENTS.includes(existingExpense.client_name)
    ? existingExpense.client_name : ''

  const [form, setForm] = useState({
    category_id:       isEditMode ? (existingExpense.category_id || '') : '',
    subcategory_id:    isEditMode ? (existingExpense.subcategory_id || '') : '',
    subcategory_name:  isEditMode ? (existingExpense.subcategory_name || '') : '',
    vendor:            isEditMode ? (existingExpense.vendor || '') : (transaction.description || ''),
    description:       isEditMode ? (existingExpense.description || '') : '',
    is_reimbursable:   isEditMode ? !!existingExpense.is_reimbursable : false,
    client_name:       initialClient,
    custom_client_name: initialCustomClient,
    shareholder_code:  isEditMode ? (existingExpense.shareholder_code || '') : '',
    manual_sub_ref_month: isEditMode && existingExpense.sub_ref_series === 'S' ? String(existingExpense.sub_ref_month || '') : '',
    manual_sub_ref_seq:   isEditMode && existingExpense.sub_ref_series === 'S' ? String(existingExpense.sub_ref_seq || '') : '',
    // Invoice number(s) for incoming Client Payment / Reimbursement. Free-text,
    // supports multiple values (comma-separated) when one transfer settles
    // multiple invoices of the same category.
    invoice_number:    isEditMode ? (existingExpense.invoice_number || '') : '',
    // Optional override of the bank settlement date for travel-period
    // matching. Card swiped Mar 11, bank posts Mar 13 → set invoice_date
    // = 2026-03-11 so the expense matches the Mar 10-12 Athens trip.
    // Blank = use the bank transaction date.
    invoice_date:      isEditMode ? (existingExpense.invoice_date || '') : '',
    // Optional list of future trip months this payment is for. Stored as
    // a comma-separated string of "YYYY-MM" tokens — display-only badge
    // in the Travel Log, never a routing key. Only relevant when the
    // category is Travel Expenses.
    expected_travel_month: isEditMode ? (existingExpense.expected_travel_month || '') : '',
  })

  // -------------------------------------------------------------
  // Split mode
  //   OUTGOING: 4 portion slots (Company / YK / BK / Client) — full reimbursable split
  //   INCOMING: 2 portion slots (Client Payment / Client Reimbursement) — separate
  //             revenue from reimbursement (they roll up differently in reporting).
  //             A single client per transfer; each portion records its own invoice #(s).
  // -------------------------------------------------------------
  // When opening Re-categorize on an existing SPLIT PORTION, default to split
  // mode so the user can immediately edit the whole group. Otherwise default
  // to single mode (toggle off).
  const isExistingSplit = isEditMode && !!existingExpense?.is_split && !!existingExpense?.split_group_id
  const [isSplit, setIsSplit] = useState(isExistingSplit)
  // All siblings of the existing split group (loaded once, used to pre-fill
  // every portion slot so the user can edit the whole group as one unit).
  const [groupSiblings, setGroupSiblings] = useState([])
  const OUTGOING_PORTION_TYPES = [
    { key: 'company', label: 'Company portion',                accent: '#185FA5' },
    { key: 'yk',      label: 'YK shareholder portion',         accent: '#3C3489' },
    { key: 'bk',      label: 'BK shareholder portion',         accent: '#3C3489' },
    { key: 'client',  label: 'Client portion (reimbursable)',  accent: '#993556' },
  ]
  const INCOMING_PORTION_TYPES = [
    // categoryName tells the save logic which category id to look up at save time.
    { key: 'payment',       label: 'Client Payment portion',       accent: '#15803d', categoryName: 'Client Payment' },
    { key: 'reimbursement', label: 'Client Reimbursement portion', accent: '#1d4ed8', categoryName: 'Client Reimbursement' },
  ]
  const PORTION_TYPES = direction === 'in' ? INCOMING_PORTION_TYPES : OUTGOING_PORTION_TYPES

  const initialPortions = PORTION_TYPES.reduce((acc, t) => ({
    ...acc,
    [t.key]: {
      amount: '',
      category_id: '',         // outgoing portions: user-picked; incoming: auto-resolved from t.categoryName
      subcategory_id: '',
      subcategory_name: '',
      client_name: '',
      custom_client_name: '',
      invoice_number: '',      // for incoming portions only
      // Optional shareholder tag for the Company portion when it's a Travel
      // Expense. Lets a company-paid trip show up in the right person's
      // Travel Log section. Ignored for YK/BK/Client slots (their shareholder
      // is already implicit from the slot itself).
      shareholder_code: '',
    }
  }), {})
  const [portions, setPortions] = useState(initialPortions)
  const [allSubcats, setAllSubcats] = useState([])
  // One-shot guard so the edit-mode split pre-fill runs only the first time
  // the user enables the split toggle in this modal session — not every render.
  const [splitPrefilled, setSplitPrefilled] = useState(false)

  // On mount: if this is a split portion, load ALL siblings of the group so
  // the user can edit the whole group as one unit. Runs once.
  useEffect(() => {
    if (!isExistingSplit) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('split_group_id', existingExpense.split_group_id)
        .order('split_portion_index', { ascending: true })
      if (!error && !cancelled && data) {
        setGroupSiblings(data)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pre-fill portion slots based on context:
  //   A) Editing an existing split group → fill EVERY slot from its sibling
  //      data so the user sees the current split exactly as it is.
  //   B) Editing a single (non-split) outgoing expense + ticking split toggle
  //      → seed only the Company slot with the original amount/category so
  //      the user can split it off into YK / BK / Client portions.
  // Both branches are guarded by splitPrefilled so they only run once per
  // modal session.
  useEffect(() => {
    if (!isEditMode) return
    if (splitPrefilled) return

    // Branch A — existing group, prefill all slots
    if (isExistingSplit && groupSiblings.length > 0) {
      // Slot mapping based on each sibling's metadata.
      // OUTGOING: route by shareholder_code (YK/BK) or is_reimbursable (client)
      //           or fall back to 'company'.
      // INCOMING: route by the sibling's category name → payment vs reimbursement.
      const newPortions = { ...initialPortions }
      const categoryById = new Map() // built lazily below from categories state

      for (const s of groupSiblings) {
        let slotKey
        if (direction === 'in') {
          // For incoming, we need the category name. We don't always have it
          // on the row directly, so we use subcategory_name as a hint or fall
          // back to the order: index 0 → payment, index 1 → reimbursement.
          // Safer: use split_portion_index (1-based) — payment=1, reimbursement=2.
          slotKey = (s.split_portion_index || 0) === 2 ? 'reimbursement' : 'payment'
        } else {
          // OUTGOING slot routing:
          //   1. Travel Expenses (sub_ref_series 'T') always goes to the
          //      Company slot — the shareholder_code (if any) becomes the
          //      optional "who traveled" tag on the Company portion form.
          //   2. Otherwise route by shareholder_code (Personal Expenses of
          //      Shareholders → YK or BK slot).
          //   3. Otherwise reimbursable → Client slot.
          //   4. Default → Company slot.
          slotKey =
            s.sub_ref_series === 'T' ? 'company' :
            s.shareholder_code === 'YK' ? 'yk' :
            s.shareholder_code === 'BK' ? 'bk' :
            s.is_reimbursable ? 'client' :
            'company'
        }

        const clientInPredefined = s.client_name && PREDEFINED_CLIENTS.includes(s.client_name)
        newPortions[slotKey] = {
          amount:             String(Math.abs(Number(s.amount || 0)).toFixed(2)),
          category_id:        s.category_id || '',
          subcategory_id:     s.subcategory_id || '',
          subcategory_name:   s.subcategory_name || '',
          client_name:        clientInPredefined ? s.client_name : (s.client_name ? 'Other' : ''),
          custom_client_name: !clientInPredefined && s.client_name ? s.client_name : '',
          invoice_number:     s.invoice_number || '',
          // Preserve the shareholder_code on the Company portion so a Travel
          // Expense for a specific shareholder keeps its travel-log routing
          // on re-edit. Other slots already imply their shareholder.
          shareholder_code:   slotKey === 'company' ? (s.shareholder_code || '') : '',
        }
      }
      setPortions(newPortions)
      setSplitPrefilled(true)
      return
    }

    // Branch B — single existing expense, user just enabled split
    if (!isExistingSplit && isSplit && direction === 'out') {
      setPortions(prev => ({
        ...prev,
        company: {
          ...prev.company,
          amount:           String(Math.abs(Number(existingExpense.amount || 0)).toFixed(2)),
          category_id:      existingExpense.category_id || '',
          subcategory_id:   existingExpense.subcategory_id || '',
          subcategory_name: existingExpense.subcategory_name || '',
        },
      }))
      setSplitPrefilled(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSplit, groupSiblings])

  // Autocomplete: distinct (vendor, description) pairs from past expenses for this company
  const [vendorDescriptionPairs, setVendorDescriptionPairs] = useState([])

  // Duplicate detection (same logic as Add Expense — checks ±7 days, ±€0.50,
  // bank txs + expenses + split groups, with vendor similarity tagging)
  const [duplicates, setDuplicates] = useState([])
  const [duplicatesChecked, setDuplicatesChecked] = useState(false)
  const [duplicatesAcknowledged, setDuplicatesAcknowledged] = useState(false)

  const bankAmount = Math.abs(Number(transaction.amount || 0))
  const portionTotal = useMemo(() =>
    PORTION_TYPES.reduce((sum, t) => sum + (parseFloat(portions[t.key].amount) || 0), 0),
    [portions]
  )
  const portionMatchesTotal = Math.abs(portionTotal - bankAmount) < 0.005

  const updatePortion = (key, patch) => {
    setPortions(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  // Selected category lookup
  const selectedCategory = useMemo(
    () => categories.find(c => c.id === form.category_id) || null,
    [categories, form.category_id]
  )

  // What sub-ref series will this be?
  const subRefSeries = useMemo(
    () => decideSubRefSeries(selectedCategory, form.is_reimbursable),
    [selectedCategory, form.is_reimbursable]
  )

  const subRefIsManual = useMemo(
    () => isSubRefManual(selectedCategory, form.is_reimbursable),
    [selectedCategory, form.is_reimbursable]
  )

  // Initial load: categories filtered by direction + client list for reimbursable
  useEffect(() => {
    const loadCats = async () => {
      try {
        const { data, error } = await supabase
          .from('expense_categories')
          .select('*')
          .eq('is_active', true)
          .eq('direction', direction)
          .order('sort_order')
        if (error) throw error
        setCategories(data || [])
      } catch (e) {
        console.error(e)
        setLoadError('Failed to load categories. Did you run the V2 migration?')
      }
    }
    const loadClients = async () => {
      // Pull client list from 'Client Reimbursement' subcategories (same list as Client Payment)
      const { data: catData } = await supabase
        .from('expense_categories')
        .select('id')
        .eq('name', 'Client Reimbursement')
        .single()
      if (!catData) return
      const { data: subs } = await supabase
        .from('expense_subcategories')
        .select('name, is_custom, sort_order')
        .eq('category_id', catData.id)
        .order('sort_order')
      setClientList(subs || [])
    }
    const loadAllSubcats = async () => {
      // Load ALL subcategories so each portion can have its own subcategory picker
      const { data } = await supabase
        .from('expense_subcategories')
        .select('id, category_id, name, sort_order')
        .order('sort_order')
      setAllSubcats(data || [])
    }
    loadCats()
    loadClients()
    loadAllSubcats()
  }, [direction])

  // Load subcategories when category changes
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

  // Load past (vendor, description) pairs for autocomplete
  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('vendor, description')
        .eq('company_id', companyId)
        .not('vendor', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(500)
      if (!error) setVendorDescriptionPairs(data || [])
    })()
  }, [companyId])

  // Reset duplicate state when key fields change
  useEffect(() => {
    setDuplicatesChecked(false)
    setDuplicatesAcknowledged(false)
    setDuplicates([])
  }, [form.vendor, transaction.transaction_date, transaction.amount])

  // Derived autocomplete lists
  const vendorSuggestions = useMemo(() => {
    const counts = new Map()
    for (const row of vendorDescriptionPairs) {
      const v = (row.vendor || '').trim()
      if (!v) continue
      counts.set(v, (counts.get(v) || 0) + 1)
    }
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
  // Duplicate detection — same approach as Add Expense.
  // For Bank Parser context, we use the transaction's date and amount
  // (not user-edited form values) since the bank tx is the source of truth.
  // -------------------------------------------------------------
  const checkDuplicates = async () => {
    if (!companyId || !transaction.amount || !transaction.transaction_date || !form.vendor?.trim()) return []
    const amt = Math.abs(parseFloat(transaction.amount))
    const amtLow = amt - 0.5
    const amtHigh = amt + 0.5

    const DAY_WINDOW = 7
    const txDate = transaction.transaction_date
    const date = new Date(txDate)
    const dayBefore = new Date(date); dayBefore.setDate(date.getDate() - DAY_WINDOW)
    const dayAfter  = new Date(date); dayAfter.setDate(date.getDate()  + DAY_WINDOW)
    const isoLow  = dayBefore.toISOString().slice(0, 10)
    const isoHigh = dayAfter.toISOString().slice(0, 10)

    const vendorLower = form.vendor.trim().toLowerCase()

    // Bank txs — sign-safe, filtered in JS by abs amount
    const { data: bankMatchesRaw } = await supabase
      .from('bank_transactions')
      .select('id, transaction_date, description, amount, status, matched_expense_id, accounts(name)')
      .eq('company_id', companyId)
      .gte('transaction_date', isoLow)
      .lte('transaction_date', isoHigh)
    const bankMatches = (bankMatchesRaw || []).filter(b => {
      if (b.id === transaction.id) return false // exclude the current tx
      const a = Math.abs(Number(b.amount || 0))
      return a >= amtLow && a <= amtHigh
    })

    // Expenses — full detail
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

    // Split group totals (catch case where user is entering the sum of a split)
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

    const splitGroupTotals = new Map()
    for (const p of (splitPortions || [])) {
      if (!splitGroupTotals.has(p.split_group_id)) {
        splitGroupTotals.set(p.split_group_id, { total: 0, portions: [] })
      }
      const g = splitGroupTotals.get(p.split_group_id)
      g.total += Number(p.amount || 0)
      g.portions.push(p)
    }
    const matchingSplitGroups = []
    for (const [groupId, g] of splitGroupTotals.entries()) {
      if (g.total >= amtLow && g.total <= amtHigh) {
        g.portions.sort((a, b) => (a.split_portion_index ?? 0) - (b.split_portion_index ?? 0))
        matchingSplitGroups.push({ groupId, ...g })
      }
    }

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
    const dateIsExact = (otherIso) => otherIso === txDate
    const amountIsExact = (otherAmt) => Math.abs(Math.abs(Number(otherAmt)) - amt) < 0.01
    const classifyStrength = (otherDate, otherAmt, otherVendor) => {
      const ed = dateIsExact(otherDate)
      const ea = amountIsExact(otherAmt)
      const vok = vendorIsSimilar(otherVendor)
      if (ed && ea && vok) return 'strong'
      if (ed && ea) return 'medium'
      return 'weak'
    }
    const accountLabel = (n) => {
      if (!n) return 'Cash'
      if (n.includes('Mastercard')) return 'RMC'
      if (n.includes('Current')) return 'RCC'
      return n
    }

    const linkedBankTxIds = new Set(
      (expenseMatches || []).filter(e => e.bank_transaction_id).map(e => e.bank_transaction_id)
    )

    const results = []
    for (const b of bankMatches) {
      if (linkedBankTxIds.has(b.id)) continue
      const absAmt = Math.abs(Number(b.amount || 0))
      results.push({
        type: 'bank', id: b.id, date: b.transaction_date, amount: absAmt,
        vendor: b.description, status: b.status,
        accountLabel: accountLabel(b.accounts?.name),
        strength: classifyStrength(b.transaction_date, absAmt, b.description),
        unfinalized: b.status === 'unmatched',
      })
    }
    for (const e of (expenseMatches || [])) {
      // Skip the row we're editing
      if (isEditMode && existingExpense && e.id === existingExpense.id) continue
      results.push({
        type: 'expense', id: e.id, date: e.date, amount: e.amount,
        vendor: e.vendor, description: e.description,
        referenceNumber: e.reference_number,
        subRef: e.sub_ref_series ? `${e.sub_ref_series}${e.sub_ref_month}/${e.sub_ref_seq}` : null,
        category: e.expense_categories?.name, subcategory: e.subcategory_name,
        isReimbursable: !!e.is_reimbursable, clientName: e.client_name,
        shareholderCode: e.shareholder_code, status: e.status,
        accountLabel: accountLabel(e.accounts?.name),
        isSplit: !!e.split_group_id, splitPortion: e.split_portion_index,
        source: e.account_id ? 'Bank Parser' : 'Manual (Cash)',
        strength: classifyStrength(e.date, e.amount, e.vendor),
      })
    }

    const shownExpenseIds = new Set(results.filter(r => r.type === 'expense').map(r => r.id))
    for (const g of matchingSplitGroups) {
      g.portions.forEach(p => shownExpenseIds.delete(p.id))
      const firstPortion = g.portions[0]
      const linkedBankTxId = g.portions.find(p => p.bank_transaction_id)?.bank_transaction_id
      results.push({
        type: 'split-group', id: g.groupId,
        date: firstPortion?.date, amount: g.total, vendor: firstPortion?.vendor,
        accountLabel: accountLabel(firstPortion?.accounts?.name),
        source: linkedBankTxId ? 'Bank Parser (split)' : 'Manual split',
        referenceNumber: g.portions.map(p => p.reference_number).filter(Boolean).join(', '),
        portionsBreakdown: g.portions.map(p => ({
          ref: p.reference_number, amount: Number(p.amount || 0),
          category: p.expense_categories?.name, subcategory: p.subcategory_name,
          shareholder: p.shareholder_code, reimbursable: p.is_reimbursable, client: p.client_name,
        })),
        portionCount: g.portions.length,
        strength: classifyStrength(firstPortion?.date, g.total, firstPortion?.vendor),
      })
    }
    const finalResults = results.filter(r => r.type !== 'expense' || shownExpenseIds.has(r.id))
    const strengthRank = { strong: 0, medium: 1, weak: 2 }
    finalResults.sort((a, b) => {
      if (a.unfinalized && !b.unfinalized) return -1
      if (b.unfinalized && !a.unfinalized) return 1
      return strengthRank[a.strength] - strengthRank[b.strength]
    })
    return finalResults
  }

  // Subcategory selection — store both id and name
  const handleSubcategoryChange = (subId) => {
    const sub = subcategories.find(s => s.id === subId)
    setForm(f => ({
      ...f,
      subcategory_id: subId,
      subcategory_name: sub ? sub.name : '',
    }))
  }

  // ------------------------------------------------------------------
  // Auto-create the "Payment Made on Behalf of …" inter-company leg
  // ------------------------------------------------------------------
  // When the user tags a row with category "Transfers to Connected
  // Accounts" + a "Payment Made on Behalf of <Other Company>"
  // subcategory, we create a mirror row on the OTHER company's books
  // with category "Intercompany Funding" + the matching "From <This
  // Company> — Payment on Behalf" subcategory, and bidirectionally
  // link the two rows via expenses.linked_expense_id.
  //
  // The mirror row is notional — no real cash arrives at the other
  // company's bank — but it captures the accounting fact that the
  // other company was funded by this company for the amount of this
  // payment. Reporting can then surface the receivable / payable
  // balance between the two companies.
  //
  // Symmetric — covers both directions via PAYMENT_ON_BEHALF_PAIRS.
  const PAYMENT_ON_BEHALF_PAIRS = [
    {
      fromCompany:      'Rabona Holdings',
      toCompany:        'Espargos',
      fromSubcategory:  'Payment Made on Behalf of Espargos',
      toSubcategory:    'From Rabona — Payment on Behalf',
    },
    {
      fromCompany:      'Espargos',
      toCompany:        'Rabona Holdings',
      fromSubcategory:  'Payment Made on Behalf of Rabona',
      toSubcategory:    'From Espargos — Payment on Behalf',
    },
  ]
  // Subcategory names that should trigger the heads-up info note + the
  // auto-create logic. Cheap O(2) Set lookup.
  const PAYMENT_ON_BEHALF_FROM_SUBCATS = new Set(
    PAYMENT_ON_BEHALF_PAIRS.map(p => p.fromSubcategory)
  )

  const maybeCreatePaymentOnBehalfLeg = async (sourceExpenseId, expenseRow, alreadyLinkedId) => {
    // 1) Look up the pair config that matches the current company + subcategory.
    const pair = PAYMENT_ON_BEHALF_PAIRS.find(
      p => p.fromCompany === companyName && p.fromSubcategory === expenseRow.subcategory_name
    )
    if (!pair) return null

    // 2) Skip if already linked — user can manage via the 🔗 modal. Prevents
    //    duplicate mirror rows when an already-linked row is re-saved.
    if (alreadyLinkedId) return null

    // 3) Resolve the OTHER company + its Current Account + Intercompany
    //    Funding category + the specific subcategory id on its side.
    const { data: otherCompany, error: otherErr } = await supabase
      .from('companies').select('id').eq('name', pair.toCompany).maybeSingle()
    if (otherErr) throw otherErr
    if (!otherCompany) throw new Error(`Company "${pair.toCompany}" not found (V2 migration may be incomplete).`)

    const { data: otherAccount, error: accErr } = await supabase
      .from('accounts').select('id')
      .eq('company_id', otherCompany.id).eq('name', 'Current Account').maybeSingle()
    if (accErr) throw accErr
    if (!otherAccount) throw new Error(`${pair.toCompany} Current Account not found.`)

    const { data: fundingCat, error: catErr } = await supabase
      .from('expense_categories').select('id').eq('name', 'Intercompany Funding').maybeSingle()
    if (catErr) throw catErr
    if (!fundingCat) throw new Error('Category "Intercompany Funding" not found.')

    const { data: fundingSub, error: subErr } = await supabase
      .from('expense_subcategories').select('id, name')
      .eq('category_id', fundingCat.id).eq('name', pair.toSubcategory).maybeSingle()
    if (subErr) throw subErr
    if (!fundingSub) throw new Error(`Subcategory "${pair.toSubcategory}" not found — run V15/V16 migrations.`)

    // 4) Allocate the other company's main_ref for the same year/month.
    const otherSeq = await nextMainRefSeq(otherCompany.id, expenseRow.main_ref_year, expenseRow.main_ref_month)
    const otherRef = buildMainRef(expenseRow.main_ref_year, expenseRow.main_ref_month, otherSeq, pair.toCompany)

    // 5) Build & INSERT the mirror row. No bank_transaction_id —
    //    notional booking, not tied to any imported transaction.
    const mirrorRow = {
      company_id:        otherCompany.id,
      category_id:       fundingCat.id,
      subcategory_id:    fundingSub.id,
      subcategory_name:  fundingSub.name,
      account_id:        otherAccount.id,
      date:              expenseRow.date,
      amount:            expenseRow.amount,
      currency:          expenseRow.currency || 'EUR',
      vendor:            expenseRow.vendor,
      description:       `Funded by ${pair.fromCompany} — original payment ${expenseRow.reference_number} to ${expenseRow.vendor}${expenseRow.description ? ` (${expenseRow.description})` : ''}`,
      reference_number:  otherRef,
      expense_type:      'income',
      direction:         'in',
      main_ref_year:     expenseRow.main_ref_year,
      main_ref_month:    expenseRow.main_ref_month,
      main_ref_seq:      otherSeq,
      status:            'pending',
      linked_expense_id: sourceExpenseId,
    }

    const { data: insertedMirror, error: insErr } = await supabase
      .from('expenses').insert([mirrorRow]).select('id').single()
    if (insErr) throw insErr

    // 6) Back-link the source row → mirror row.
    const { error: backErr } = await supabase
      .from('expenses')
      .update({ linked_expense_id: insertedMirror.id, updated_at: new Date().toISOString() })
      .eq('id', sourceExpenseId)
    if (backErr) throw backErr

    return insertedMirror.id
  }

  const handleSave = async () => {
    setSaveError(null)

    // SPLIT MODE BRANCH
    if (isSplit) {
      return handleSplitSave()
    }

    // Validation
    if (!form.category_id) { setSaveError('Category is required'); return }
    if (!form.vendor?.trim()) { setSaveError('Vendor is required'); return }

    // Subcategory required unless the category has none
    if (subcategories.length > 0 && !form.subcategory_id) {
      setSaveError('Subcategory is required'); return
    }

    // Shareholder code required if the category needs it
    if (selectedCategory?.needs_shareholder_tag && !form.shareholder_code) {
      setSaveError('Please choose a shareholder (YK or BK)'); return
    }

    // Client/project required when reimbursable
    if (form.is_reimbursable) {
      const clientName = form.client_name === 'Other'
        ? form.custom_client_name?.trim()
        : form.client_name
      if (!clientName) {
        setSaveError('Please select a client/project for the reimbursable expense'); return
      }
    }

    // Manual sub-ref required for S series (Cost of Labor)
    if (subRefIsManual) {
      const m = parseInt(form.manual_sub_ref_month)
      const s = parseInt(form.manual_sub_ref_seq)
      if (!(m >= 1 && m <= 12)) { setSaveError('Sub-reference month must be 1–12'); return }
      if (!(s >= 1))            { setSaveError('Sub-reference sequence must be ≥ 1'); return }
    }

    // ---- Duplicate check (warn-but-allow) ----
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

      const dateParts = parseISODate(transaction.transaction_date)
      if (!dateParts) throw new Error('Transaction has no valid date')

      // ----- Main reference -----
      // In edit mode: keep existing main_ref. In create mode: assign next seq.
      let mainSeq, referenceNumber
      if (isEditMode) {
        mainSeq = existingExpense.main_ref_seq
        referenceNumber = existingExpense.reference_number
      } else {
        mainSeq = await nextMainRefSeq(companyId, dateParts.year, dateParts.month)
        // Company-aware reference: "26/1/4" for Rabona, "E26/1/4" for Espargos.
        referenceNumber = buildMainRef(dateParts.year, dateParts.month, mainSeq, companyName)
      }

      // ----- Sub reference -----
      // In edit mode: if the series didn't change, reuse existing sub_ref to avoid duplicate-key collisions.
      let subSeries = null, subMonth = null, subSeq = null
      if (subRefSeries) {
        subSeries = subRefSeries
        if (subRefIsManual) {
          subMonth = parseInt(form.manual_sub_ref_month)
          subSeq   = parseInt(form.manual_sub_ref_seq)
        } else if (isEditMode && existingExpense.sub_ref_series === subRefSeries && existingExpense.sub_ref_month === dateParts.month) {
          // Keep existing sub-ref for the same series & month
          subMonth = existingExpense.sub_ref_month
          subSeq   = existingExpense.sub_ref_seq
        } else {
          subMonth = dateParts.month
          subSeq   = await nextSubRefSeq(companyId, subSeries, subMonth)
        }
      }

      // Resolve client name (use custom if "Other" was picked)
      const resolvedClient = form.is_reimbursable
        ? (form.client_name === 'Other' ? form.custom_client_name?.trim() : form.client_name)
        : null

      // ----- Build expense row -----
      const expenseRow = {
        company_id:         companyId,
        category_id:        form.category_id,
        account_id:         transaction.account_id,
        date:               transaction.transaction_date,
        amount:             Math.abs(Number(transaction.amount || 0)),
        currency:           'EUR',
        description:        form.description?.trim() || null,
        vendor:             form.vendor.trim(),
        reference_number:   referenceNumber,
        expense_type:       direction === 'out' ? 'regular' : 'income',
        direction:          direction,
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
        bank_transaction_id: transaction.id,
        status:             'pending',
        // Invoice number(s) for incoming Client Payment / Client Reimbursement.
        // Free-text, may contain comma-separated values for multi-invoice transfers.
        invoice_number:     form.invoice_number?.trim() || null,
        // Optional date / future-trip note. Stored as-is (comma-separated
        // YYYY-MM tokens for the trip-month note, or null when blank).
        invoice_date:       form.invoice_date || null,
        expected_travel_month: form.expected_travel_month || null,
      }

      if (isEditMode) {
        // UPDATE existing expense
        const { error: updErr } = await supabase
          .from('expenses')
          .update({ ...expenseRow, updated_at: new Date().toISOString() })
          .eq('id', existingExpense.id)
        if (updErr) throw updErr

        // Auto-create the Espargos "Intercompany Funding" leg if the user
        // just toggled this row INTO "Payment Made on Behalf of Espargos"
        // and there's no existing counterpart link to preserve.
        await maybeCreatePaymentOnBehalfLeg(
          existingExpense.id,
          expenseRow,
          existingExpense.linked_expense_id,
        )
      } else {
        // INSERT new expense + link bank transaction
        const { data: inserted, error: insertErr } = await supabase
          .from('expenses')
          .insert([expenseRow])
          .select('id')
          .single()
        if (insertErr) throw insertErr

        const { error: updateErr } = await supabase
          .from('bank_transactions')
          .update({
            status: 'matched',
            matched_expense_id: inserted.id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', transaction.id)
        if (updateErr) throw updateErr

        // Auto-create the Espargos "Intercompany Funding" leg if applicable.
        await maybeCreatePaymentOnBehalfLeg(inserted.id, expenseRow, null)
      }

      onSave && onSave()
      onClose && onClose()
    } catch (err) {
      console.error('Finalize error:', err)
      setSaveError(err.message || 'Failed to finalize transaction')
    } finally {
      setLoading(false)
    }
  }

  // Split save: validates + inserts N expense rows with consecutive refs, linked via split_group_id
  const handleSplitSave = async () => {
    if (!form.vendor?.trim()) { setSaveError('Vendor is required (shared across all portions)'); return }
    if (!portionMatchesTotal) {
      setSaveError(`Portion total (€${portionTotal.toFixed(2)}) must match bank transaction (€${bankAmount.toFixed(2)})`); return
    }
    const active = PORTION_TYPES.filter(t => (parseFloat(portions[t.key].amount) || 0) > 0)
    if (active.length < 2) {
      setSaveError('Split needs at least 2 portions. Use single mode for a single-portion expense.'); return
    }
    // Per-portion validation differs by direction:
    //   OUTGOING: each portion has its own category + (per-portion) client picker
    //   INCOMING: categories are auto-resolved by portion type, client is shared at modal level
    if (direction === 'in') {
      const clientFinal = form.client_name === 'Other' ? form.custom_client_name?.trim() : form.client_name
      if (!clientFinal) { setSaveError('Client / project is required for incoming split'); return }
      // Invoice numbers are OPTIONAL per portion (free-text paper trail)
    } else {
      for (const t of active) {
        const p = portions[t.key]
        if (!p.category_id)  { setSaveError(`${t.label}: category is required`); return }
        const portionSubs = allSubcats.filter(s => s.category_id === p.category_id)
        if (portionSubs.length > 0 && !p.subcategory_id) {
          setSaveError(`${t.label}: subcategory is required`); return
        }
        if (t.key === 'client') {
          const clientFinal = p.client_name === 'Other' ? p.custom_client_name?.trim() : p.client_name
          if (!clientFinal) { setSaveError('Client portion: please select a client/project'); return }
        }
      }
    }

    try {
      setLoading(true)
      const dateParts = parseISODate(transaction.transaction_date)
      if (!dateParts) throw new Error('Transaction has no valid date')

      // Allocate consecutive main_ref_seq numbers
      const seqs = await nextMainRefSeqBatch(companyId, dateParts.year, dateParts.month, active.length)
      const splitGroupId = uuid()

      // SUB-REF PRESERVATION (edit-mode split only):
      // When the user re-edits an existing split group, we DELETE the old
      // expense rows and INSERT new ones. Without intervention each new row
      // gets a fresh sub_ref_seq, leaving GAPS in the T3/x or R3/x numbering
      // for every previously-issued sub-ref. To preserve those numbers we
      // build a (slot → old sub_ref) map from the doomed siblings, then reuse
      // each old sub_ref on the new portion that lands in the same slot AND
      // keeps the same series (e.g. Travel → Travel).
      const oldSubRefsBySlot = new Map()
      if (isEditMode && isExistingSplit) {
        for (const s of groupSiblings) {
          // Mirror the slot-routing used in the prefill effect above so old
          // and new use the same buckets.
          let slot
          if (direction === 'in') {
            slot = (s.split_portion_index || 0) === 2 ? 'reimbursement' : 'payment'
          } else {
            slot =
              s.sub_ref_series === 'T' ? 'company' :
              s.shareholder_code === 'YK' ? 'yk' :
              s.shareholder_code === 'BK' ? 'bk' :
              s.is_reimbursable ? 'client' :
              'company'
          }
          if (s.sub_ref_series && s.sub_ref_seq) {
            oldSubRefsBySlot.set(slot, {
              series: s.sub_ref_series,
              month:  s.sub_ref_month,
              seq:    s.sub_ref_seq,
            })
          }
        }
      }

      // For INCOMING split: shared client + resolve category ids by name once upfront.
      const sharedClientFinal = direction === 'in'
        ? (form.client_name === 'Other' ? form.custom_client_name?.trim() : form.client_name)
        : null
      const categoryByName = direction === 'in'
        ? Object.fromEntries(categories.map(c => [c.name, c]))
        : null

      // Build rows
      const rows = []
      for (let i = 0; i < active.length; i++) {
        const t = active[i]
        const p = portions[t.key]

        if (direction === 'in') {
          // === INCOMING portion (Client Payment / Client Reimbursement) ===
          const cat = categoryByName[t.categoryName]
          if (!cat) {
            throw new Error(`Category "${t.categoryName}" not found in the system. Ensure incoming categories are seeded.`)
          }
          rows.push({
            company_id:         companyId,
            category_id:        cat.id,
            account_id:         transaction.account_id,
            date:               transaction.transaction_date,
            amount:             parseFloat(p.amount),
            currency:           'EUR',
            description:        form.description?.trim() || null,
            vendor:             form.vendor.trim(),
            reference_number:   buildMainRef(dateParts.year, dateParts.month, seqs[i], companyName),
            expense_type:       'income',
            direction:          'in',
            main_ref_year:      dateParts.year,
            main_ref_month:     dateParts.month,
            main_ref_seq:       seqs[i],
            // No sub-references for incoming portions (per spec).
            sub_ref_series:     null,
            sub_ref_month:      null,
            sub_ref_seq:        null,
            subcategory_id:     null,
            subcategory_name:   null,
            is_reimbursable:    false,
            requires_reimbursement: false,
            client_name:        sharedClientFinal,
            shareholder_code:   null,
            bank_transaction_id: transaction.id,
            is_split:           true,
            split_group_id:     splitGroupId,
            split_portion_index: i + 1,
            status:             'pending',
            // Invoice number(s) for THIS portion — comma-separated free-text.
            invoice_number:     p.invoice_number?.trim() || null,
          })
        } else {
          // === OUTGOING portion (Company / YK / BK / Client) — existing logic ===
          const cat = categories.find(c => c.id === p.category_id)
          const isReimbursable = t.key === 'client'
          const clientFinal = t.key === 'client'
            ? (p.client_name === 'Other' ? p.custom_client_name?.trim() : p.client_name)
            : null
          // Shareholder code per slot:
          //   • YK slot → 'YK' (fixed)
          //   • BK slot → 'BK' (fixed)
          //   • Company slot → user-picked optional tag (lets a company-paid
          //     trip route to the right person's Travel Log section). Most
          //     useful for Travel Expenses; harmless if blank for other
          //     company-paid categories.
          //   • Client slot → null (reimbursable client portion is its own tag)
          const shareholderCode =
            t.key === 'yk' ? 'YK' :
            t.key === 'bk' ? 'BK' :
            t.key === 'company' ? (p.shareholder_code || null) :
            null

          // Sub-ref logic (auto only in split mode for v1 — no manual S entry per portion).
          // For edit-mode split saves, reuse the previous sub-ref number when
          // the same slot still produces the same series, so T3/5..T3/10 etc.
          // don't get burned to gaps every time the user adjusts the split.
          let subSeries = decideSubRefSeries(cat, isReimbursable)
          let subMonth = null, subSeq = null
          if (subSeries) {
            const oldRef = oldSubRefsBySlot.get(t.key)
            if (oldRef && oldRef.series === subSeries && oldRef.month === dateParts.month) {
              subMonth = oldRef.month
              subSeq   = oldRef.seq
            } else {
              subMonth = dateParts.month
              subSeq   = await nextSubRefSeq(companyId, subSeries, subMonth)
            }
          }

          rows.push({
            company_id:         companyId,
            category_id:        p.category_id,
            account_id:         transaction.account_id,
            date:               transaction.transaction_date,
            amount:             parseFloat(p.amount),
            currency:           'EUR',
            description:        form.description?.trim() || null,
            vendor:             form.vendor.trim(),
            reference_number:   buildMainRef(dateParts.year, dateParts.month, seqs[i], companyName),
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
            bank_transaction_id: transaction.id,
            is_split:           true,
            split_group_id:     splitGroupId,
            split_portion_index: i + 1,
            status:             'pending',
            // Travel-related metadata applies at the split-group level —
            // every portion of a split flight inherits the same invoice
            // date and future-trip note.
            invoice_date:       form.invoice_date || null,
            expected_travel_month: form.expected_travel_month || null,
          })
        }
      }

      // EDIT-MODE PREP: identify the set of expense IDs that this save replaces.
      //   • Editing a single expense → just [existingExpense.id]
      //   • Editing an existing split group → all sibling IDs
      //
      // Order matters — we must DELETE the doomed rows BEFORE inserting the
      // new ones, because sub-ref preservation reuses the same
      // (series, month, seq) tuple. If we inserted first, the unique
      // constraint `uniq_expenses_sub_ref` fires.
      //
      //   1. NULL bank_tx.matched_expense_id → frees the FK that points at
      //      a doomed row.
      //   2. NULL linked_expense_id on any counterpart that points at a
      //      doomed row → frees the other FK.
      //   3. DELETE doomed expenses → sub-ref slots are now free.
      //   4. INSERT new portions → no conflict with the reused sub-refs.
      //   5. UPDATE bank_tx.matched_expense_id to first new portion.
      const doomedIds = isEditMode
        ? (isExistingSplit
            ? groupSiblings.map(s => s.id).filter(Boolean)
            : [existingExpense.id])
        : []

      if (doomedIds.length > 0) {
        // Step 1 — un-match the bank transaction so the FK doesn't block delete.
        const { error: unmatchErr } = await supabase
          .from('bank_transactions')
          .update({ matched_expense_id: null, updated_at: new Date().toISOString() })
          .eq('id', transaction.id)
        if (unmatchErr) throw unmatchErr

        // Step 2 — clear any counterpart links pointing AT the doomed rows.
        const { error: unlinkErr } = await supabase
          .from('expenses')
          .update({ linked_expense_id: null, updated_at: new Date().toISOString() })
          .in('linked_expense_id', doomedIds)
        if (unlinkErr) throw unlinkErr

        // Step 3 — delete the doomed expenses, freeing their sub-ref slots.
        const { error: delErr } = await supabase
          .from('expenses')
          .delete()
          .in('id', doomedIds)
        if (delErr) throw delErr
      }

      // Step 4 — insert the new portion rows. With the doomed rows already
      // gone, reused sub-refs (T3/5, T3/6, etc.) don't conflict.
      const { data: inserted, error: insertErr } = await supabase
        .from('expenses')
        .insert(rows)
        .select('id')
      if (insertErr) throw insertErr

      // Step 5 — re-anchor the bank transaction to the first new portion.
      const { error: updateErr } = await supabase
        .from('bank_transactions')
        .update({
          status: 'matched',
          matched_expense_id: inserted?.[0]?.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', transaction.id)
      if (updateErr) throw updateErr

      onSave && onSave()
      onClose && onClose()
    } catch (err) {
      console.error('Split save error:', err)
      setSaveError(err.message || 'Failed to save split expense')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content edit-transaction-modal">
        <div className="modal-header">
          <h3>{isEditMode ? 'Re-categorize Transaction' : 'Finalize Transaction'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {loadError && <div className="message error">{loadError}</div>}
          {saveError && <div className="message error">{saveError}</div>}

          {/* Duplicate detection banner — appears after first save attempt if matches found */}
          {duplicatesChecked && duplicates.length > 0 && !duplicatesAcknowledged && (
            <DuplicateBanner
              duplicates={duplicates}
              currentEntry={{
                vendor: form.vendor,
                amount: Math.abs(Number(transaction.amount || 0)),
                date: transaction.transaction_date,
                category: categories.find(c => c.id === form.category_id)?.name,
                subcategory: form.subcategory_name,
                accountLabel: transaction.accounts?.name?.includes('Mastercard') ? 'RMC'
                              : transaction.accounts?.name?.includes('Current') ? 'RCC'
                              : (transaction.accounts?.name || 'Bank'),
                source: isEditMode ? 'Bank Parser (re-categorize)' : 'Bank Parser (Finalize)',
                isReimbursable: form.is_reimbursable,
                clientName: form.is_reimbursable ? (form.client_name === 'Other' ? form.custom_client_name : form.client_name) : null,
                shareholderCode: form.shareholder_code,
              }}
              onAcknowledge={() => setDuplicatesAcknowledged(true)}
              onCancel={() => { setDuplicatesChecked(false); setDuplicates([]) }}
            />
          )}

          {/* Read-only summary of the bank transaction */}
          <div className="form-group">
            <label>Bank Transaction</label>
            <div style={{
              background: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: 4, padding: 8, fontSize: 13, color: '#374151'
            }}>
              <strong>{transaction.description}</strong>
              <br />
              <span>
                {direction === 'in' ? '➕ Incoming' : '➖ Outgoing'} ·
                € {Math.abs(Number(transaction.amount || 0)).toFixed(2)} ·
                {(() => {
                  const [y, m, d] = transaction.transaction_date.split('-')
                  return ` ${d}/${m}/${y}`
                })()}
              </span>
            </div>
          </div>

          {/* Optional Invoice Date — override of the bank settlement date for
              travel-period matching. Set when the actual transaction date
              differs from when the bank posts (e.g. card swiped Mar 11 in
              Athens, bank settles Mar 13 → invoice_date = 2026-03-11 so the
              expense matches the Mar 10-12 Athens trip).
              Blank = use the bank settlement date (current behavior). */}
          <div className="form-group">
            <label>
              Invoice Date <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>(optional — override bank date for travel-period matching)</span>
            </label>
            <input
              type="date"
              value={form.invoice_date}
              onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
              className="form-input"
            />
          </div>

          {/* Split mode toggle — available in BOTH create mode and edit mode.
              Outgoing splits: 4 portion types (Company / YK / BK / Client).
              Incoming splits: 2 portion types (Client Payment / Client Reimbursement),
                               same client across both portions, separate invoice numbers.
              In edit mode, enabling split CONVERTS this single expense into multiple
              portions: the original row is replaced. The Company portion auto-fills
              with the existing data so the user only needs to adjust amounts. */}
          {/* For a single (non-split) expense we show the toggle so the user
              can opt-in to splitting. For an existing split group we hide the
              toggle and show an info note instead — the split UI below is
              always visible and pre-filled with the current group. */}
          {!isExistingSplit && (
            <div className="form-group" style={{
              background: '#eef2ff', border: '1px solid #c7d2fe',
              borderRadius: 4, padding: 10
            }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={isSplit}
                  onChange={(e) => setIsSplit(e.target.checked)}
                />
                <span style={{ fontWeight: 500 }}>
                  {direction === 'in'
                    ? 'Split this payment (Client Payment + Reimbursement from same client)'
                    : 'Split this expense across portions'}
                </span>
              </label>
              {isSplit && (
                <small style={{ color: '#4338ca', fontSize: 12, marginTop: 4, display: 'block' }}>
                  {isEditMode
                    ? 'Saving will REPLACE the existing single expense with these portions. The bank transaction stays linked. The Company portion is pre-filled — adjust the amounts.'
                    : 'Each filled portion creates its own expense row with a consecutive main reference number, linked together.'}
                </small>
              )}
            </div>
          )}
          {isExistingSplit && (
            <div className="form-group" style={{
              background: '#eef2ff', border: '1px solid #c7d2fe',
              borderRadius: 4, padding: 10, fontSize: 13, color: '#3730a3'
            }}>
              ✏️ Editing split group of <strong>{groupSiblings.length || '…'} portions</strong>.
              Adjust amounts or categories below — saving REPLACES the entire group
              and re-anchors the bank transaction to the new portions.
            </div>
          )}

          {/* INCOMING SPLIT — shared client picker (one client per transfer) */}
          {isSplit && direction === 'in' && (
            <div className="form-group">
              <label>Client / project * <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>(shared across both portions)</span></label>
              <select
                value={form.client_name}
                onChange={(e) => setForm({ ...form, client_name: e.target.value, custom_client_name: '' })}
                className="form-input"
              >
                <option value="">— Select client —</option>
                {clientList.map(c => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
                <option value="Other">Other (custom)</option>
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

          {/* SPLIT MODE — portion cards */}
          {isSplit && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {PORTION_TYPES.map(t => {
                const p = portions[t.key]
                const portionCats = t.key === 'yk' || t.key === 'bk'
                  ? categories.filter(c => c.needs_shareholder_tag)
                  : categories
                const portionSubs = allSubcats.filter(s => s.category_id === p.category_id)
                const isActive = (parseFloat(p.amount) || 0) > 0
                // For incoming portions, the category is auto-resolved (Client Payment / Reimbursement)
                // and the UI doesn't need a category dropdown — just amount + invoice number.
                const isIncomingPortion = direction === 'in'
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

                    {/* INCOMING: just an invoice # field, no category dropdown */}
                    {isIncomingPortion && (
                      <>
                        <label style={{ fontSize: 11, color: '#6b7280' }}>
                          Invoice #(s) <span style={{ color: '#9ca3af', fontWeight: 400 }}>(comma-separated for multiple)</span>
                        </label>
                        <input
                          type="text"
                          placeholder="INV-001 or INV-001, INV-002"
                          value={p.invoice_number}
                          onChange={(e) => updatePortion(t.key, { invoice_number: e.target.value })}
                          className="form-input"
                        />
                      </>
                    )}

                    {/* OUTGOING: full category + subcategory + per-portion client picker */}
                    {!isIncomingPortion && (
                      <>
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
                        {/* Per-portion Traveler picker removed — traveler
                            assignment lives in the Travel Log's inline
                            → YK / → BK / Clear buttons (single source of
                            truth across the app). */}
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
                <span>{portionMatchesTotal
                  ? `matches bank transaction (€${bankAmount.toFixed(2)})`
                  : `does not match bank transaction (€${bankAmount.toFixed(2)})`}
                </span>
              </div>
            </div>
          )}

          {/* SINGLE MODE — only show if not in split mode */}
          {!isSplit && (
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
          )}

          {/* Subcategory (when category has any) */}
          {!isSplit && subcategories.length > 0 && (
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
              {/* Heads-up: auto-create the matching Intercompany Funding leg
                  when the user picks a "Payment Made on Behalf of …" subcategory
                  AND the current company is the funding side AND there's no
                  pre-existing link to preserve. */}
              {(() => {
                const pair = PAYMENT_ON_BEHALF_PAIRS.find(
                  p => p.fromCompany === companyName && p.fromSubcategory === form.subcategory_name
                )
                if (!pair) return null
                if (existingExpense?.linked_expense_id) return null
                return (
                  <div style={{
                    marginTop: 8, padding: '8px 10px',
                    background: '#eff6ff', border: '1px solid #bfdbfe',
                    borderRadius: 4, fontSize: 12, color: '#1e40af',
                  }}>
                    💡 On save, a matching <strong>Intercompany Funding</strong> entry
                    will be auto-created on <strong>{pair.toCompany}</strong>'s
                    Current Account and linked to this row.
                  </div>
                )
              })()}
            </div>
          )}

          {/* Invoice number(s) — shown ONLY for incoming Client Payment or Client
              Reimbursement in single mode. Free-text, supports comma-separated
              values when one transfer settles multiple invoices of same category. */}
          {!isSplit && direction === 'in' && (() => {
            const selectedCat = categories.find(c => c.id === form.category_id)
            const needsInvoice = selectedCat && (
              selectedCat.name === 'Client Payment' || selectedCat.name === 'Client Reimbursement'
            )
            if (!needsInvoice) return null
            return (
              <div className="form-group">
                <label>
                  Invoice #(s) <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>(comma-separated for multiple)</span>
                </label>
                <input
                  type="text"
                  placeholder="INV-001 or INV-001, INV-002"
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  className="form-input"
                />
              </div>
            )
          })()}

          {/* Shareholder tag — visible for:
              • categories with needs_shareholder_tag = TRUE (required, e.g.
                Personal Expenses of Shareholders)
              • Travel Expenses (sub_ref_series = 'T') — OPTIONAL, lets the
                user route the trip to the right person's Travel Log section.
              Leaving it blank means "company travel, not shareholder-specific".  */}
          {/* Shareholder picker — REQUIRED only for Personal Expenses of
              Shareholders. Travel Expenses do NOT show a picker here:
              traveler assignment lives in the Travel Log's inline
              → YK / → BK / Clear buttons (single source of truth). */}
          {!isSplit && selectedCategory?.needs_shareholder_tag && (
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

          {/* Expected Travel Month — decouples payment month from trip month.
              Flight paid in January for May trip → set 2026-05 here → the
              expense surfaces in May's Travel Log instead of January's.
              Blank = use payment month.
              Visible when:
                • Single mode: only when category is Travel Expenses
                • Split mode: when ANY portion's category is Travel Expenses
                  (gets stamped on every portion of the split). */}
          {(() => {
            const singleIsTravel = !isSplit && selectedCategory?.sub_ref_series === 'T'
            const splitHasTravel = isSplit && Object.values(portions).some(p => {
              if (!p.category_id) return false
              const cat = categories.find(c => c.id === p.category_id)
              return cat?.sub_ref_series === 'T'
            })
            if (!singleIsTravel && !splitHasTravel) return null
            return (
              <div className="form-group">
                <label>
                  Expected Travel Month(s) <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 12 }}>(optional — pick one or more future months this payment is for; shows as badges on the Travel Log row)</span>
                </label>
                <MonthMultiSelect
                  value={form.expected_travel_month}
                  onChange={(v) => setForm({ ...form, expected_travel_month: v })}
                />
              </div>
            )
          })()}

          {/* Vendor */}
          <div className="form-group">
            <label>Vendor *</label>
            <input
              type="text"
              value={form.vendor}
              onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              className="form-input"
              placeholder="Vendor / counterparty name (type to see past vendors)"
              list="finalize-vendor-suggestions"
              autoComplete="off"
            />
            <datalist id="finalize-vendor-suggestions">
              {vendorSuggestions.map(v => <option key={v} value={v} />)}
            </datalist>
            {vendorSuggestions.length > 0 && (
              <small style={{ color: '#6b7280', fontSize: 11 }}>
                {vendorSuggestions.length} known vendor{vendorSuggestions.length === 1 ? '' : 's'} for this company.
              </small>
            )}
          </div>

          {/* Description */}
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
              list="finalize-description-suggestions"
              autoComplete="off"
            />
            <datalist id="finalize-description-suggestions">
              {descriptionSuggestions.map(d => <option key={d} value={d} />)}
            </datalist>
            {descriptionSuggestions.length > 0 && (
              <small style={{ color: '#6b7280', fontSize: 11 }}>
                {(() => {
                  const currentVendor = (form.vendor || '').trim().toLowerCase()
                  const scoped = currentVendor && vendorDescriptionPairs.some(r => (r.vendor || '').trim().toLowerCase() === currentVendor)
                  return scoped
                    ? `${descriptionSuggestions.length} past description${descriptionSuggestions.length === 1 ? '' : 's'} used with "${form.vendor.trim()}".`
                    : `${descriptionSuggestions.length} known description${descriptionSuggestions.length === 1 ? '' : 's'} from all expenses.`
                })()}
              </small>
            )}
          </div>

          {/* Reimbursable flag — outgoing only */}
          {!isSplit && direction === 'out' && (
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={form.is_reimbursable}
                  onChange={(e) => setForm({
                    ...form,
                    is_reimbursable: e.target.checked,
                    // Clear client fields when unchecking
                    client_name: e.target.checked ? form.client_name : '',
                    custom_client_name: e.target.checked ? form.custom_client_name : '',
                  })}
                />
                Mark as Reimbursable (assigns R sub-reference, overrides category default)
              </label>
            </div>
          )}

          {/* Client/Project picker — only when reimbursable is checked */}
          {!isSplit && form.is_reimbursable && (
            <div className="form-group" style={{
              background: '#fef3c7', border: '1px solid #fcd34d',
              borderRadius: 4, padding: 12
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

          {/* Sub-reference preview / manual entry */}
          {!isSplit && subRefSeries && !subRefIsManual && (
            <div className="form-group">
              <label>Sub-reference (auto)</label>
              <div style={{
                fontFamily: 'monospace', padding: 8,
                background: '#f0f9ff', border: '1px solid #bae6fd',
                borderRadius: 4, color: '#075985'
              }}>
                {subRefSeries}{parseISODate(transaction.transaction_date).month}/?
                <span style={{ marginLeft: 8, color: '#0369a1', fontSize: 12 }}>
                  (sequence assigned on save)
                </span>
              </div>
            </div>
          )}

          {!isSplit && subRefIsManual && (
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
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary" disabled={loading}>
            Cancel
          </button>
          {(() => {
            const hasUnack = duplicatesChecked && duplicates.length > 0 && !duplicatesAcknowledged
            const hasAck   = duplicatesChecked && duplicates.length > 0 && duplicatesAcknowledged
            const dangerStyle = (hasUnack || hasAck)
              ? { background: '#dc2626', borderColor: '#dc2626' }
              : undefined
            let label
            if (loading) {
              label = '💾 Saving...'
            } else if (hasUnack) {
              label = '⚠ Duplicate detected — review above'
            } else if (hasAck) {
              label = 'Save anyway →'
            } else if (isEditMode) {
              label = '💾 Save Changes'
            } else if (isSplit) {
              label = `✓ Finalize & Create ${PORTION_TYPES.filter(t => (parseFloat(portions[t.key].amount) || 0) > 0).length} Expenses`
            } else {
              label = '✓ Finalize & Create Expense'
            }
            return (
              <button
                onClick={handleSave}
                className="button"
                style={dangerStyle}
                disabled={loading || !!loadError}
                title={hasUnack ? 'Scroll up — possible duplicate found. Click "Save anyway →" in the banner to override.' : undefined}
              >
                {label}
              </button>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

// =============================================================
// DuplicateBanner — same structure as Add Expense's banner:
// rich side-by-side comparison cards with strength tags
// =============================================================
function DuplicateBanner({ duplicates, currentEntry, onAcknowledge, onCancel }) {
  const fmt = (n) => `€${Number(n || 0).toFixed(2)}`
  const fmtDate = (iso) => {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }
  return (
    <div style={{
      background: '#fef3c7', border: '1px solid #fcd34d',
      borderRadius: 4, padding: 12, marginBottom: 12,
    }}>
      <div style={{ fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
        ⚠ Possible duplicate{duplicates.length > 1 ? 's' : ''} detected
      </div>
      <div style={{ fontSize: 12, color: '#78350f', marginBottom: 10 }}>
        Found {duplicates.length} potential {duplicates.length > 1 ? 'matches' : 'match'} within ±7 days / ±€0.50.
        Strength tags:{' '}
        <span style={{ color: '#991b1b', fontWeight: 600 }}>strong</span> = same date + amount + similar vendor,{' '}
        <span style={{ color: '#9a3412', fontWeight: 600 }}>medium</span> = same date + amount,{' '}
        <span style={{ color: '#854d0e', fontWeight: 600 }}>weak</span> = close but not exact.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {/* "You're entering" card */}
        <div style={{
          background: 'white', border: '1px dashed #d97706',
          borderRadius: 4, padding: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#d97706', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            You're saving · {currentEntry.source}
          </div>
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8,
            marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed #e5e7eb',
          }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>{fmt(currentEntry.amount)}</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>· {fmtDate(currentEntry.date)}</span>
          </div>
          <DetailRow label="Vendor"     value={currentEntry.vendor} />
          <DetailRow label="Account"    value={currentEntry.accountLabel} />
          {(currentEntry.category || currentEntry.subcategory) && (
            <DetailRow label="Category" value={[currentEntry.category, currentEntry.subcategory].filter(Boolean).join(' → ')} />
          )}
          {currentEntry.isReimbursable && (
            <DetailRow label="Reimb" value={currentEntry.clientName ? `Yes · ${currentEntry.clientName}` : 'Yes'} />
          )}
          {currentEntry.shareholderCode && <DetailRow label="Shareholder" value={currentEntry.shareholderCode} />}
        </div>

        {/* Matches list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
          {duplicates.map((d, i) => {
            const ss = {
              strong: { bg: '#fecaca', fg: '#991b1b', label: 'Strong match' },
              medium: { bg: '#fed7aa', fg: '#9a3412', label: 'Medium · different vendor' },
              weak:   { bg: '#fef3c7', fg: '#854d0e', label: 'Weak · close but not exact' },
            }[d.strength] || { bg: '#fef3c7', fg: '#854d0e', label: 'Match' }
            const refStr = d.referenceNumber ? `${d.referenceNumber}${d.subRef ? ` · ${d.subRef}` : ''}` : null
            return (
              <div key={i} style={{
                background: 'white',
                border: `1px solid ${d.strength === 'strong' ? '#fca5a5' : d.strength === 'medium' ? '#fdba74' : '#fcd34d'}`,
                borderLeft: `4px solid ${ss.fg}`,
                borderRadius: 4, padding: 10,
              }}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 4, gap: 8,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5,
                    color: d.type === 'bank' ? '#1e40af'
                         : d.type === 'split-group' ? '#7c2d12'
                         : (d.accountLabel === 'Cash' ? '#0c4a6e' : '#7c2d12'),
                  }}>
                    {d.type === 'bank'
                      ? `🏦 Bank tx · ${d.accountLabel}${d.unfinalized ? ' · still pending' : ''}`
                      : d.type === 'split-group'
                        ? `🔀 Split group · ${d.portionCount} portions · ${d.source}`
                        : `📋 Expense · ${d.source}${d.isSplit ? ` · Split ${d.splitPortion}` : ''}`}
                  </div>
                  <span style={{
                    background: ss.bg, color: ss.fg,
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                    whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: 0.3,
                  }}>
                    {ss.label}
                  </span>
                </div>
                <div style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8,
                  marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed #e5e7eb',
                }}>
                  {refStr && (
                    <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: '#1f2937' }}>{refStr}</span>
                  )}
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>{fmt(d.amount)}</span>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>· {fmtDate(d.date)}</span>
                </div>
                <DetailRow label="Vendor"  value={d.vendor} />
                <DetailRow label="Account" value={d.accountLabel} />
                {d.source && <DetailRow label="Source" value={d.source} />}
                {(d.category || d.subcategory) && (
                  <DetailRow label="Category" value={[d.category, d.subcategory].filter(Boolean).join(' → ')} />
                )}
                {d.isReimbursable && <DetailRow label="Reimb" value={d.clientName ? `Yes · ${d.clientName}` : 'Yes'} />}
                {d.shareholderCode && <DetailRow label="Shareholder" value={d.shareholderCode} />}
                {d.status && <DetailRow label="Status" value={d.status} />}

                {d.type === 'split-group' && d.portionsBreakdown && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e5e7eb' }}>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 4 }}>
                      Portion breakdown ({d.portionCount} parts totaling {fmt(d.amount)}):
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
                          {[p.category, p.subcategory].filter(Boolean).join(' → ')}{' '}
                          <strong>{fmt(p.amount)}</strong>
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
          onClick={onAcknowledge}
          className="button"
          style={{ background: '#dc2626', borderColor: '#dc2626' }}
        >
          Save anyway →
        </button>
        <button onClick={onCancel} className="btn-secondary">
          Cancel — let me review
        </button>
      </div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ width: 90, color: '#6b7280', flexShrink: 0 }}>{label}</div>
      <div style={{ color: '#1f2937', fontWeight: 500, wordBreak: 'break-word' }}>
        {value || '—'}
      </div>
    </div>
  )
}
