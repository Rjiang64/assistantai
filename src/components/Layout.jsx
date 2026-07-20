import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import logo from '../assets/logo.jpeg'

export default function Layout() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [logoOk, setLogoOk] = useState(true)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="app-shell">
      <nav className="app-navbar navbar">
        <div className="container d-flex align-items-center">
          <Link to="/" className="navbar-brand d-flex align-items-center gap-2 mb-0">
            {logoOk ? (
              <img
                src={logo}
                alt="AssistantAI"
                className="brand-mark brand-mark-img"
                onError={() => setLogoOk(false)}
              />
            ) : (
              <span className="brand-mark brand-mark-letter">A</span>
            )}
            <span className="brand-name">AssistantAI</span>
          </Link>
          <div className="d-flex align-items-center gap-3 ms-auto">
            <NavLink
              to="/calendar"
              className={({ isActive }) => `nav-link-app ${isActive ? 'active' : ''}`}
            >
              Calendar
            </NavLink>
            <NavLink to="/plan/new" className="btn btn-primary btn-sm">
              + New Plan
            </NavLink>
            <div className="user-menu d-flex align-items-center gap-3">
              <span className="user-email">{user?.email}</span>
              <button
                onClick={handleSignOut}
                className="btn btn-outline-danger btn-sm"
                type="button"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main className="container py-4">
        <Outlet />
      </main>
      <footer className="app-footer">AssistantAI — hire your day an assistant.</footer>
    </div>
  )
}
