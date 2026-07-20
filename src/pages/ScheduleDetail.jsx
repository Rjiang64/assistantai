import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchPlanById,
  buildTimeline,
  updateTask,
  deleteTask,
  completeTask,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../lib/api.js'
import {
  formatTimeRange,
  formatDurationMinutes,
  formatPlanDateLong,
  combineDateAndTime,
  nowForScheduleComparison,
} from '../lib/time.js'
import BlockEditModal from '../components/BlockEditModal.jsx'

export default function ScheduleDetail() {
  const { planId } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null)
  const [tasks, setTasks] = useState([])
  const [events, setEvents] = useState([])
  const [editingBlock, setEditingBlock] = useState(null) // { kind, block }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchPlanById(planId)
      if (!result) {
        setError('Plan not found.')
        return
      }
      setPlan(result.plan)
      setTasks(result.tasks)
      setEvents(result.events)
    } catch (err) {
      setError(err.message || 'Could not load this plan.')
    } finally {
      setLoading(false)
    }
  }, [planId])

  useEffect(() => {
    load()
  }, [load])

  const timeline = buildTimeline(tasks, events)

  function openEdit(block) {
    setEditingBlock({ kind: block.kind, block: block.raw })
  }

  async function handleSave(patch) {
    if (!editingBlock) return
    const { kind, block } = editingBlock
    if (kind === 'task') {
      const scheduled_start = combineDateAndTime(plan.plan_date, patch.startTime)
      const scheduled_end = combineDateAndTime(plan.plan_date, patch.endTime)
      const updated = await updateTask(block.id, {
        title: patch.title,
        description: patch.description,
        category: patch.category,
        priority: patch.priority,
        duration_minutes: patch.duration_minutes,
        scheduled_start,
        scheduled_end,
      })
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
    } else {
      const start_time = combineDateAndTime(plan.plan_date, patch.startTime)
      const end_time = combineDateAndTime(plan.plan_date, patch.endTime)
      const updated = await updateCalendarEvent(block.id, {
        title: patch.title,
        event_type: patch.event_type,
        start_time,
        end_time,
      })
      setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
    }
    setEditingBlock(null)
  }

  async function handleDelete() {
    if (!editingBlock) return
    const { kind, block } = editingBlock
    if (!window.confirm(`Delete "${block.title}"?`)) return
    if (kind === 'task') {
      await deleteTask(block.id)
      setTasks((prev) => prev.filter((t) => t.id !== block.id))
    } else {
      await deleteCalendarEvent(block.id)
      setEvents((prev) => prev.filter((e) => e.id !== block.id))
    }
    setEditingBlock(null)
  }

  async function handleToggleComplete(task) {
    const nextStatus = task.status === 'completed' ? 'scheduled' : 'completed'
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
    try {
      if (nextStatus === 'completed') {
        await completeTask(task.id)
      } else {
        await updateTask(task.id, { status: 'scheduled' })
      }
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    )
  }

  if (error && !plan) {
    return (
      <div className="alert alert-danger">
        {error} <Link to="/">Back to dashboard</Link>
      </div>
    )
  }

  return (
    <div className="schedule-detail-page">
      <div className="mb-4">
        <Link to="/" className="small text-secondary d-inline-block mb-2">
          &larr; Back to dashboard
        </Link>
        <h1 className="h3 mb-1">Schedule for {formatPlanDateLong(plan.plan_date)}</h1>
        <p className="text-secondary mb-0 text-capitalize">Status: {plan.status}</p>
      </div>

      {error && <div className="alert alert-danger py-2 small">{error}</div>}

      {plan.explanation && (
        <div className="explanation-card mb-3">
          <h2 className="h6 mb-2">Why this schedule</h2>
          <p className="mb-0">{plan.explanation}</p>
        </div>
      )}

      {Array.isArray(plan.conflicts) && plan.conflicts.length > 0 && (
        <div className="alert alert-warning small">
          <strong>Heads up:</strong>
          <ul className="mb-0 mt-1">
            {plan.conflicts.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="timeline-card">
        {timeline.length === 0 ? (
          <p className="text-secondary small mb-0">No blocks scheduled yet.</p>
        ) : (
          <ul className="timeline-list list-unstyled mb-0">
            {timeline.map((block) => {
              const now = nowForScheduleComparison()
              const start = new Date(block.start)
              const end = new Date(block.end)
              const isCompleted = block.status === 'completed'
              const isSelected = editingBlock?.kind === block.kind && editingBlock?.block?.id === block.id
              const isCurrent = !isCompleted && now >= start && now < end
              const isMissed = !isCompleted && block.kind === 'task' && now >= end

              const stateClass = isSelected
                ? 'timeline-row-selected'
                : isCompleted
                  ? 'timeline-row-completed'
                  : isMissed
                    ? 'timeline-row-missed'
                    : isCurrent
                      ? 'timeline-row-current'
                      : ''

              return (
              <li
                key={block.key}
                className={`timeline-row timeline-row-${block.kind} ${stateClass} ${isCompleted ? 'timeline-row-done' : ''}`}
              >
                <div className="timeline-row-time">{formatTimeRange(block.start, block.end)}</div>
                <div className="timeline-row-body">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span
                      className={`timeline-row-title ${block.status === 'completed' ? 'text-decoration-line-through text-muted' : ''}`}
                    >
                      {block.title}
                    </span>
                    <span className={`badge-kind badge-kind-${block.kind}`}>{block.category}</span>
                    {block.priority && (
                      <span className={`priority-badge priority-${block.priority}`}>{block.priority}</span>
                    )}
                  </div>
                  <div className="text-secondary small">
                    {formatDurationMinutes(
                      Math.round((new Date(block.end) - new Date(block.start)) / 60000),
                    )}
                  </div>
                </div>
                <div className="timeline-row-actions">
                  {block.kind === 'task' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => handleToggleComplete(block.raw)}
                    >
                      {block.status === 'completed' ? 'Reopen' : 'Complete'}
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => openEdit(block)}>
                    Edit
                  </button>
                </div>
              </li>
              )
            })}
          </ul>
        )}
      </div>

      {editingBlock && (
        <BlockEditModal
          kind={editingBlock.kind}
          block={editingBlock.block}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditingBlock(null)}
        />
      )}
    </div>
  )
}
