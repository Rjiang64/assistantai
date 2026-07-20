import { useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../assets/logo.jpeg'

// Split-screen auth wrapper used by Login and Signup.
//
//   LEFT panel (65% desktop, hidden on mobile):
//     brand mark + name, hero headline, product description, footer.
//
//   RIGHT panel (35% desktop, 100% mobile):
//     title/subtitle + pill tab toggle (Sign in / Sign up) + {children}
//     (the email/password form, owned by the page).
//
// AuthLayout never touches form state — each page owns its own inputs.

export default function AuthLayout({ activeTab, title, subtitle, children }) {
  const [logoFailed, setLogoFailed] = useState(false)

  return (
    <div className="auth-split">
      <aside className="auth-image-panel" aria-hidden="true">
        <div className="auth-image-overlay" />
        <div className="auth-image-content">
          <div className="auth-image-brand">
            {logoFailed ? (
              <span className="brand-mark brand-mark-letter">A</span>
            ) : (
              <img
                src={logo}
                alt="AssistantAI"
                className="brand-mark brand-mark-img"
                onError={() => setLogoFailed(true)}
              />
            )}
            <span>AssistantAI</span>
          </div>
          <div className="auth-image-hero">
            <h2 className="auth-image-title">Your day, organized before you ask.</h2>
            <p className="auth-image-description">
              Speak your brain dump. AssistantAI extracts every task and fixed
              event, resolves conflicts, and builds an optimized schedule —
              like handing your morning to an executive assistant instead of
              a chat window.
            </p>
          </div>
          <div className="auth-image-footer">© 2026 AssistantAI</div>
        </div>
      </aside>

      <main className="auth-form-panel">
        <div className="auth-form-inner">
          <Link to="/" className="auth-form-brand">
            {logoFailed ? (
              <span className="brand-mark brand-mark-letter">A</span>
            ) : (
              <img
                src={logo}
                alt="AssistantAI"
                className="brand-mark brand-mark-img"
                onError={() => setLogoFailed(true)}
              />
            )}
            <span>AssistantAI</span>
          </Link>

          <h1 className="auth-form-title">{title}</h1>
          <p className="auth-form-subtitle">{subtitle}</p>

          <div className="auth-tabs" role="tablist">
            <Link
              to="/login"
              role="tab"
              aria-selected={activeTab === 'signin'}
              className={`auth-tab ${activeTab === 'signin' ? 'active' : ''}`}
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              role="tab"
              aria-selected={activeTab === 'signup'}
              className={`auth-tab ${activeTab === 'signup' ? 'active' : ''}`}
            >
              Sign up
            </Link>
          </div>

          {children}
        </div>
      </main>
    </div>
  )
}
