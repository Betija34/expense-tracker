// Fee phases (V38 client_fee_phases).
//
// A client may have a phased fee schedule. For a given month, the monthly
// fee is the amount of the ONE monthly phase whose date range covers that
// month. Clients with no monthly phases fall back to clients.monthly_fee_net
// (the behaviour before phases existed).
//
// Dates are compared as ISO 'YYYY-MM-DD' strings (lexicographic == date order).

function pad2(n) { return String(n).padStart(2, '0') }

export function monthRange(year, month) {
  const first = `${year}-${pad2(month)}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const last = `${year}-${pad2(month)}-${pad2(lastDay)}`
  return { first, last }
}

// A monthly phase with no start date is "planned / dates TBC" and never
// covers any month.
export function phaseCoversMonth(phase, year, month) {
  if (!phase || phase.kind !== 'monthly' || !phase.effective_from) return false
  const { first, last } = monthRange(year, month)
  return phase.effective_from <= last && (!phase.effective_to || phase.effective_to >= first)
}

/**
 * Resolve the monthly fee for (year, month).
 * Returns { status, amount, phase, matches }
 *   status 'no_phases' — client has no monthly phases; amount = monthly_fee_net
 *   status 'phase'     — exactly one phase covers the month; amount = its amount
 *   status 'none'      — phases exist but none covers this month; amount = null
 *   status 'overlap'   — more than one phase covers it; amount = null
 */
export function resolveMonthlyFee(client, phases, year, month) {
  const monthly = (phases || []).filter(p => p.kind === 'monthly')
  if (monthly.length === 0) {
    return { status: 'no_phases', amount: client ? Number(client.monthly_fee_net || 0) : null, phase: null, matches: [] }
  }
  const matches = monthly.filter(p => phaseCoversMonth(p, year, month))
  if (matches.length === 1) return { status: 'phase', amount: Number(matches[0].amount_net || 0), phase: matches[0], matches }
  if (matches.length === 0) return { status: 'none', amount: null, phase: null, matches }
  return { status: 'overlap', amount: null, phase: null, matches }
}

// Validate a list of phase rows (as edited in the client form).
// Returns an error string or null.
export function validatePhases(rows) {
  for (const [i, r] of rows.entries()) {
    const n = `Phase ${i + 1}${r.label ? ` ("${r.label}")` : ''}`
    if (!String(r.label || '').trim()) return `Phase ${i + 1}: a name is required.`
    const amt = parseFloat(r.amount_net)
    if (Number.isNaN(amt) || amt < 0) return `${n}: amount must be a non-negative number.`
    if (r.effective_from && r.effective_to && r.effective_to < r.effective_from) return `${n}: end date is before start date.`
    if (r.kind === 'monthly' && !r.effective_from && r.effective_to) return `${n}: an end date needs a start date.`
  }
  // Dated monthly phases must not overlap (otherwise the fee is ambiguous).
  const dated = rows.filter(r => r.kind === 'monthly' && r.effective_from)
  for (let a = 0; a < dated.length; a++) {
    for (let b = a + 1; b < dated.length; b++) {
      const A = dated[a], B = dated[b]
      const aEnd = A.effective_to || '9999-12-31'
      const bEnd = B.effective_to || '9999-12-31'
      if (A.effective_from <= bEnd && B.effective_from <= aEnd) {
        return `Phases "${A.label}" and "${B.label}" overlap. Give the earlier one an end date before the next one starts (leave a phase's start date blank if its dates are not known yet).`
      }
    }
  }
  return null
}

export function fmtPhaseRange(p) {
  const f = (d) => {
    if (!d) return ''
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }
  if (p.kind === 'one_off') return p.effective_from ? f(p.effective_from) : 'date TBC'
  if (!p.effective_from) return 'dates TBC'
  return `${f(p.effective_from)} → ${p.effective_to ? f(p.effective_to) : 'open'}`
}
