import { useState } from 'react'
import { Navigate, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import AuthLayout from '../components/AuthLayout.jsx'

export default function Signup() {
  const { session, signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)
  const [alreadyRegistered, setAlreadyRegistered] = useState(false)
  const navigate = useNavigate()

  if (session) return <Navigate to="/" replace />

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setSubmitting(true)
    const { data, error } = await signUp(email, password)
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }

    // Supabase intentionally does not return an error for "email already
    // registered" (prevents attackers from probing which emails exist).
    // Instead it returns a user object with an empty identities array and
    // no session. Detect that case and tell the truth instead of showing
    // a misleading "check your email" screen.
    const isExistingAccount = Array.isArray(data?.user?.identities) && data.user.identities.length === 0

    if (data?.session) {
      // Email confirmation is off (or not required) — signed in immediately.
      navigate('/')
    } else if (isExistingAccount) {
      setAlreadyRegistered(true)
    } else {
      // A genuinely new account, and email confirmation is required.
      setConfirmSent(true)
    }
  }

  if (alreadyRegistered) {
    return (
      <AuthLayout
        activeTab="signup"
        title="Account already exists"
        subtitle="That email is already registered."
      >
        <div className="alert alert-info small mb-0">
          An account with this email already exists. <Link to="/login">Sign in instead</Link>, or use
          "Forgot password" on the sign-in page if you don't remember your password.
        </div>
      </AuthLayout>
    )
  }

  if (confirmSent) {
    return (
      <AuthLayout
        activeTab="signup"
        title="Check your email"
        subtitle="We sent a confirmation link to finish creating your account."
      >
        <div className="alert alert-info small mb-0">
          Confirm your email, then come back and sign in.
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      activeTab="signup"
      title="Create your account"
      subtitle="Hand your mornings off to an assistant that actually plans them."
    >
      <form onSubmit={handleSubmit}>
        <div className="mb-3">
          <label className="form-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="form-control"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            className="form-control"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="confirmPassword">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            className="form-control"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <button
          type="submit"
          className="btn btn-primary w-100"
          disabled={submitting}
        >
          {submitting ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  )
}
