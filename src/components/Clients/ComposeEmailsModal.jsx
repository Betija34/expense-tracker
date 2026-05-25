import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import {
  groupInvoicesIntoEmails,
  buildMailtoUrl,
} from '../../lib/emailTemplateBuilder'

// =====================================================================
// ComposeEmailsModal — Step 4 of the Clients & Billing module
// ---------------------------------------------------------------------
// Opens from the Invoicing tab. Pulls every invoice issued (date_issued
// set) for the current company + period that has NOT been emailed yet
// (email_sent_at IS NULL), groups them per the bundling rules in
// src/lib/emailTemplateBuilder.js, and renders one editable card per
// resulting email.
//
// Per card the user can:
//   - tweak To / Cc / Subject / Body before sending
//   - click "Open in Mail" — opens a mailto: link in her default mail
//     client with everything prefilled (she attaches the PDFs by hand,
//     since mailto: can't carry attachments per RFC 6068)
//   - click "Mark as Sent" — sets email_sent_at = NOW() on each invoice
//     in this card, removing it from the unsent queue
//
// Props:
//   companyId       — current company UUID
//   selectedMonth   — current top-bar period month (1-12)
//   selectedYear    — current top-bar period year
//   onClose         — modal-close callback
// =====================================================================
export function ComposeEmailsModal({ companyId, selectedMonth, selectedYear, onClose }) {
  const [clients,  setClients]  = useState([])
  const [invoices, setInvoices] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Per-card user overrides keyed by `${client.id}|${cardIndex}`. Lets
  // the user edit To/Cc/Subject/Body on a per-card basis without losing
  // the original generated text.
  const [overrides, setOverrides] = useState({})

  // Whether each card has been opened in mail / marked sent — drives the
  // button states. Keyed the same way as overrides.
  const [cardState, setCardState] = useState({})

  // Load all clients + invoices for the period on mount. We pull
  // ALL invoices for the period (not just unsent) so the user sees
  // a complete picture; then we mark already-sent ones with a clear
  // status badge.
  useEffect(() => {
    if (!companyId || !selectedMonth || !selectedYear) return
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)

        // Clients for this company
        const { data: cl, error: clErr } = await supabase
          .from('clients')
          .select('id, trade_name, legal_name, contact_name, email_to, email_cc, active')
          .eq('company_id', companyId)
          .order('trade_name', { ascending: true })
        if (clErr) throw clErr
        if (cancelled) return
        setClients(cl || [])

        // Invoices for this company + period. We pull only invoices
        // that have been ISSUED (date_issued set) — drafts that haven't
        // been issued yet aren't email-ready. Pro formas can be sent
        // even without an invoice_number per their own flow.
        const { data: inv, error: invErr } = await supabase
          .from('invoices')
          .select('id, client_id, invoice_type, period_year, period_month, invoice_number, date_issued, email_sent_at, status, description')
          .eq('company_id', companyId)
          .eq('period_year', selectedYear)
          .eq('period_month', selectedMonth)
          .not('date_issued', 'is', null)
          .order('date_issued', { ascending: true })
        if (invErr) throw invErr
        if (cancelled) return
        setInvoices(inv || [])
      } catch (e) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, selectedMonth, selectedYear])

  // Build the email cards per client. Memoized so we recompute only
  // when the underlying data changes.
  const emailsByClient = useMemo(() => {
    const out = []
    const invoicesByClient = new Map()
    for (const inv of invoices) {
      if (!invoicesByClient.has(inv.client_id)) invoicesByClient.set(inv.client_id, [])
      invoicesByClient.get(inv.client_id).push(inv)
    }
    for (const client of clients) {
      const clientInvoices = invoicesByClient.get(client.id) || []
      if (clientInvoices.length === 0) continue
      const cards = groupInvoicesIntoEmails(clientInvoices, client)
      if (cards.length === 0) continue
      out.push({ client, cards })
    }
    return out
  }, [clients, invoices])

  // Override key — combination of client id + card index.
  const ovKey = (clientId, cardIdx) => `${clientId}|${cardIdx}`

  // Compute the effective field values for a card (override if set,
  // otherwise the auto-generated value / client default).
  const effective = (client, card, cardIdx) => {
    const key = ovKey(client.id, cardIdx)
    const o   = overrides[key] || {}
    return {
      to:      o.to      ?? (client.email_to || ''),
      cc:      o.cc      ?? (client.email_cc || ''),
      subject: o.subject ?? card.subject,
      body:    o.body    ?? card.body,
    }
  }

  const setField = (clientId, cardIdx, field, value) => {
    const key = ovKey(clientId, cardIdx)
    setOverrides(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [field]: value } }))
  }

  const setCardFlag = (clientId, cardIdx, flag, value) => {
    const key = ovKey(clientId, cardIdx)
    setCardState(prev => ({ ...prev, [key]: { ...(prev[key] || {}), [flag]: value } }))
  }

  const openInMail = (client, card, cardIdx) => {
    const fields = effective(client, card, cardIdx)
    const url    = buildMailtoUrl(fields)
    window.location.href = url
    setCardFlag(client.id, cardIdx, 'opened', true)
  }

  // Mark each invoice in this card as sent (email_sent_at = NOW()).
  // We then locally update our invoices state so the badge in the UI
  // flips to "Sent" without needing a full reload.
  const markAsSent = async (client, card, cardIdx) => {
    const now = new Date().toISOString()
    try {
      const ids = card.invoices.map(i => i.id)
      const { error: updErr } = await supabase
        .from('invoices')
        .update({ email_sent_at: now, updated_at: now })
        .in('id', ids)
      if (updErr) throw updErr

      // Update local state so the chip changes immediately
      setInvoices(prev => prev.map(i =>
        ids.includes(i.id) ? { ...i, email_sent_at: now } : i
      ))
      setCardFlag(client.id, cardIdx, 'sent', true)
    } catch (e) {
      alert('Could not mark as sent: ' + (e.message || e))
    }
  }

  // ---- Render ----
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 900, width: '95%' }}>
        <div className="modal-header">
          <h3>✉️ Compose Emails — Period {selectedMonth}/{selectedYear}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          {loading && <div className="message">Loading invoices…</div>}
          {error   && <div className="message error">{error}</div>}

          {!loading && !error && emailsByClient.length === 0 && (
            <div className="empty-state">
              <p>No issued invoices found for this period — nothing to email yet.</p>
              <small style={{ color: '#6b7280' }}>
                Issued = invoice has a Date Issued. Drafts without a date aren't shown.
              </small>
            </div>
          )}

          {emailsByClient.map(({ client, cards }) => (
            <div key={client.id} style={{
              marginBottom: 18,
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              padding: 12,
              background: '#fafafa',
            }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#1f2937' }}>
                Project {client.trade_name}
                <span style={{ color: '#6b7280', fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
                  ({client.legal_name})
                </span>
              </h4>

              {cards.map((card, cardIdx) => {
                const eff      = effective(client, card, cardIdx)
                const flags    = cardState[ovKey(client.id, cardIdx)] || {}
                const allSent  = card.invoices.every(i => i.email_sent_at)
                const someSent = card.invoices.some(i => i.email_sent_at) && !allSent

                return (
                  <div key={cardIdx} style={{
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    padding: 10,
                    marginBottom: 8,
                    background: 'white',
                  }}>
                    {/* Card header: kind + invoice numbers + sent badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <strong style={{ fontSize: 13, color: '#374151' }}>
                          {labelForKind(card.kind, card.invoices.length)}
                        </strong>
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                          {card.invoices.map(i => i.invoice_number || `(no #)`).join(', ')}
                        </div>
                      </div>
                      {allSent && <SentBadge text="✓ Sent" />}
                      {someSent && <SentBadge text="⚠ Partial" />}
                      {!allSent && !someSent && flags.opened && <SentBadge text="📧 Opened" tone="info" />}
                    </div>

                    {/* Fields */}
                    <div className="form-group" style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 12 }}>To</label>
                      <input
                        type="text"
                        className="form-input"
                        value={eff.to}
                        onChange={(e) => setField(client.id, cardIdx, 'to', e.target.value)}
                        placeholder="comma-separated recipients"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 12 }}>Cc</label>
                      <input
                        type="text"
                        className="form-input"
                        value={eff.cc}
                        onChange={(e) => setField(client.id, cardIdx, 'cc', e.target.value)}
                        placeholder="(optional)"
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 12 }}>Subject</label>
                      <input
                        type="text"
                        className="form-input"
                        value={eff.subject}
                        onChange={(e) => setField(client.id, cardIdx, 'subject', e.target.value)}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 12 }}>Body</label>
                      <textarea
                        className="form-input"
                        rows={7}
                        value={eff.body}
                        onChange={(e) => setField(client.id, cardIdx, 'body', e.target.value)}
                        style={{ fontFamily: 'inherit', resize: 'vertical' }}
                      />
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={() => openInMail(client, card, cardIdx)}
                        style={{
                          background: '#185FA5', color: 'white',
                          border: 'none', borderRadius: 4,
                          padding: '6px 12px', fontSize: 13, cursor: 'pointer',
                          fontWeight: 500,
                        }}
                        title="Open this email in your default mail client. Attach PDFs by hand."
                      >
                        📧 Open in Mail
                      </button>
                      <button
                        type="button"
                        onClick={() => markAsSent(client, card, cardIdx)}
                        disabled={allSent}
                        style={{
                          background: allSent ? '#d1d5db' : '#16a34a', color: 'white',
                          border: 'none', borderRadius: 4,
                          padding: '6px 12px', fontSize: 13, cursor: allSent ? 'not-allowed' : 'pointer',
                          fontWeight: 500,
                        }}
                        title="Stamp email_sent_at = now on each invoice in this card"
                      >
                        {allSent ? '✓ Marked Sent' : '✓ Mark as Sent'}
                      </button>
                    </div>

                    <small style={{ color: '#9ca3af', fontSize: 11, marginTop: 6, display: 'block' }}>
                      💡 mailto: links can't carry attachments — attach the PDF(s) manually in your mail client before hitting Send.
                    </small>
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 12, borderTop: '1px solid #e5e7eb' }}>
          <button onClick={onClose} className="btn-cancel">Close</button>
        </div>
      </div>
    </div>
  )
}

// Friendly label for the card kind in the header. Reflects user-facing
// terminology, not internal types.
function labelForKind(kind, count) {
  if (kind === 'credit_note') return 'Credit Note email'
  if (kind === 'pro_forma')   return 'Pro Forma email'
  if (kind === 'one_off')     return 'One-off invoice email'
  if (kind === 'bundle')      return count === 1 ? 'Invoice email' : `Bundled email (${count} invoices)`
  return 'Email'
}

function SentBadge({ text, tone = 'success' }) {
  const colors = tone === 'info'
    ? { bg: '#dbeafe', fg: '#1e40af', bd: '#bfdbfe' }
    : { bg: '#dcfce7', fg: '#166534', bd: '#bbf7d0' }
  return (
    <span style={{
      background: colors.bg, color: colors.fg, border: `1px solid ${colors.bd}`,
      borderRadius: 999, fontSize: 11, padding: '2px 8px', fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>{text}</span>
  )
}
