import { useState } from 'react'

const TASK_CATEGORIES = ['work', 'study', 'health', 'errand', 'personal', 'chore', 'social', 'other']
const EVENT_TYPES = ['class', 'work', 'appointment', 'personal', 'other']
const PRIORITIES = ['high', 'medium', 'low']

// Extract "HH:MM" from our UTC-labeled ISO convention (see src/lib/time.js).
function toHHMM(isoString) {
  if (!isoString) return ''
  return isoString.slice(11, 16)
}

// A lightweight, dependency-free modal (no Bootstrap JS bundle required —
// just Bootstrap's modal CSS classes, shown/hidden by React state).
export default function BlockEditModal({ kind, block, onSave, onDelete, onClose }) {
  const isTask = kind === 'task'
  const [title, setTitle] = useState(block.title)
  const [description, setDescription] = useState(block.description ?? '')
  const [category, setCategory] = useState(block.category ?? (isTask ? 'personal' : 'other'))
  const [priority, setPriority] = useState(block.priority ?? 'medium')
  const [durationMinutes, setDurationMinutes] = useState(block.duration_minutes ?? 30)
  const [startTime, setStartTime] = useState(toHHMM(isTask ? block.scheduled_start : block.start_time))
  const [endTime, setEndTime] = useState(toHHMM(isTask ? block.scheduled_end : block.end_time))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) {
      setError('Title is required.')
      return
    }
    if (!startTime || !endTime || startTime >= endTime) {
      setError('End time must be after start time.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      if (isTask) {
        await onSave({
          title: title.trim(),
          description: description.trim() || null,
          category,
          priority,
          duration_minutes: Number(durationMinutes),
          startTime,
          endTime,
        })
      } else {
        await onSave({
          title: title.trim(),
          event_type: category,
          startTime,
          endTime,
        })
      }
    } catch (err) {
      setError(err.message || 'Could not save changes.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop-custom" role="dialog" aria-modal="true">
      <div className="modal-dialog-custom">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{isTask ? 'Edit task' : 'Edit event'}</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label">Title</label>
                <input
                  type="text"
                  className="form-control"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              {isTask && (
                <div className="mb-3">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              )}

              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label">Start</label>
                  <input
                    type="time"
                    className="form-control"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                  />
                </div>
                <div className="col-6">
                  <label className="form-label">End</label>
                  <input
                    type="time"
                    className="form-control"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label">{isTask ? 'Category' : 'Type'}</label>
                  <select
                    className="form-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {(isTask ? TASK_CATEGORIES : EVENT_TYPES).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                {isTask && (
                  <div className="col-6">
                    <label className="form-label">Priority</label>
                    <select
                      className="form-select"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {isTask && (
                <div className="mb-1">
                  <label className="form-label">Duration (minutes)</label>
                  <input
                    type="number"
                    min={5}
                    step={5}
                    className="form-control"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                  />
                </div>
              )}

              {error && <div className="alert alert-danger py-2 small mt-2 mb-0">{error}</div>}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline-danger me-auto"
                onClick={onDelete}
                disabled={saving}
              >
                Delete
              </button>
              <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
