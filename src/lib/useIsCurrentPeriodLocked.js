import { useLock } from './LockContext'

/**
 * useIsCurrentPeriodLocked — convenience hook returning a single boolean.
 *
 * Most components just need to know "is the user looking at a locked
 * period right now?" — they don't need the full LockContext API. This
 * wraps useLock() to expose just that boolean and saves the boilerplate
 * of pulling `isCurrentLocked` out of the context every time.
 *
 * Usage:
 *
 *   const isLocked = useIsCurrentPeriodLocked()
 *   <button disabled={isLocked} ...>Save</button>
 *   {isLocked && <span>Period locked — read-only</span>}
 *
 * The current period is whatever (company + month + year) is selected
 * in the App-level top bar — passed to LockProvider as props.
 */
export function useIsCurrentPeriodLocked() {
  const { isCurrentLocked } = useLock()
  return isCurrentLocked
}
