import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'

// =====================================================================
// ImportHistoricalRowsModal
// ---------------------------------------------------------------------
// Lets the user paste tab-separated rows copied from her existing
// external SOA Excel files into the system. Stored once per client in
// `soa_historical_rows`; the SOA generator then merges them with
// system invoices/payments on every export, so the full multi-year
// ledger appears without the user having to paste each time.
//
// Paste format (from her sample SOA Excels — columns B..G):
//   <Date>\t<DOCUMENT Type>\t<DOCUMENT No>\t<Description>\t<Amount>\t<Received>
//
// Optional leading tab (col A is empty in her files).
// Date can be `YYYY-MM-DD`, `DD/MM/YYYY`, or `D/M/YYYY`.
// Amounts can contain thousands separators ("1,234.56") and parens
// for negative ("(123.45)").
// Empty fields are tolerated (consecutive tabs).
// Header rows ("DOCUMENT Date | DOCUMENT Type | ...") and the
// auto-generated PROG. BALANCE column are silently ignored.
//
// On Save: deletes ALL existing historical rows for this client,
// inserts the freshly-parsed batch. Safer than upserting since the
// row identities don't have a stable natural key.
// =====================================================================

export function ImportHistoricalRowsModal({ client, onClose, onSaved }) {
  const [raw, setRaw]         = useState('')
  const [parsed, setParsed]   = useState([])
  const [errors, setErrors]   = useState([])
  const [existingCount, setExistingCount] = useState(0)
  const [saving, setSaving]   = useState(false)
  const [saveError, setSaveError] = useState(null)

  // Load count of existing historical rows so we can warn the user that
  // saving will REPLACE them (we delete-then-insert).
  useEffect(() => {
    if (!client?.id) return
    let cancelled = false
    ;(async () => {
      const { count, error } = await supabase
        .from('soa_historical_rows')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
      if (!cancelled && !error) setExistingCount(count || 0)
    })()
    return () => { cancelled = true }
  }, [client?.id])

  // Re-parse whenever the textarea changes.
  useEffect(() => {
    const { rows, errs } = parseRows(raw)
    setParsed(rows)
    setErrors(errs)
  }, [raw])

  const handleSave = async () => {
    setSaveError(null)
    if (parsed.length === 0) { setSaveError('Nothing to save — paste rows first.'); return }
    if (errors.length > 0)   { setSaveError('Fix parsing errors before saving.'); return }
    if (existingCount > 0) {
      const ok = window.confirm(
        `Replace ${existingCount} existing historical row${existingCount === 1 ? '' : 's'} ` +
        `for Project ${client.trade_name} with ${parsed.length} new row${parsed.length === 1 ? '' : 's'}?`
      )
      if (!ok) return
    }
    try {
      setSaving(true)

      // Delete all existing rows for this client, then insert the new batch.
      const { error: delErr } = await supabase
        .from('soa_historical_rows')
        .delete()
        .eq('client_id', client.id)
      if (delErr) throw delErr

      if (parsed.length > 0) {
        const rows = parsed.map((p, i) => ({
          client_id:   client.id,
          row_index:   i + 1,
          row_date:    p.row_date,
          doc_type:    p.doc_type || null,
          doc_number:  p.doc_number || null,
          description: p.description || null,
          amount:      p.amount   || 0,
          received:    p.received || 0,
        }))
        const { error: insErr } = await supabase
          .from('soa_historical_rows')
          .insert(rows)
        if (insErr) throw insErr
      }

      onSaved && onSaved(parsed.length)
      onClose && onClose()
    } catch (e) {
      setSaveError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleClearAll = async () => {
    if (existingCount === 0) return
    if (!window.confirm(`Delete all ${existingCount} historical row(s) for Project ${client.trade_name}? This cannot be undone.`)) return
    try {
      setSaving(true)
      const { error } = await supabase
        .from('soa_historical_rows')
        .delete()
        .eq('client_id', client.id)
      if (error) throw error
      setExistingCount(0)
      onSaved && onSaved(0)
    } catch (e) {
      setSaveError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 900, width: '95%' }}>
        <div className="modal-header">
          <h3>📜 Import Historical Rows — Project {client.trade_name}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
          {saveError && <div className="message error">{saveError}</div>}

          {/* Current state + clear button */}
          <div className="form-group" style={{
            background: '#f0f9ff', border: '1px solid #bae6fd',
            borderRadius: 4, padding: 10, fontSize: 13, color: '#075985',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>
              {existingCount === 0
                ? 'No historical rows stored for this client yet.'
                : <><strong>{existingCount} historical row{existingCount === 1 ? '' : 's'}</strong> currently stored for this client.</>}
            </span>
            {existingCount > 0 && (
              <button
                onClick={handleClearAll}
                disabled={saving}
                style={{
                  background: '#dc2626', color: 'white', border: 'none',
                  borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                }}
              >
                🗑 Clear all
              </button>
            )}
          </div>

          {/* Paste instructions */}
          <h4 style={{ marginTop: 16, marginBottom: 4 }}>Paste rows from your old SOA Excel</h4>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
            Select the rows in Excel (columns: <strong>Date · Type · Doc No · Description · Amount · Received</strong>) and paste below.
            The PROG. BALANCE column is ignored — the system recomputes it. Header rows are skipped.
            Saving REPLACES any existing historical rows for this client.
          </div>

          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={`2023-08-01\tPREVIOUS TOTALS:\t\t\t\t\n2023-09-06\tINVOICE\t2023/09/001\tServices per Consultancy Service Agreement section 6.1 …\t8330\t\n2023-09-07\t\t\tINWARDS TRANSFER (AUGUST FEE 2023)\t\t8330`}
            className="form-input"
            rows={10}
            style={{ fontFamily: 'monospace', fontSize: 12, width: '100%' }}
          />

          {/* Parser feedback */}
          {raw.trim() && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              {errors.length > 0 ? (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 4, padding: 10, color: '#991b1b',
                }}>
                  <strong>⚠ {errors.length} parsing error{errors.length === 1 ? '' : 's'}:</strong>
                  <ul style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 12 }}>
                    {errors.slice(0, 8).map((e, i) => <li key={i}>Line {e.lineNo}: {e.msg}</li>)}
                    {errors.length > 8 && <li>… and {errors.length - 8} more</li>}
                  </ul>
                </div>
              ) : (
                <div style={{
                  background: '#dcfce7', border: '1px solid #bbf7d0',
                  borderRadius: 4, padding: 10, color: '#166534',
                }}>
                  ✓ <strong>{parsed.length} row{parsed.length === 1 ? '' : 's'} parsed cleanly</strong>
                  {' · '}date range:{' '}
                  {parsed.length > 0 ? `${parsed[0].row_date} → ${parsed[parsed.length - 1].row_date}` : '—'}
                </div>
              )}
            </div>
          )}

          {/* Preview table */}
          {parsed.length > 0 && (
            <div style={{ marginTop: 12, maxHeight: 300, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 4 }}>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#f3f4f6' }}>
                  <tr>
                    <th style={cellStyle()}>Date</th>
                    <th style={cellStyle()}>Type</th>
                    <th style={cellStyle()}>Doc No</th>
                    <th style={cellStyle()}>Description</th>
                    <th style={{ ...cellStyle(), textAlign: 'right' }}>Amount</th>
                    <th style={{ ...cellStyle(), textAlign: 'right' }}>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 50).map((p, i) => (
                    <tr key={i}>
                      <td style={cellStyle()}>{p.row_date}</td>
                      <td style={cellStyle()}>{p.doc_type || ''}</td>
                      <td style={cellStyle()}>{p.doc_number || ''}</td>
                      <td style={cellStyle()}>{p.description || ''}</td>
                      <td style={{ ...cellStyle(), textAlign: 'right' }}>{p.amount ? p.amount.toFixed(2) : ''}</td>
                      <td style={{ ...cellStyle(), textAlign: 'right' }}>{p.received ? p.received.toFixed(2) : ''}</td>
                    </tr>
                  ))}
                  {parsed.length > 50 && (
                    <tr><td colSpan={6} style={{ ...cellStyle(), textAlign: 'center', color: '#6b7280', fontStyle: 'italic' }}>
                      … and {parsed.length - 50} more rows (preview shows first 50)
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 12, borderTop: '1px solid #e5e7eb' }}>
          <button onClick={onClose} className="btn-cancel">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || parsed.length === 0 || errors.length > 0}
            style={{
              background: (saving || parsed.length === 0 || errors.length > 0) ? '#d1d5db' : '#16a34a',
              color: 'white', border: 'none', borderRadius: 4,
              padding: '8px 16px', fontSize: 14, fontWeight: 600,
              cursor: (saving || parsed.length === 0 || errors.length > 0) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? '⏳ Saving…' : `✓ Save ${parsed.length} row${parsed.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function cellStyle() {
  return { padding: '4px 6px', borderBottom: '1px solid #e5e7eb', textAlign: 'left', verticalAlign: 'top' }
}

// ---------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------
// Returns { rows: [{ row_date, doc_type, doc_number, description, amount, received }], errs: [{lineNo, msg}] }
//
// Tab-separated, six expected columns after column A (which is empty
// in the user's existing SOA — we skip leading empty fields).
// Tolerant of: extra empty leading/trailing fields, header lines,
// blank lines, and numbers with commas / parens / euro signs.
function parseRows(raw) {
  const rows = []
  const errs = []
  if (!raw) return { rows, errs }

  const lines = raw.split(/\r?\n/)
  lines.forEach((line, idx) => {
    const lineNo = idx + 1
    if (!line.trim()) return   // skip blank lines

    // Skip Excel header rows pasted in by accident.
    const lower = line.toLowerCase()
    if (lower.includes('document') && lower.includes('description')) return
    if (lower.includes('prog. balance') || lower.includes('prog balance')) return

    // Skip rows that are pure YEAR YYYY TOTAL summary rows.
    if (/year\s+\d{4}/i.test(lower) && lower.includes('total')) return

    // Split into cells, trim each.
    let cells = line.split('\t').map(c => c.trim())

    // Excel users sometimes have an empty column A — strip a single
    // leading empty cell so the date lands in cells[0].
    if (cells.length > 0 && cells[0] === '') cells = cells.slice(1)

    // Pad to 7 cells (date, type, no, desc, amount, received, balance).
    while (cells.length < 7) cells.push('')

    const [dateStr, typeStr, numStr, descStr, amtStr, recStr /*, balStr ignored */] = cells

    // Parse date — accept yyyy-mm-dd or dd/mm/yyyy or d/m/yyyy.
    const row_date = parseDate(dateStr)
    if (!row_date) {
      errs.push({ lineNo, msg: `couldn't parse date "${dateStr}"` })
      return
    }

    const amount   = parseAmount(amtStr)
    const received = parseAmount(recStr)
    if (amtStr && amount == null) { errs.push({ lineNo, msg: `couldn't parse amount "${amtStr}"` }); return }
    if (recStr && received == null) { errs.push({ lineNo, msg: `couldn't parse received "${recStr}"` }); return }

    rows.push({
      row_date,
      doc_type:    typeStr || '',
      doc_number:  numStr  || '',
      description: descStr || '',
      amount:      amount   || 0,
      received:    received || 0,
    })
  })

  return { rows, errs }
}

// Try a few common Excel date layouts. Returns 'YYYY-MM-DD' or null.
function parseDate(s) {
  if (!s) return null
  const trimmed = s.trim()

  // yyyy-mm-dd
  let m = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) {
    const [, y, mo, d] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // dd/mm/yyyy or d/m/yyyy
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // dd-mm-yyyy
  m = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  return null
}

// Parse a numeric cell — handles thousands commas, currency signs,
// parens-for-negative. Returns a number or null if the string is
// non-empty but can't be parsed.
function parseAmount(s) {
  if (s == null) return null
  const t = String(s).trim()
  if (!t) return 0

  // (123.45) → -123.45
  let sign = 1
  let str = t
  if (/^\(.*\)$/.test(str)) { sign = -1; str = str.slice(1, -1) }

  // strip currency + thousands separators + spaces
  str = str.replace(/[€$£,\s]/g, '')

  // Replace any trailing minus (e.g. "123.45-")
  if (str.endsWith('-')) { sign *= -1; str = str.slice(0, -1) }

  const n = parseFloat(str)
  if (Number.isNaN(n)) return null
  return sign * n
}
