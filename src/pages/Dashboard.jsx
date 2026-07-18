import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useVoiceInput } from '../lib/speech.js'
import {
  fetchPlanByDate,
  generatePlan,
  buildTimeline,
  completeTask,
} from '../lib/api.js'
import { todayISODate, formatTimeRange, formatPlanDateLong } from '../lib/time.js'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [plan, setPlan] = useState(null)
  const [tasks, setTasks] = useState([])
  const [events, setEvents] = useState([])

  const { transcript, setTranscript, isListening, isSupported, start, stop } =
    useVoiceInput()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [usedVoice, setUsedVoice] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await fetchPlanByDate(todayISODate())
      if (result) {
        setPlan(result.plan)
        setTasks(result.tasks)
        setEvents(result.events)
      } else {
        setPlan(null)
        setTasks([])
        setEvents([])
      }
    } catch (err) {
      setLoadError(err.message || 'Could not load today’s plan.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleQuickSubmit(e) {
    e.preventDefault()
    if (!transcript.trim()) {
      setSubmitError('Say or type what you need to get done today first.')
      return
    }
    setSubmitError(null)
    setSubmitting(true)
    try {
      const result = await generatePlan({
        transcript: transcript.trim(),
        inputSource: usedVoice ? 'voice' : 'text',
        planDate: todayISODate(),
      })
      navigate(`/plan/${result.plan.id}`)
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong analyzing your day.')
      setSubmitting(false)
    }
  }

  function handleQuickMicClick() {
    if (isListening) {
      stop()
    } else {
      setUsedVoice(true)
      start()
    }
  }

  async function handleMarkComplete(taskId) {
    // Optimistic update so the checkbox feels instant.
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: 'completed' } : t)),
    )
    try {
      await completeTask(taskId)
    } catch (err) {
      setLoadError(err.message)
      load()
    }
  }

  const timeline = buildTimeline(tasks, events)
  const totalTasks = tasks.length
  const completedTasks = tasks.filter((t) => t.status === 'completed').length
  const progressPct = totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100)
  const upcomingTasks = tasks
    .filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
    .slice(0, 6)

  return (
    <div className="dashboard-page">
      <div className="mb-4">
        <h1 className="h3 mb-1">
          {greeting()}
          {user?.email ? `, ${user.email.split('@')[0]}` : ''}.
        </h1>
        <p className="text-secondary mb-0">{formatPlanDateLong(todayISODate())}</p>
      </div>

      {loadError && <div className="alert alert-danger py-2 small">{loadError}</div>}

      {loading ? (
        <div className="text-center py-5">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      ) : (
        <div className="row g-4">
          <div className="col-lg-7">
            <div className="dashboard-card mb-4">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h2 className="h6 mb-0">Today's Schedule</h2>
                {plan && (
                  <Link to={`/plan/${plan.id}`} className="btn btn-outline-primary btn-sm">
                    View & edit
                  </Link>
                )}
              </div>

              {!plan ? (
                <p className="text-secondary small mb-0">
                  No plan yet today. Use quick capture below, or go to{' '}
                  <Link to="/plan/new">Create Plan</Link> for the full workflow.
                </p>
              ) : timeline.length === 0 ? (
                <p className="text-secondary small mb-0">
                  Your plan was created but has no scheduled blocks yet.
                </p>
              ) : (
                <ul className="timeline-compact list-unstyled mb-0">
                  {timeline.map((block) => (
                    <li key={block.key} className="timeline-compact-row">
                      <span className="timeline-compact-time">
                        {formatTimeRange(block.start, block.end)}
                      </span>
                      <span
                        className={`timeline-compact-title ${block.status === 'completed' ? 'text-decoration-line-through text-muted' : ''}`}
                      >
                        {block.title}
                      </span>
                      <span className={`badge-kind badge-kind-${block.kind}`}>
                        {block.kind === 'event' ? 'fixed' : block.category}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="dashboard-card">
              <h2 className="h6 mb-3">Upcoming Tasks</h2>
              {upcomingTasks.length === 0 ? (
                <p className="text-secondary small mb-0">
                  {plan ? 'Nothing left to do — nice work.' : 'Plan your day to see tasks here.'}
                </p>
              ) : (
                <ul className="list-unstyled mb-0">
                  {upcomingTasks.map((task) => (
                    <li key={task.id} className="upcoming-task-row">
                      <button
                        type="button"
                        className="task-complete-btn"
                        onClick={() => handleMarkComplete(task.id)}
                        aria-label={`Mark ${task.title} complete`}
                        title="Mark complete"
                      />
                      <div className="flex-grow-1">
                        <div className="upcoming-task-title">{task.title}</div>
                        <div className="upcoming-task-meta text-secondary small">
                          {task.scheduled_start
                            ? formatTimeRange(task.scheduled_start, task.scheduled_end)
                            : 'Unscheduled'}
                        </div>
                      </div>
                      <span className={`priority-badge priority-${task.priority}`}>
                        {task.priority}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="col-lg-5">
            <div className="dashboard-card mb-4">
              <h2 className="h6 mb-3">Today's Progress</h2>
              <div className="progress mb-2" style={{ height: 10 }}>
                <div
                  className="progress-bar"
                  role="progressbar"
                  style={{ width: `${progressPct}%` }}
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <p className="text-secondary small mb-0">
                {totalTasks === 0
                  ? 'No tasks yet today.'
                  : `${completedTasks} of ${totalTasks} tasks done (${progressPct}%)`}
              </p>
            </div>

            <div className="dashboard-card">
              <h2 className="h6 mb-1">{plan ? 'Re-plan today' : 'Quick capture'}</h2>
              <p className="text-secondary small mb-3">
                {plan
                  ? 'Speaking or typing again replaces today’s schedule with a fresh one.'
                  : 'Speak or type what you need to do today.'}
              </p>

              <div className="text-center mb-3">
                <button
                  type="button"
                  onClick={handleQuickMicClick}
                  className={`mic-button mic-button-sm ${isListening ? 'listening' : ''}`}
                  aria-pressed={isListening}
                  aria-label={isListening ? 'Stop recording' : 'Start recording'}
                >
                  <MicIcon />
                </button>
                <p className="mic-status small mt-2 mb-0">
                  {isListening
                    ? 'Listening... tap to stop'
                    : isSupported
                      ? 'Tap to speak'
                      : 'Voice not supported here'}
                </p>
              </div>

              <form onSubmit={handleQuickSubmit}>
                <textarea
                  className="form-control mb-2"
                  rows={3}
                  placeholder="I have class from 9 to 11, gym before work..."
                  value={transcript}
                  onChange={(e) => {
                    setUsedVoice(false)
                    setTranscript(e.target.value)
                  }}
                />
                {submitError && (
                  <div className="alert alert-danger py-2 small">{submitError}</div>
                )}
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={submitting}
                >
                  {submitting ? 'Analyzing your day...' : 'Generate schedule'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
