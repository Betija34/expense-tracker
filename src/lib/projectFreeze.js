// Project freeze (V41 clients.frozen_from / frozen_until).
//
// A frozen project keeps its contract and its history, but NOTHING is
// billed for months inside the freeze: no monthly fee, no fixed expense
// reimbursement, no variable (expense report) reimbursement.
//
// Month granularity. frozen_from / frozen_until are stored as the first
// day of a month ('YYYY-MM-01'). frozen_until is INCLUSIVE and optional
// (blank = frozen until further notice).
//
// This is separate from `active`: an inactive project is archived for
// every month (past ones too); a frozen project is only paused for the
// months in its freeze window.

function monthKey(y, m) { return Number(y) * 12 + Number(m) }

function keyOfDate(d) {
  if (!d) return null
  const [y, m] = String(d).slice(0, 7).split('-').map(Number)
  if (!y || !m) return null
  return monthKey(y, m)
}

export function isFrozen(client, year, month) {
  if (!client || !year || !month) return false
  const from = keyOfDate(client.frozen_from)
  if (from == null) return false
  const until = keyOfDate(client.frozen_until)
  const k = monthKey(year, month)
  return k >= from && (until == null || k <= until)
}

// 'YYYY-MM-DD' -> 'YYYY-MM' (for <input type="month">)
export function toMonthInput(d) { return d ? String(d).slice(0, 7) : '' }
// 'YYYY-MM' -> 'YYYY-MM-01' (or null)
export function fromMonthInput(v) { return v && /^\d{4}-\d{2}$/.test(v) ? `${v}-01` : null }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function label(d) {
  const [y, m] = String(d).slice(0, 7).split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

// "Frozen from Oct 2026" / "Frozen Oct 2026 – Jan 2027"
export function freezeLabel(client) {
  if (!client?.frozen_from) return ''
  return client.frozen_until
    ? `Frozen ${label(client.frozen_from)} – ${label(client.frozen_until)}`
    : `Frozen from ${label(client.frozen_from)}`
}

export function validateFreeze(fromInput, untilInput) {
  if (!fromInput && untilInput) return 'A freeze end month needs a start month.'
  if (fromInput && untilInput && untilInput < fromInput) return 'The freeze end month is before the start month.'
  return null
}
