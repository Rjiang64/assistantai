// Small time helpers shared by the frontend. All schedule blocks are stored
// as real timestamptz values in Postgres, so the frontend just needs to
// format them for display and diff them for duration math.
//
// IMPORTANT — timezone convention for this MVP:
// The AI pipeline (api/plan.js) writes wall-clock times the user spoke
// (e.g. "9:00 AM") into timestamptz columns using a UTC-labeled ISO string
// (e.g. "2026-07-17T09:00:00.000Z"), NOT the user's real UTC offset. This
// sidesteps needing real per-user timezone handling for a single-day MVP —
// profiles.timezone is reserved for that future work. The frontend must
// always format these timestamps using { timeZone: 'UTC' } so the literal
// time is shown regardless of the viewer's system clock. Do not swap these
// helpers for plain toLocaleTimeString() without also fixing api/plan.js.

export function todayISODate() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function formatTime(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
}

export function formatTimeRange(startISO, endISO) {
  return `${formatTime(startISO)} – ${formatTime(endISO)}`
}

export function formatDurationMinutes(minutes) {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function minutesBetween(startISO, endISO) {
  return Math.round((new Date(endISO) - new Date(startISO)) / 60000)
}

export function formatPlanDateLong(planDate) {
  // planDate is a Postgres date string, e.g. "2026-07-17". Parse as local
  // (not UTC) so it doesn't shift a day depending on timezone.
  const [y, m, d] = planDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * Combine a plan date ("2026-07-17") and a 24h "HH:MM" time-of-day string
 * into the UTC-labeled ISO timestamp convention described above (matches
 * what api/plan.js writes). Pure string construction — no Date object
 * timezone conversion — so it's consistent everywhere in the app.
 */
export function combineDateAndTime(planDate, hhmm) {
  const [h, min] = hhmm.split(':').map(Number)
  const hh = String(h).padStart(2, '0')
  const mm = String(min).padStart(2, '0')
  return `${planDate}T${hh}:${mm}:00.000Z`
}

export function sortByStart(items, startKey = 'scheduled_start') {
  return [...items].sort((a, b) => new Date(a[startKey]) - new Date(b[startKey]))
}

/**
 * "Now", represented using the same UTC-labeled-wall-clock convention as
 * every stored timestamp (see the note at the top of this file). Comparing
 * this against scheduled_start/scheduled_end lets the UI compute
 * current/upcoming/missed states without a real per-user timezone.
 */
export function nowForScheduleComparison() {
  const d = new Date()
  return new Date(
    Date.UTC(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds(),
      d.getMilliseconds(),
    ),
  )
}

