import { useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../assets/logo.jpeg'
import landingImage from '../assets/landing.png'

// Split-screen auth wrapper used by Login and Signup.
//
//   LEFT panel (65% desktop, hidden on mobile):
//     brand mark + landing photo + footer. No copy overlay — the motto
//     and description live on the right so they read cleanly against a
//     plain surface instead of competing with the photo.
//
//   RIGHT panel (35% desktop, 100% mobile):
//     Two stacked "slides" inside .auth-panel-stage:
//       1. auth-intro  — motto + description + pulsing down-arrow.
//          This is the default view on a fresh visit.
//       2. auth-form   — title/subtitle + pill tab toggle + {children}
//          (the email/password form, owned by the page).
//     Clicking the arrow swipes the intro up and away, then reveals the
//     form. sessionStorage remembers the reveal for this tab so bouncing
//     between Sign in / Sign up doesn't replay the intro every time.
//
// AuthLayout never touches form state — each page owns its own inputs.

const REVEAL_KEY = 'assistantai_auth_revealed'
const SWIPE_MS = 380

function getInitialPhase() {
  if (typeof window === 'undefined') return 'intro'
  return window.sessionStorage.getItem(REVEAL_KEY) === 'true' ? 'form' : 'intro'
}

export default function AuthLayout({ activeTab, title, subtitle, children }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const [phase, setPhase] = useState(getInitialPhase)

  function handleReveal() {
    if (phase !== 'intro') return
    window.sessionStorage.setItem(REVEAL_KEY, 'true')
    setPhase('leaving')
    window.setTimeout(() => setPhase('form'), SWIPE_MS)
  }

  const logoMark = logoFailed ? (
    <span className="brand-mark brand-mark-letter">A</span>
  ) : (
    <img
      src={logo}
      alt="AssistantAI"
      className="brand-mark brand-mark-img"
      onError={() => setLogoFailed(true)}
    />
  )

  return (
    <div className="auth-split">
      <aside
        className="auth-image-panel"
        style={{ backgroundImage: `url(${landingImage})` }}
        aria-hidden="true"
      >
        <div className="auth-image-overlay" />
        <div className="auth-image-content">
          <div className="auth-image-brand">
            {logoMark}
            <span>AssistantAI</span>
          </div>
          <div className="auth-image-footer">© 2026 AssistantAI</div>
        </div>
      </aside>

      <main className="auth-form-panel">
        <div className="auth-panel-stage">
          {phase !== 'form' && (
            <div
              className={`auth-intro ${phase === 'leaving' ? 'auth-intro-leaving' : ''}`}
            >
              <h2 className="auth-intro-title">Plan less, do more.</h2>
              <p className="auth-intro-description">
                Speak your mind and AssistantAI extracts every task and fixed
                event, resolves conflicts, and builds an optimized schedule.
              </p>
              <button
                type="button"
                className="auth-reveal-btn"
                onClick={handleReveal}
                aria-label="Continue to sign in"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          )}

          {phase === 'form' && (
            <div className="auth-form-inner auth-form-inner-enter">
              <Link to="/" className="auth-form-brand">
                {logoMark}
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
          )}
        </div>
      </main>
    </div>
  )
}
