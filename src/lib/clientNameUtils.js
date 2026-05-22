// =====================================================================
// clientNameUtils.js — canonical client-name resolution
// =====================================================================
// Keeps client names consistent across the system. When the user types
// a custom client name (anywhere — BankParser Finalize, AddExpense,
// EditManualExpenseModal), we run it through this helper to either:
//
//   1. Match an existing client (case-insensitive) → return the canonical
//      spelling from the clients table
//   2. No match → prompt to create a minimal client record. If user
//      agrees, INSERT and return the new canonical name. If not, return
//      the typed name as raw text (free-text behavior).
//
// Returns:
//   - a string with the canonical or raw name (always non-null if input
//     was non-empty)
//   - the input unchanged if it was empty / whitespace
//
// Used by:
//   - BankParser/FinalizeTransaction.jsx (incoming Client Payment finalize)
//   - AddExpense.jsx (manual reimbursable cash entries)
//   - ViewExpenses/EditManualExpenseModal.jsx (TBD)
// =====================================================================

/**
 * @param {object} supabase    - the supabase client instance
 * @param {object} opts
 * @param {string} opts.companyId   - UUID of the current company
 * @param {string} opts.companyName - display name ("Rabona Holdings" / "Espargos") for the prompt text
 * @param {string} opts.rawName     - the typed client name to canonicalize
 * @returns {Promise<string>} canonical name (existing or newly-created) or raw text
 */
export async function canonicalizeClientName(supabase, { companyId, companyName, rawName }) {
  if (!rawName?.trim()) return rawName
  const trimmed = rawName.trim()
  try {
    // Exact case-insensitive match against existing clients (per V22's index).
    const { data: matches, error: matchErr } = await supabase
      .from('clients')
      .select('id, trade_name, legal_name')
      .eq('company_id', companyId)
      .ilike('trade_name', trimmed)
    if (matchErr) throw matchErr
    if (matches && matches.length > 0) {
      return matches[0].trade_name
    }
    // No match — confirm whether to create the client.
    const ok = window.confirm(
      `No client named "${trimmed}" exists in your ${companyName} client list.\n\n`
      + `Create one now?\n`
      + `  • OK — adds "${trimmed}" to the client list with minimal info. `
      + `You can edit the legal name, monthly fee, email chain, etc. later in the Client Invoicing tab. `
      + `Invoices issued to this client will then link up automatically.\n`
      + `  • Cancel — save the name as free text only for now. No client record is created. `
      + `(You can add the client later from the Client Invoicing tab.)`
    )
    if (!ok) return trimmed
    const { data: newClient, error: insErr } = await supabase
      .from('clients')
      .insert([{
        company_id: companyId,
        legal_name: trimmed,
        trade_name: trimmed,
        active:     true,
        notes:      `Auto-created from expense entry on ${new Date().toISOString().slice(0, 10)}.`,
      }])
      .select('trade_name')
      .single()
    if (insErr) {
      // V22's unique index might fire if there's a race condition with
      // a concurrent insert. Re-fetch and return canonical.
      if (insErr.code === '23505') {
        const { data: re } = await supabase
          .from('clients').select('trade_name')
          .eq('company_id', companyId).ilike('trade_name', trimmed)
          .maybeSingle()
        return re?.trade_name || trimmed
      }
      alert(`Could not create client: ${insErr.message}\n\nSaving the name as free text instead.`)
      return trimmed
    }
    return newClient.trade_name
  } catch (err) {
    console.warn('canonicalizeClientName lookup error:', err)
    return trimmed
  }
}
