import { useLock } from '../../lib/LockContext'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

/**
 * LockBanner — persistent banner shown app-wide whenever the top-bar
 * selection (company + month + year) lands on a closed period.
 *
 * Read-only signal for the user: "this period is locked, switch month
 * to make changes". Backed by LockContext.isCurrentLocked.
 *
 * Hidden in print so reports don't render the banner on paper.
 */
export function LockBanner({ selectedCompany, selectedMonth, selectedYear }) {
  const { isCurrentLocked } = useLock()
  if (!isCurrentLocked) return null

  const monthLabel = `${MONTH_NAMES[selectedMonth - 1] || selectedMonth} ${selectedYear}`

  return (
    <div className="no-print" style={{
      background: '#fef3c7',
      borderTop: '1px solid #fcd34d',
      borderBottom: '1px solid #fcd34d',
      padding: '8px 16px',
      fontSize: 13,
      color: '#92400e',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontWeight: 500,
    }}>
      <span style={{ fontSize: 16 }}>🔒</span>
      <span>
        <strong>{monthLabel} — {selectedCompany} · Period locked.</strong>{' '}
        Read-only. Switch the month or company to make changes, or unlock the period via the Monthly Checklist tab.
      </span>
    </div>
  )
}
