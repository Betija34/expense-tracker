import { useState, useCallback, useRef } from 'react'
import { ConfirmModal } from '../components/ConfirmModal/ConfirmModal'

/**
 * useConfirm — Promise-based confirm dialog using ConfirmModal.
 *
 * Drop-in replacement for window.confirm() that returns a Promise<boolean>,
 * which lets the existing async code keep its shape:
 *
 *   const ok = await confirm({ title: 'Delete?', message: 'Are you sure?' })
 *   if (!ok) return
 *
 * Why a hook (not a global function): we want the modal to live inside
 * the component tree so it inherits theme, doesn't fight z-index with
 * other modals, and gets HMR'd correctly. The trade-off is each user
 * component renders its own modal slot via `{confirmModal}`.
 *
 * Usage:
 *
 *   const { confirm, confirmModal } = useConfirm()
 *
 *   const handleDelete = async () => {
 *     const ok = await confirm({
 *       title: 'Delete this expense?',
 *       message: 'The bank transaction will go back to Pending.',
 *       confirmText: 'Delete',
 *       variant: 'danger',
 *     })
 *     if (!ok) return
 *     // ... proceed with delete ...
 *   }
 *
 *   return (
 *     <div>
 *       {/* ...your component... *​/}
 *       {confirmModal}
 *     </div>
 *   )
 *
 * Returns object with:
 *   confirm      — async function taking ConfirmOptions, returns Promise<boolean>
 *   confirmModal — JSX element to render once in your tree
 */
export function useConfirm() {
  const [state, setState] = useState({ open: false })
  // resolver for the in-flight confirm promise — useRef so we don't lose
  // it across re-renders.
  const resolverRef = useRef(null)

  const confirm = useCallback((opts) => {
    console.log('[useConfirm] confirm() called', opts)
    return new Promise((resolve) => {
      resolverRef.current = resolve
      setState({
        open: true,
        title:       opts.title       ?? 'Confirm',
        message:     opts.message     ?? '',
        details:     opts.details     ?? null,
        confirmText: opts.confirmText ?? 'Confirm',
        cancelText:  opts.cancelText  ?? 'Cancel',
        variant:     opts.variant     ?? 'primary',
      })
    })
  }, [])

  const onConfirm = useCallback(() => {
    const r = resolverRef.current
    resolverRef.current = null
    setState({ open: false })
    r?.(true)
  }, [])

  const onCancel = useCallback(() => {
    const r = resolverRef.current
    resolverRef.current = null
    setState({ open: false })
    r?.(false)
  }, [])

  // IMPORTANT: return JSX directly, NOT a function/component. Returning a
  // function from a hook and rendering it as <Foo /> creates a new
  // component type each render, which React treats as unmount/remount —
  // and in some cases simply doesn't render at all. Using `{confirmModal}`
  // sidesteps all that — it's just a plain element that re-renders with
  // the parent.
  const confirmModal = (
    <ConfirmModal
      open={state.open}
      title={state.title}
      message={state.message}
      details={state.details}
      confirmText={state.confirmText}
      cancelText={state.cancelText}
      variant={state.variant}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )

  return { confirm, confirmModal }
}
