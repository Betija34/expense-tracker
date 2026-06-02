import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'

/**
 * LockContext — global state for month locking.
 *
 * Loads the closed_periods table once on mount, exposes:
 *   isLocked(companyId, year, month)  — sync boolean check
 *   isCurrentLocked                    — convenience: is the top-bar selection locked?
 *   lockPeriod(companyId, year, month, notes)   — async, inserts a closed_periods row
 *   unlockPeriod(companyId, year, month)        — async, deletes the closed_periods row
 *   refresh()                          — re-fetch from DB (rarely needed; lock/unlock auto-refresh)
 *
 * Why context: a banner at the App level needs to know lock state; every
 * page also needs to know (to disable edit buttons). Putting it in a
 * context lets all of them read the same single source of truth.
 */

const LockContext = createContext(null)

// Compact key for the in-memory Set
const keyOf = (companyId, year, month) => `${companyId}|${year}|${month}`

export function LockProvider({ children, selectedCompany, selectedMonth, selectedYear, companies }) {
  const [closedSet, setClosedSet] = useState(new Set())
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)

  // companyId for the currently-selected top-bar company (looked up from
  // the companies array provided by the App). Falls back to null if the
  // companies haven't loaded yet.
  const currentCompanyId = useMemo(() => {
    if (!companies || !selectedCompany) return null
    return companies.find(c => c.name === selectedCompany)?.id || null
  }, [companies, selectedCompany])

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const { data, error: err } = await supabase
        .from('closed_periods')
        .select('company_id, year, month')
      if (err) throw err
      const next = new Set()
      for (const r of (data || [])) {
        next.add(keyOf(r.company_id, r.year, r.month))
      }
      setClosedSet(next)
    } catch (e) {
      console.error('LockContext load error:', e)
      setError(e.message || 'Failed to load lock state')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const isLocked = useCallback(
    (companyId, year, month) => {
      if (!companyId || !year || !month) return false
      return closedSet.has(keyOf(companyId, year, month))
    },
    [closedSet]
  )

  const isCurrentLocked = useMemo(
    () => isLocked(currentCompanyId, selectedYear, selectedMonth),
    [isLocked, currentCompanyId, selectedYear, selectedMonth]
  )

  const lockPeriod = useCallback(
    async (companyId, year, month, notes = null) => {
      const { error: err } = await supabase
        .from('closed_periods')
        .insert([{ company_id: companyId, year, month, notes }])
      if (err) throw err
      // Optimistic local update so the UI flips immediately.
      setClosedSet(prev => {
        const next = new Set(prev)
        next.add(keyOf(companyId, year, month))
        return next
      })
    },
    []
  )

  const unlockPeriod = useCallback(
    async (companyId, year, month) => {
      const { error: err } = await supabase
        .from('closed_periods')
        .delete()
        .eq('company_id', companyId)
        .eq('year', year)
        .eq('month', month)
      if (err) throw err
      setClosedSet(prev => {
        const next = new Set(prev)
        next.delete(keyOf(companyId, year, month))
        return next
      })
    },
    []
  )

  const value = useMemo(() => ({
    loading,
    error,
    isLocked,
    isCurrentLocked,
    currentCompanyId,
    lockPeriod,
    unlockPeriod,
    refresh,
  }), [loading, error, isLocked, isCurrentLocked, currentCompanyId, lockPeriod, unlockPeriod, refresh])

  return <LockContext.Provider value={value}>{children}</LockContext.Provider>
}

/**
 * useLock — convenience hook. Returns the LockContext value, throws a
 * helpful error if used outside a <LockProvider>. Every component that
 * needs to check lock state or call lock/unlock uses this.
 */
export function useLock() {
  const ctx = useContext(LockContext)
  if (!ctx) {
    throw new Error('useLock must be used inside a <LockProvider>')
  }
  return ctx
}
