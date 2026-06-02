// =====================================================================
// paymentOnBehalf.js — auto-create inter-company "Payment on Behalf" leg
// =====================================================================
// When THIS company pays a vendor on behalf of the OTHER company (either
// via bank transfer or cash), we record:
//   • THIS side: the actual expense, category "Transfers to Connected
//     Accounts" + subcategory "Payment Made on Behalf of <Other>"
//   • OTHER side: a notional incoming, category "Intercompany Funding"
//     + subcategory "From <This> — Payment on Behalf"
// The two rows are bidirectionally linked via expenses.linked_expense_id.
//
// Used by:
//   • BankParser/FinalizeTransaction.jsx — bank-paid path (the original)
//   • AddExpense.jsx — cash-paid path (new — same accounting concept,
//     just no real bank settlement)
//
// Single source of truth so the two paths can never drift.
// =====================================================================

import { nextMainRefSeq, buildMainRef } from './refUtils'

// Symmetric configuration: which subcategory on the FROM side maps to
// which subcategory on the TO side, in both directions. The fromCompany
// matches the company that's recording the outgoing expense.
export const PAYMENT_ON_BEHALF_PAIRS = [
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

// Fast lookup Set for the heads-up info note on the Save dialog.
export const PAYMENT_ON_BEHALF_FROM_SUBCATS = new Set(
  PAYMENT_ON_BEHALF_PAIRS.map(p => p.fromSubcategory)
)

/**
 * Auto-create the mirror "Intercompany Funding" row on the OTHER
 * company's books when the source expense uses a Payment-on-Behalf
 * subcategory.
 *
 * @param {object}   args
 * @param {object}   args.supabase          - supabase client
 * @param {string}   args.companyName       - the FROM company name (this side)
 * @param {string}   args.sourceExpenseId   - id of the just-inserted expense
 * @param {object}   args.expenseRow        - the source expense row (subcategory_name, amount, date, vendor, description, reference_number, main_ref_year/month, currency)
 * @param {string}   [args.alreadyLinkedId] - if set, skip (row already linked)
 * @returns {Promise<string|null>} id of the created mirror row, or null if skipped
 */
export async function maybeCreatePaymentOnBehalfLeg({
  supabase,
  companyName,
  sourceExpenseId,
  expenseRow,
  alreadyLinkedId,
}) {
  // 1) Match config: does this company + subcategory trigger the auto-create?
  const pair = PAYMENT_ON_BEHALF_PAIRS.find(
    p => p.fromCompany === companyName && p.fromSubcategory === expenseRow.subcategory_name
  )
  if (!pair) return null

  // 2) Skip if already linked. The user can manage manual links via the
  //    🔗 modal in View Expenses. Prevents duplicate mirror rows on save.
  if (alreadyLinkedId) return null

  // 3) Resolve OTHER company + its Current Account + Intercompany Funding
  //    category + the matching subcategory id on its side.
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

  // 5) Build & INSERT the mirror row. No bank_transaction_id — notional.
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
