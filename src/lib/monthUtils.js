// =====================================================================
// Month helpers — shared between the entry forms and the Travel Log
// for the "Expected Travel Month" feature.
// =====================================================================
//
// DB format: DATE column storing the 1st of the chosen month, e.g.
//   2026-08-01 → "August 2026".
//
// UI value format passed around in form state: "YYYY-MM" (string, no day),
// which is appended with "-01" before saving and sliced from the DB value
// when loading.
// =====================================================================

const MONTH_NAMES = [
  'January', 'February', 'March',     'April',
  'May',     'June',     'July',      'August',
  'September','October', 'November',  'December',
]

/**
 * Format a "YYYY-MM" or "YYYY-MM-DD" value as a friendly "Month YYYY" string.
 * Used in display badges and dropdown labels.
 */
export function formatMonthYear(value) {
  if (!value) return ''
  const [y, m] = value.slice(0, 7).split('-')
  const idx = parseInt(m, 10) - 1
  if (idx < 0 || idx > 11) return value
  return `${MONTH_NAMES[idx]} ${y}`
}

/**
 * Build a dropdown-friendly list of months centered around today.
 * Defaults to 12 months in the past and 24 months in the future
 * (enough room for "back-fill" entries and forward planning).
 *
 * If `includeValue` is supplied and not in the generated range, it gets
 * prepended so the form keeps showing a legacy/out-of-range selection
 * instead of silently blanking out.
 *
 * @param {object} [opts]
 * @param {number} [opts.monthsBack=12]
 * @param {number} [opts.monthsForward=24]
 * @param {string} [opts.includeValue] e.g. "2026-08"
 * @returns {Array<{value: string, label: string}>}
 */
export function monthOptions({
  monthsBack = 12,
  monthsForward = 24,
  includeValue,
} = {}) {
  const today = new Date()
  const startYear = today.getFullYear()
  const startMonth = today.getMonth() - monthsBack
  const opts = []
  const seen = new Set()

  const total = monthsBack + monthsForward + 1
  for (let i = 0; i < total; i++) {
    const d = new Date(startYear, startMonth + i, 1)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const value = `${y}-${String(m).padStart(2, '0')}`
    if (!seen.has(value)) {
      seen.add(value)
      opts.push({ value, label: `${MONTH_NAMES[d.getMonth()]} ${y}` })
    }
  }

  if (includeValue && !seen.has(includeValue)) {
    opts.unshift({
      value: includeValue,
      label: formatMonthYear(includeValue),
    })
  }

  return opts
}
