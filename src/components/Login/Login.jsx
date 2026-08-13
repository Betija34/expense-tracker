import { useState } from 'react'
import { supabase } from '../../supabaseClient'
import './Login.css'

// Single-login gate for the whole app. There is one authorized account
// (the owner). On success, App's onAuthStateChange listener re-renders to
// the tracker — this component doesn't need to do anything further.
export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      setError(error.message || 'Sign in failed. Check your email and password.')
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Rabona Expense Tracker</h1>
        <p className="login-sub">Please sign in to continue</p>

        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error && <div className="login-error">{error}</div>}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="login-footer">Private system • Authorized access only</p>
    </div>
  )
}
