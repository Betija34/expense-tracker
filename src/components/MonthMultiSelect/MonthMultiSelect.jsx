import { useState } from 'react'
import { monthOptions, formatMonthYear } from '../../lib/monthUtils'

/**
 * MonthMultiSelect — pill-based multi-month picker.
 *
 * Used for the "Expected Travel Month" field where a single payment can
 * cover multiple future trip months (e.g. a deposit for Jan + Feb 2027
 * rent). Internal model is a comma-separated string of YYYY-MM values
 * to match the database column (TEXT), so the parent form's state stays
 * a single string and saves are trivial.
 *
 * Visual model:
 *   • Each selected month renders as a pill with an × to remove it.
 *   • A "+ Add month" dropdown appears beside the pills. Picking a month
 *     adds it to the list and resets the dropdown.
 *   • Empty state shows just the dropdown.
 *
 * Props:
 *   value:        string  — comma-separated "YYYY-MM" tokens (or "")
 *   onChange:     fn(string) — called with the new comma-separated value
 *   placeholder:  string  — shown in the dropdown when no items yet
 */
export function MonthMultiSelect({ value, onChange, placeholder = '— Pick a month —' }) {
  const tokens = (value || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const [draft, setDraft] = useState('')

  const commit = (next) => {
    onChange(next.join(','))
  }

  const addMonth = (val) => {
    if (!val) return
    if (tokens.includes(val)) {
      setDraft('')
      return
    }
    // Keep tokens sorted ascending so the badge reads naturally.
    const next = [...tokens, val].sort()
    commit(next)
    setDraft('')
  }

  const removeMonth = (val) => {
    commit(tokens.filter(t => t !== val))
  }

  // Pre-build the dropdown options, excluding already-picked months so
  // the user can't add the same month twice.
  const opts = monthOptions().filter(o => !tokens.includes(o.value))
  // Also include any picked-but-out-of-range tokens so existing data
  // remains valid (just to be safe — shouldn't happen with our range).

  return (
    <div>
      {/* Selected months as pills */}
      {tokens.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          {tokens.map(t => (
            <span
              key={t}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: '#ede9fe',
                color: '#6d28d9',
                fontSize: 12,
                fontWeight: 600,
                borderRadius: 999,
              }}
            >
              {formatMonthYear(t)}
              <button
                type="button"
                onClick={() => removeMonth(t)}
                aria-label={`Remove ${formatMonthYear(t)}`}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#6d28d9',
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 0,
                }}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {/* Add-a-month dropdown. Selecting from it triggers an immediate
          add — no separate confirm step. The draft state resets so the
          control reads "Pick a month" again after each addition. */}
      <select
        value={draft}
        onChange={(e) => addMonth(e.target.value)}
        className="form-input"
      >
        <option value="">{tokens.length === 0 ? placeholder : '+ Add another month'}</option>
        {opts.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}
