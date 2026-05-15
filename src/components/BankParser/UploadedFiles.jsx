import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'

// Month-name lookup so we can filter file_name by the currently-selected month.
// Relies on our enforced filename convention: "<Company-prefix> <MonthName> <Year>.<ext>"
// e.g. "RCC January 2026.pdf", "Espargos January 2026.png".
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export function UploadedFiles({ selectedCompany, selectedMonth, selectedYear, onRefresh, refreshTrigger }) {
  const [imports, setImports] = useState([])
  const [loading, setLoading] = useState(false)

  // refreshTrigger is bumped by BankParser whenever a transaction is edited,
  // deleted, or finalized — that keeps the live transaction counts on each
  // file in sync without us having to maintain a separate counter.
  useEffect(() => {
    if (!selectedCompany || !selectedMonth || !selectedYear) return
    loadImports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany, selectedMonth, selectedYear, onRefresh, refreshTrigger])

  const loadImports = async () => {
    try {
      setLoading(true)

      // Get company
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('name', selectedCompany)
        .single()

      if (!company) return

      // Filter by the currently-selected month + year via the filename convention.
      // Files named "<Prefix> January 2026.<ext>" match when Jan 2026 is selected, etc.
      //
      // We pull bank_transactions(count) alongside each import so the displayed
      // count reflects LIVE state, not the stored transaction_count snapshot.
      // This way row-level deletes in the Bank Parser (or any other path)
      // immediately update the file's transaction count without us having to
      // maintain a separate counter.
      const monthName = MONTH_NAMES[selectedMonth - 1]
      const { data: importsData, error } = await supabase
        .from('bank_imports')
        .select('*, bank_transactions(count)')
        .eq('company_id', company.id)
        .ilike('file_name', `%${monthName}%${selectedYear}%`)
        .order('created_at', { ascending: false })

      if (error) throw error

      // Flatten the live count onto the import row as `live_transaction_count`
      // so the existing render code can be updated minimally.
      const enriched = (importsData || []).map(imp => ({
        ...imp,
        live_transaction_count: imp.bank_transactions?.[0]?.count ?? imp.transaction_count ?? 0,
      }))
      setImports(enriched)
    } catch (err) {
      console.error('Failed to load imports:', err)
    } finally {
      setLoading(false)
    }
  }

  // Full-cascade delete of a bank import.
  //
  // The schema has a CIRCULAR FK between bank_transactions and expenses:
  //   expenses.bank_transaction_id → bank_transactions.id
  //   bank_transactions.matched_expense_id → expenses.id
  //
  // To break the cycle we have to NULL out one side BEFORE deleting either.
  // We null bank_transactions.matched_expense_id first, then we can safely
  // delete expenses, then bank_transactions, then the bank_imports row.
  //
  // Plus: for any deleted expense that was paired with a counterpart elsewhere
  // (inter-company or intra-company linking), we clear the counterpart's
  // linked_expense_id so we don't leave dangling references.
  const handleDelete = async (importId, importFileName) => {
    try {
      // Step 1: bank transactions in this import
      const { data: bankTxs, error: btxErr } = await supabase
        .from('bank_transactions')
        .select('id')
        .eq('bank_import_id', importId)
      if (btxErr) throw btxErr
      const bankTxIds = (bankTxs || []).map(t => t.id)

      // Step 2: expenses created from those transactions
      let expIds = []
      let counterpartIdsToClear = []
      if (bankTxIds.length > 0) {
        const { data: exps, error: expErr } = await supabase
          .from('expenses')
          .select('id, linked_expense_id')
          .in('bank_transaction_id', bankTxIds)
        if (expErr) throw expErr
        expIds = (exps || []).map(e => e.id)
        counterpartIdsToClear = (exps || [])
          .map(e => e.linked_expense_id)
          .filter(Boolean)
      }

      // Confirm with the user — show concrete counts so they know what gets removed
      const summary =
        `Delete this entire import?\n\n` +
        `  File: ${importFileName || 'unnamed'}\n` +
        `  Bank transactions: ${bankTxIds.length}\n` +
        `  Expenses created from them: ${expIds.length}\n` +
        (counterpartIdsToClear.length > 0
          ? `  Linked counterparts to unlink: ${counterpartIdsToClear.length}\n`
          : '') +
        `\nThis cannot be undone.`
      if (!window.confirm(summary)) return

      // Step 3 (CIRCULAR-FK BREAKER): NULL out matched_expense_id on all bank
      // transactions in this import. Without this, deleting expenses fails with
      // bank_transactions_matched_expense_id_fkey because bank_transactions
      // still references them.
      if (bankTxIds.length > 0) {
        const { error: nullErr } = await supabase
          .from('bank_transactions')
          .update({ matched_expense_id: null })
          .in('id', bankTxIds)
        if (nullErr) throw nullErr
      }

      // Step 4a: clear linked_expense_id on counterparts that the doomed expenses
      // POINT TO. This handles the "forward" direction of the bidirectional link.
      if (counterpartIdsToClear.length > 0) {
        const { error: unlinkErr } = await supabase
          .from('expenses')
          .update({ linked_expense_id: null })
          .in('id', counterpartIdsToClear)
        if (unlinkErr) throw unlinkErr
      }

      // Step 4b: clear linked_expense_id on any expense that POINTS TO a doomed
      // expense — the "reverse" direction. Necessary because the link is stored
      // bidirectionally on both sides; if step 4a missed any (e.g. counts mismatch
      // between forward/reverse pointers, or one-sided link from a prior bug),
      // this catches all remaining incoming references. Without this, deleting
      // a doomed expense violates expenses_linked_expense_id_fkey.
      if (expIds.length > 0) {
        const { error: reverseUnlinkErr } = await supabase
          .from('expenses')
          .update({ linked_expense_id: null })
          .in('linked_expense_id', expIds)
        if (reverseUnlinkErr) throw reverseUnlinkErr
      }

      // Step 5: delete expenses
      if (expIds.length > 0) {
        const { error: expDelErr } = await supabase
          .from('expenses')
          .delete()
          .in('id', expIds)
        if (expDelErr) throw expDelErr
      }

      // Step 6: delete bank_transactions
      if (bankTxIds.length > 0) {
        const { error: btxDelErr } = await supabase
          .from('bank_transactions')
          .delete()
          .eq('bank_import_id', importId)
        if (btxDelErr) throw btxDelErr
      }

      // Step 7: delete bank_imports row
      const { error: impErr } = await supabase
        .from('bank_imports')
        .delete()
        .eq('id', importId)
      if (impErr) throw impErr

      setImports(prev => prev.filter(i => i.id !== importId))
      if (onRefresh) onRefresh()
    } catch (err) {
      console.error('Failed to delete import:', err)
      alert('Failed to delete import: ' + (err.message || err))
    }
  }

  if (loading) {
    return <div className="uploaded-files-section loading">Loading imports...</div>
  }

  return (
    <div className="uploaded-files-section">
      <h3>📁 Uploaded Files (Newest First)</h3>

      {imports.length === 0 ? (
        <div className="empty-state">No files imported yet</div>
      ) : (
        <div className="files-table">
          <table>
            <thead>
              <tr>
                <th>Icon</th>
                <th>File Name</th>
                <th>Upload Date</th>
                <th>Transactions</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {imports.map(imp => (
                <tr key={imp.id}>
                  <td className="icon">📄</td>
                  <td className="file-name">{imp.file_name}</td>
                  <td className="date">
                    {new Date(imp.import_date).toLocaleDateString()}
                  </td>
                  <td className="transactions">{imp.live_transaction_count}</td>
                  <td className="status">
                    <span className={`status-badge ${imp.status}`}>
                      {imp.status === 'completed' ? '✓' : '⏳'} {imp.status}
                    </span>
                  </td>
                  <td className="action">
                    <button
                      onClick={() => handleDelete(imp.id, imp.file_name)}
                      className="btn-delete"
                      title="Delete this import"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
