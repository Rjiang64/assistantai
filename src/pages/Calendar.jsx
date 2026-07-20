import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchPlansInRange, fetchTaskCountsForPlans } from '../lib/api.js'
import { todayISODate } from '../lib/time.js'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toISODate(date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Builds the full set of grid cells for a month view: every day in the
 * month, plus the leading/trailing days from adjacent months needed to
 * complete full weeks (Sun-Sat), so the grid is always a clean rectangle.
 */
function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(year, month, 1)
  const startOffset = firstOfMonth.getDay() // 0 = Sunday
  const gridStart = new Date(year, month, 1 - startOffset)

  const cells = []
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + i)
    cells.push(date)
  }
  return cells
}

export default function CalendarPage() {
  const navigate = useNavigate()
  const today = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [plansByDate, setPlansByDate] = useState({})

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])
  const monthLabel = useMemo(
    () => new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    [viewYear, viewMonth],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rangeStart = toISODate(grid[0])
      const rangeEnd = toISODate(grid[grid.length - 1])
      const plans = await fetchPlansInRange(rangeStart, rangeEnd)
      const counts = await fetchTaskCountsForPlans(plans.map((p) => p.id))

      const map = {}
      for (const plan of plans) {
        map[plan.plan_date] = {
          plan,
          counts: counts[plan.id] || { total: 0, completed: 0 },
        }
      }
      setPlansByDate(map)
    } catch (err) {
      setError(err.message || 'Could not load your calendar.')
    } finally {
      setLoading(false)
    }
  }, [grid])

  useEffect(() => {
    load()
  }, [load])

  function goToPrevMonth() {
    const d = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  function goToNextMonth() {
    const d = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  function goToToday() {
    setViewYear(today.getFullYear())
    setViewMonth(today.getMonth())
  }

  function handleDayClick(entry) {
    if (entry) navigate(`/plan/${entry.plan.id}`)
  }

  const todayISO = todayISODate()

  return (
    <div className="calendar-page">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
        <div>
          <h1 className="h3 mb-1">Calendar</h1>
          <p className="text-secondary mb-0">Browse past and current daily plans.</p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={goToPrevMonth} aria-label="Previous month">
            &larr;
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={goToToday}>
            Today
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={goToNextMonth} aria-label="Next month">
            &rarr;
          </button>
        </div>
      </div>

      <div className="calendar-card">
        <h2 className="h5 mb-3">{monthLabel}</h2>

        {error && <div className="alert alert-danger py-2 small">{error}</div>}

        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : (
          <div className="calendar-grid">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="calendar-weekday">
                {label}
              </div>
            ))}

            {grid.map((date) => {
              const iso = toISODate(date)
              const isCurrentMonth = date.getMonth() === viewMonth
              const isToday = iso === todayISO
              const entry = plansByDate[iso]
              const hasPlan = Boolean(entry)

              const classes = [
                'calendar-day',
                !isCurrentMonth ? 'calendar-day-outside' : '',
                isToday ? 'calendar-day-today' : '',
                hasPlan ? 'calendar-day-has-plan' : '',
              ]
                .filter(Boolean)
                .join(' ')

              return (
                <button
                  key={iso}
                  type="button"
                  className={classes}
                  onClick={() => handleDayClick(entry)}
                  disabled={!hasPlan}
                >
                  <span className="calendar-day-number">{date.getDate()}</span>
                  {hasPlan && (
                    <span className="calendar-day-count">
                      {entry.counts.completed}/{entry.counts.total} done
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
