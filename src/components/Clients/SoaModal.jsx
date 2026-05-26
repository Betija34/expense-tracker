import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { downloadSoaWorkbook } from '../../lib/soaGenerator'

// =====================================================================
// SoaModal — Statement of Account generator for a single client
// ---------------------------------------------------------------------
// Opens from a per-client 📋 SOA button in the Clients tab. Loads the
// full invoice history for this client, lets the user tweak the
// editable header block (company name + registration number + VAT +
// address — these aren't stored in the clients table, locked-in
// design call to keep the SOA header editable per generation), then
// downloads a .xlsx that matches the user's external SOA format.
//
// See src/lib/soaGenerator.js for the actual workbook layout. This
// component is a thin form + loader.
// =====================================================================
export function SoaModal({ client, companyId, onClose }) {
  // Header text — pre-filled with the client's legal_name; the other
  // three fields start blank for the user to fill in. We don't
  // persist these per the design call (keeps the header editable on
  // every generation).
  const [headerText, setHeaderText] = useState({
    companyName:   client.legal_name || client.trade_name || '',
    companyNumber: '',
    vatNumber:     '',
    address:       '',
  })

  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Load all invoices for this client across all periods. The SOA
  // needs the full history to render the year groupings + running
  // balance correctly.
  useEffect(() => {
    if (!companyId || !client?.id) return
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const { data, error: e } = await supabase
          .from('invoices')
          .select('id, invoice_type, invoice_number, period_year, period_month, date_issued, date_paid, amount_net, vat_rate, amount_total, status, description')
          .eq('company_id', companyId)
          .eq('client_id', client.id)
          .order('date_issued', { ascending: true })
        if (e) throw e
        if (cancelled) return
        setInvoices(data || [])
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, client?.id])

  // Issued vs draft counts to give the user a sense of what's about
  // to land in the SOA.
  const issuedCount = invoices.filter(i => !!i.date_issued).length
  const paidCount   = invoices.filter(i => !!i.date_paid).length

  const handleDownload = () => {
    try {
      downloadSoaWorkbook({
        client,
        invoices,
        orphanPayments: [],   // v1: skip orphans — paid invoices already cover the common case
        headerText,
      })
    } catch (e) {
      setError(`Download failed: ${e.message || e}`)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 700, width: '95%' }}>
        <div className="modal-header">
          <h3>📋 Statement of Account — Project {client.trade_name}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          {error && <div className="message error">{error}</div>}

          {/* Data summary so the user knows what's about to be exported */}
          <div className="form-group" style={{
            background: '#f0f9ff', border: '1px solid #bae6fd',
            borderRadius: 4, padding: 10, fontSize: 13, color: '#075985',
          }}>
            {loading ? '⏳ Loading invoices…' : (
              <>
                <strong>{issuedCount} issued invoice{issuedCount === 1 ? '' : 's'}</strong>
                {' · '}{paidCount} paid (so {paidCount} inwards transfer row{paidCount === 1 ? '' : 's'})
                {' · '}draft invoices without a Date Issued are skipped.
              </>
            )}
          </div>

          {/* Editable header block — the SOA top section. Not
              persisted; the user can refine each generation. */}
          <h4 style={{ marginTop: 16, marginBottom: 4 }}>Header (editable each time)</h4>
          <div className="form-group">
            <label>Company name</label>
            <input
              type="text"
              className="form-input"
              value={headerText.companyName}
              onChange={(e) => setHeaderText({ ...headerText, companyName: e.target.value })}
              placeholder="e.g. EVIMER LTD"
            />
          </div>
          <div className="form-group">
            <label>Company registration number</label>
            <input
              type="text"
              className="form-input"
              value={headerText.companyNumber}
              onChange={(e) => setHeaderText({ ...headerText, companyNumber: e.target.value })}
              placeholder="e.g. HE439329"
            />
          </div>
          <div className="form-group">
            <label>VAT number</label>
            <input
              type="text"
              className="form-input"
              value={headerText.vatNumber}
              onChange={(e) => setHeaderText({ ...headerText, vatNumber: e.target.value })}
              placeholder="e.g. 10439329Y"
            />
          </div>
          <div className="form-group">
            <label>Address</label>
            <input
              type="text"
              className="form-input"
              value={headerText.address}
              onChange={(e) => setHeaderText({ ...headerText, address: e.target.value })}
              placeholder="e.g. Florinis 7, Greg Tower, 2nd floor, 1065 Nicosia, Cyprus"
            />
          </div>

          <small style={{ color: '#6b7280', fontSize: 12, display: 'block', marginTop: 6 }}>
            💡 Description text uses the per-client templates from the Edit Client form
            (fields <code>soa_consultancy_template</code> / <code>soa_reimbursement_template</code>).
            If you've typed a description on an individual invoice, that overrides the template.
          </small>
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 12, borderTop: '1px solid #e5e7eb' }}>
          <button onClick={onClose} className="btn-cancel">Cancel</button>
          <button
            onClick={handleDownload}
            disabled={loading || issuedCount === 0}
            style={{
              background: issuedCount === 0 ? '#d1d5db' : '#16a34a',
              color: 'white', border: 'none', borderRadius: 4,
              padding: '8px 16px', fontSize: 14, fontWeight: 600,
              cursor: (loading || issuedCount === 0) ? 'not-allowed' : 'pointer',
            }}
            title={issuedCount === 0
              ? 'No issued invoices to include in the SOA yet'
              : `Download Excel SOA with ${issuedCount} invoice${issuedCount === 1 ? '' : 's'}`}
          >
            📥 Download SOA (.xlsx)
          </button>
        </div>
      </div>
    </div>
  )
}
