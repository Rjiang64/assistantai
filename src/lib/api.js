import { supabase } from './supabase.js'

// ---------------------------------------------------------------------------
// AI pipeline — POST /api/plan
// ---------------------------------------------------------------------------

/**
 * Sends a raw brain-dump transcript to the AI pipeline. The serverless
 * function extracts tasks + fixed events, builds an optimized schedule,
 * writes everything to daily_plans/tasks/calendar_events/ai_sessions, and
 * returns the fully assembled plan so the UI can render it immediately.
 */
export async function generatePlan({ transcript, inputSource, planDate }) {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  if (!token) {
    throw new Error('You are not signed in.')
  }

  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ transcript, inputSource, planDate }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(body.error || `Plan generation failed (${res.status})`)
    err.status = res.status
    err.body = body
    throw err
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function fetchPlanByDate(planDate) {
  const { data: plan, error } = await supabase
    .from('daily_plans')
    .select('*')
    .eq('plan_date', planDate)
    .maybeSingle()

  if (error) throw error
  if (!plan) return null

  const [{ data: tasks, error: tErr }, { data: events, error: eErr }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('daily_plan_id', plan.id)
      .order('scheduled_start', { ascending: true }),
    supabase
      .from('calendar_events')
      .select('*')
      .eq('daily_plan_id', plan.id)
      .order('start_time', { ascending: true }),
  ])
  if (tErr) throw tErr
  if (eErr) throw eErr

  return { plan, tasks: tasks ?? [], events: events ?? [] }
}

export async function fetchPlanById(planId) {
  const { data: plan, error } = await supabase
    .from('daily_plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle()
  if (error) throw error
  if (!plan) return null

  const [{ data: tasks, error: tErr }, { data: events, error: eErr }] = await Promise.all([
    supabase
      .from('tasks')
      .select('*')
      .eq('daily_plan_id', plan.id)
      .order('scheduled_start', { ascending: true }),
    supabase
      .from('calendar_events')
      .select('*')
      .eq('daily_plan_id', plan.id)
      .order('start_time', { ascending: true }),
  ])
  if (tErr) throw tErr
  if (eErr) throw eErr

  return { plan, tasks: tasks ?? [], events: events ?? [] }
}

export async function fetchRecentPlans(limit = 7) {
  const { data, error } = await supabase
    .from('daily_plans')
    .select('*')
    .order('plan_date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------------------
// Merge tasks + calendar events into one sorted timeline for rendering.
// ---------------------------------------------------------------------------

export function buildTimeline(tasks, events) {
  const taskBlocks = tasks
    .filter((t) => t.scheduled_start && t.scheduled_end)
    .map((t) => ({
      key: `task-${t.id}`,
      kind: 'task',
      id: t.id,
      title: t.title,
      start: t.scheduled_start,
      end: t.scheduled_end,
      category: t.category,
      priority: t.priority,
      status: t.status,
      raw: t,
    }))

  const eventBlocks = events.map((e) => ({
    key: `event-${e.id}`,
    kind: 'event',
    id: e.id,
    title: e.title,
    start: e.start_time,
    end: e.end_time,
    category: e.event_type,
    priority: null,
    status: 'fixed',
    raw: e,
  }))

  return [...taskBlocks, ...eventBlocks].sort(
    (a, b) => new Date(a.start) - new Date(b.start),
  )
}

// ---------------------------------------------------------------------------
// Task CRUD (edit / delete / complete / reschedule)
// ---------------------------------------------------------------------------

export async function updateTask(taskId, patch) {
  const { data, error } = await supabase
    .from('tasks')
    .update(patch)
    .eq('id', taskId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId)
  if (error) throw error
}

export async function completeTask(taskId) {
  return updateTask(taskId, { status: 'completed' })
}

export async function rescheduleTask(taskId, scheduledStart, scheduledEnd) {
  return updateTask(taskId, {
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    status: 'scheduled',
  })
}

// ---------------------------------------------------------------------------
// Calendar event CRUD (fixed blocks — class, work, appointments)
// ---------------------------------------------------------------------------

export async function updateCalendarEvent(eventId, patch) {
  const { data, error } = await supabase
    .from('calendar_events')
    .update(patch)
    .eq('id', eventId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteCalendarEvent(eventId) {
  const { error } = await supabase.from('calendar_events').delete().eq('id', eventId)
  if (error) throw error
}
