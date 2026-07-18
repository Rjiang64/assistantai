// Vercel serverless function — POST /api/plan
//
// This IS the executive-assistant AI pipeline:
//   1. Receive a raw brain-dump transcript.
//   2. Extract fixed events + flexible tasks (duration, priority, deadline,
//      dependencies) from the transcript.
//   3. Generate an optimized, conflict-free daily schedule.
//   4. Generate a short explanation of the scheduling reasoning.
//
// Claude does all four steps in a single forced tool call so the model
// reasons about extraction and scheduling together (it needs the full
// picture of tasks + fixed events to schedule well) while still returning
// one atomic, schema-validated JSON object — never free-form/markdown text.
//
// ANTHROPIC_API_KEY is read here on the server only. It is never sent to
// the browser; the frontend only ever sees the parsed, persisted plan.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const MAX_TRANSCRIPT_CHARS = 8_000
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const TASK_CATEGORIES = ['work', 'study', 'health', 'errand', 'personal', 'chore', 'social', 'other']
const EVENT_TYPES = ['class', 'work', 'appointment', 'personal', 'other']
const PRIORITIES = ['high', 'medium', 'low']

// ---------------------------------------------------------------------------
// Tool schema — Claude is forced to call this tool with a structured payload.
// The Anthropic API validates input against input_schema before it reaches
// us; validatePlan() below re-checks structurally as a safety net before we
// ever write to Postgres.
// ---------------------------------------------------------------------------
const PLAN_TOOL = {
  name: 'submit_daily_plan',
  description:
    'Submit the complete extracted tasks/events and the optimized daily schedule with an explanation.',
  input_schema: {
    type: 'object',
    required: ['fixed_events', 'tasks', 'schedule', 'explanation', 'conflicts'],
    properties: {
      fixed_events: {
        type: 'array',
        description: 'Hard-scheduled items with a fixed start/end the user mentioned (class, work shift, appointment).',
        items: {
          type: 'object',
          required: ['title', 'start_time', 'end_time', 'event_type'],
          properties: {
            title: { type: 'string' },
            start_time: { type: 'string', description: '24-hour "HH:MM", e.g. "09:00"' },
            end_time: { type: 'string', description: '24-hour "HH:MM", e.g. "11:00"' },
            event_type: { type: 'string', enum: EVENT_TYPES },
          },
        },
      },
      tasks: {
        type: 'array',
        description: 'Flexible to-dos that can be moved around the fixed events.',
        items: {
          type: 'object',
          required: ['temp_id', 'title', 'duration_minutes', 'priority', 'category'],
          properties: {
            temp_id: { type: 'string', description: 'Short local id, e.g. "T1", "T2".' },
            title: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string', enum: TASK_CATEGORIES },
            duration_minutes: {
              type: 'integer',
              description: 'Estimate a reasonable duration if the user did not give one.',
            },
            priority: {
              type: 'string',
              enum: PRIORITIES,
              description: 'high = time-sensitive or important; low = nice-to-have/errand.',
            },
            deadline: {
              type: ['string', 'null'],
              description: '24-hour "HH:MM" the task must be done by, if the user implied one, else null.',
            },
            depends_on_temp_id: {
              type: ['string', 'null'],
              description: 'temp_id of another task that must finish first, if any, else null.',
            },
          },
        },
      },
      schedule: {
        type: 'array',
        description: 'The final ordered, conflict-free timeline for the whole day, covering every fixed_event and every task.',
        items: {
          type: 'object',
          required: ['start_time', 'end_time', 'title', 'block_type'],
          properties: {
            start_time: { type: 'string', description: '24-hour "HH:MM"' },
            end_time: { type: 'string', description: '24-hour "HH:MM"' },
            title: { type: 'string' },
            block_type: { type: 'string', enum: ['fixed', 'task', 'break'] },
            ref_task_temp_id: {
              type: ['string', 'null'],
              description: 'Set when block_type is "task" — the matching tasks[].temp_id.',
            },
            ref_event_title: {
              type: ['string', 'null'],
              description: 'Set when block_type is "fixed" — the matching fixed_events[].title.',
            },
          },
        },
      },
      explanation: {
        type: 'string',
        description:
          '2-5 sentences in the voice of an executive assistant explaining the scheduling reasoning: why things were ordered this way, priority trade-offs, and how conflicts (if any) were handled.',
      },
      conflicts: {
        type: 'array',
        description: 'Plain-language warnings about anything that could not be perfectly resolved (not enough time, overlapping constraints, etc). Empty array if none.',
        items: { type: 'string' },
      },
    },
  },
}

const SYSTEM_PROMPT = `You are an executive assistant who takes a person's messy spoken-out-loud brain dump about their day and turns it into a single optimized schedule. You are not a chatbot — you never write conversational prose outside the tool call, and you never ask the user follow-up questions. You make sensible, professional judgment calls the way a competent human assistant would.

Work in this order:
1. Extract every FIXED EVENT (hard start/end time explicitly mentioned: class, work shift, appointment).
2. Extract every FLEXIBLE TASK (something to accomplish with no hard time attached). Estimate a reasonable duration_minutes if the user didn't give one (e.g. "call my mom" ~15m, "groceries" ~45m, "study Python for an hour" = 60m explicitly given). Assign a priority: high for anything with a deadline, explicit importance, or that requires uninterrupted focus (assignments, exams); medium for regular commitments (study, exercise); low for errands/chores/calls. Capture dependencies only when the user implies strict ordering (e.g. "before work").
3. Build ONE optimized, non-overlapping schedule for the whole day that:
   - Never overlaps a fixed event.
   - Schedules higher-priority / deadline-bound tasks earlier and protects focus time for them (not squeezed into tiny gaps).
   - Respects dependencies and "before X" / "after X" language (e.g. "gym before work" means the gym block's end_time must be <= that fixed event's start_time).
   - Fills reasonable gaps between fixed events with tasks; if tasks don't fit anywhere, still include them at the most sensible time and note the problem in conflicts instead of silently dropping them.
   - Adds short "break" blocks (block_type "break") for meals when there's a natural gap (e.g. lunch), but don't invent excessive breaks.
   - Covers the day from the earliest relevant time (default to 07:00 if nothing earlier is implied) through the last activity — do not schedule anything before 06:00 or after 24:00.
   - Every block's end_time must be strictly after its start_time, and blocks must not overlap each other.
4. Write a short explanation (as an assistant would say it to their boss) of the key scheduling decisions and trade-offs.
5. List any conflicts or things you couldn't fully resolve (e.g. "Not enough time between class and work to fit the full 2-hour assignment and the gym — I shortened the buffer.").

Rules:
- All times are 24-hour "HH:MM" strings, no dates, no AM/PM.
- Every fixed_events entry must appear as exactly one "fixed" block in schedule with a matching ref_event_title.
- Every tasks entry must appear as exactly one "task" block in schedule with a matching ref_task_temp_id, unless it is truly impossible to fit anywhere — in that case still add it as a best-effort block and explain why in conflicts.
- Do not invent tasks or events the user didn't mention or clearly imply.
- Call the submit_daily_plan tool exactly once with the complete package. Do not respond with any other text.`

function buildUserMessage(transcript, planDate) {
  return `Today's date: ${planDate}

Raw brain dump (transcribed from speech or typed by the user):
"""
${transcript}
"""

Produce the complete extraction and optimized schedule by calling the submit_daily_plan tool.`
}

// ---------------------------------------------------------------------------
// Structural validation of Claude's tool_use input.
// ---------------------------------------------------------------------------
function validatePlan(obj) {
  const errors = []
  if (!obj || typeof obj !== 'object') return ['Output is not an object']

  if (!Array.isArray(obj.fixed_events)) errors.push('fixed_events must be an array')
  if (!Array.isArray(obj.tasks)) errors.push('tasks must be an array')
  if (!Array.isArray(obj.schedule)) errors.push('schedule must be an array')
  if (!Array.isArray(obj.conflicts)) errors.push('conflicts must be an array')
  if (typeof obj.explanation !== 'string' || obj.explanation.trim().length === 0) {
    errors.push('explanation must be a non-empty string')
  }
  if (errors.length > 0) return errors

  obj.fixed_events.forEach((e, i) => {
    if (!e || typeof e.title !== 'string' || !e.title.trim()) errors.push(`fixed_events[${i}].title is required`)
    if (!TIME_RE.test(e?.start_time)) errors.push(`fixed_events[${i}].start_time must be HH:MM`)
    if (!TIME_RE.test(e?.end_time)) errors.push(`fixed_events[${i}].end_time must be HH:MM`)
    if (e && e.start_time && e.end_time && e.start_time >= e.end_time) {
      errors.push(`fixed_events[${i}] end_time must be after start_time`)
    }
    if (!EVENT_TYPES.includes(e?.event_type)) errors.push(`fixed_events[${i}].event_type invalid`)
  })

  const taskIds = new Set()
  obj.tasks.forEach((t, i) => {
    if (!t || typeof t.title !== 'string' || !t.title.trim()) errors.push(`tasks[${i}].title is required`)
    if (!t?.temp_id) errors.push(`tasks[${i}].temp_id is required`)
    else taskIds.add(t.temp_id)
    if (!Number.isInteger(t?.duration_minutes) || t.duration_minutes <= 0) {
      errors.push(`tasks[${i}].duration_minutes must be a positive integer`)
    }
    if (!PRIORITIES.includes(t?.priority)) errors.push(`tasks[${i}].priority invalid`)
    if (!TASK_CATEGORIES.includes(t?.category)) errors.push(`tasks[${i}].category invalid`)
    if (t?.deadline && !TIME_RE.test(t.deadline)) errors.push(`tasks[${i}].deadline must be HH:MM or null`)
  })

  obj.schedule.forEach((b, i) => {
    if (!TIME_RE.test(b?.start_time)) errors.push(`schedule[${i}].start_time must be HH:MM`)
    if (!TIME_RE.test(b?.end_time)) errors.push(`schedule[${i}].end_time must be HH:MM`)
    if (b && b.start_time && b.end_time && b.start_time >= b.end_time) {
      errors.push(`schedule[${i}] end_time must be after start_time`)
    }
    if (!['fixed', 'task', 'break'].includes(b?.block_type)) errors.push(`schedule[${i}].block_type invalid`)
    if (!b?.title || typeof b.title !== 'string') errors.push(`schedule[${i}].title is required`)
  })

  return errors
}

// Deterministic overlap check across the final schedule — a safety net on
// top of the model's own reasoning, since an LLM can still misplace a block.
function detectOverlaps(schedule) {
  const sorted = [...schedule].sort((a, b) => a.start_time.localeCompare(b.start_time))
  const warnings = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (cur.start_time < prev.end_time) {
      warnings.push(`Schedule conflict: "${prev.title}" (${prev.start_time}-${prev.end_time}) overlaps "${cur.title}" (${cur.start_time}-${cur.end_time}).`)
    }
  }
  return warnings
}

function hhmmToISO(planDate, hhmm) {
  return `${planDate}T${hhmm}:00.000Z`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ---- Auth: extract and verify the Supabase JWT ----
  const authHeader = req.headers.authorization || ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header.' })
  }
  const userToken = authHeader.slice(7)

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase env vars are not configured on the server.' })
  }

  // Scoped client: all subsequent queries are auth'd as the user, so RLS
  // enforces that they can only touch their own rows.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(userToken)
  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session.' })
  }

  // ---- Input validation ----
  const { transcript, inputSource, planDate } = req.body ?? {}
  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    return res.status(400).json({ error: 'transcript is required and must be a non-empty string' })
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return res.status(413).json({
      error: `transcript is too long (max ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters)`,
    })
  }
  const resolvedPlanDate =
    typeof planDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(planDate)
      ? planDate
      : new Date().toISOString().slice(0, 10)
  const resolvedInputSource = inputSource === 'voice' ? 'voice' : 'text'

  // ---- Anthropic call ----
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' })
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'
  const client = new Anthropic({ apiKey })

  const startedAt = Date.now()
  let aiPlan
  let rawResponse

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: 'submit_daily_plan' },
      messages: [{ role: 'user', content: buildUserMessage(transcript.trim(), resolvedPlanDate) }],
    })

    const toolUseBlock = response.content.find((b) => b.type === 'tool_use')
    if (!toolUseBlock) {
      await logAiSession(supabase, {
        userId: user.id,
        transcript,
        model,
        request: { transcript, planDate: resolvedPlanDate },
        response: response,
        status: 'error',
        errorMessage: 'No tool_use block returned',
        latencyMs: Date.now() - startedAt,
      })
      return res.status(422).json({
        error: 'The AI did not return a structured plan. Please try again with more detail.',
      })
    }

    aiPlan = toolUseBlock.input
    rawResponse = response
  } catch (err) {
    console.error('Anthropic API error:', err)
    await logAiSession(supabase, {
      userId: user.id,
      transcript,
      model,
      request: { transcript, planDate: resolvedPlanDate },
      response: null,
      status: 'error',
      errorMessage: err?.message || 'Anthropic API call failed',
      latencyMs: Date.now() - startedAt,
    })
    const status =
      err?.status && Number.isInteger(err.status) && err.status >= 400 && err.status < 600
        ? err.status
        : 502
    return res.status(status).json({ error: err?.message || 'Failed to call the AI provider.' })
  }

  // ---- Validate structurally before touching Postgres ----
  const validationErrors = validatePlan(aiPlan)
  if (validationErrors.length > 0) {
    await logAiSession(supabase, {
      userId: user.id,
      transcript,
      model,
      request: { transcript, planDate: resolvedPlanDate },
      response: rawResponse,
      status: 'error',
      errorMessage: `Validation failed: ${validationErrors.join('; ')}`,
      latencyMs: Date.now() - startedAt,
    })
    return res.status(422).json({
      error: 'AI output failed validation. Please try again.',
      details: validationErrors,
    })
  }

  const conflicts = [...aiPlan.conflicts, ...detectOverlaps(aiPlan.schedule)]

  // ---- Persist: upsert the daily_plans row, replace its child rows ----
  try {
    const { data: plan, error: planError } = await supabase
      .from('daily_plans')
      .upsert(
        {
          user_id: user.id,
          plan_date: resolvedPlanDate,
          status: 'active',
          input_source: resolvedInputSource,
          raw_transcript: transcript.trim(),
          explanation: aiPlan.explanation,
          conflicts,
          model,
        },
        { onConflict: 'user_id,plan_date' },
      )
      .select()
      .single()
    if (planError) throw planError

    // Regenerating a plan replaces its previous schedule entirely.
    await supabase.from('tasks').delete().eq('daily_plan_id', plan.id)
    await supabase.from('calendar_events').delete().eq('daily_plan_id', plan.id)

    // Map schedule blocks by ref so we can attach scheduled_start/end.
    const taskScheduleByTempId = new Map()
    const eventScheduleByTitle = new Map()
    for (const block of aiPlan.schedule) {
      if (block.block_type === 'task' && block.ref_task_temp_id) {
        taskScheduleByTempId.set(block.ref_task_temp_id, block)
      } else if (block.block_type === 'fixed' && block.ref_event_title) {
        eventScheduleByTitle.set(block.ref_event_title, block)
      }
    }

    let insertedEvents = []
    if (aiPlan.fixed_events.length > 0) {
      const eventRows = aiPlan.fixed_events.map((e) => {
        const block = eventScheduleByTitle.get(e.title)
        const start = block?.start_time ?? e.start_time
        const end = block?.end_time ?? e.end_time
        return {
          user_id: user.id,
          daily_plan_id: plan.id,
          title: e.title,
          event_type: e.event_type,
          start_time: hhmmToISO(resolvedPlanDate, start),
          end_time: hhmmToISO(resolvedPlanDate, end),
          is_fixed: true,
          external_provider: 'internal',
        }
      })
      const { data, error } = await supabase.from('calendar_events').insert(eventRows).select()
      if (error) throw error
      insertedEvents = data
    }

    // Two-pass insert for tasks: first without dependencies (temp_id ->
    // real uuid isn't known yet), then patch depends_on_task_id.
    let insertedTasks = []
    if (aiPlan.tasks.length > 0) {
      const taskRows = aiPlan.tasks.map((t, idx) => {
        const block = taskScheduleByTempId.get(t.temp_id)
        return {
          user_id: user.id,
          daily_plan_id: plan.id,
          title: t.title,
          description: t.description ?? null,
          category: t.category,
          priority: t.priority,
          duration_minutes: t.duration_minutes,
          deadline: t.deadline ? hhmmToISO(resolvedPlanDate, t.deadline) : null,
          status: 'scheduled',
          scheduled_start: block ? hhmmToISO(resolvedPlanDate, block.start_time) : null,
          scheduled_end: block ? hhmmToISO(resolvedPlanDate, block.end_time) : null,
          sort_order: idx,
          source: resolvedInputSource,
        }
      })
      const { data, error } = await supabase.from('tasks').insert(taskRows).select()
      if (error) throw error
      insertedTasks = data

      const tempIdToRealId = new Map(aiPlan.tasks.map((t, idx) => [t.temp_id, insertedTasks[idx]?.id]))
      const dependencyUpdates = aiPlan.tasks
        .map((t, idx) => ({ realId: insertedTasks[idx]?.id, dependsOnRealId: t.depends_on_temp_id ? tempIdToRealId.get(t.depends_on_temp_id) : null }))
        .filter((d) => d.realId && d.dependsOnRealId)

      for (const dep of dependencyUpdates) {
        await supabase.from('tasks').update({ depends_on_task_id: dep.dependsOnRealId }).eq('id', dep.realId)
        const row = insertedTasks.find((r) => r.id === dep.realId)
        if (row) row.depends_on_task_id = dep.dependsOnRealId
      }
    }

    await logAiSession(supabase, {
      userId: user.id,
      dailyPlanId: plan.id,
      transcript,
      model,
      request: { transcript, planDate: resolvedPlanDate },
      response: rawResponse,
      status: 'success',
      latencyMs: Date.now() - startedAt,
    })

    return res.status(200).json({
      plan,
      tasks: insertedTasks,
      events: insertedEvents,
      explanation: aiPlan.explanation,
      conflicts,
      model,
    })
  } catch (err) {
    console.error('Persist error:', err)
    return res.status(500).json({ error: err?.message || 'Failed to save the generated plan.' })
  }
}

async function logAiSession(supabase, { userId, dailyPlanId, transcript, model, request, response, status, errorMessage, latencyMs }) {
  try {
    await supabase.from('ai_sessions').insert({
      user_id: userId,
      daily_plan_id: dailyPlanId ?? null,
      transcript_raw: transcript,
      model,
      request_payload: request,
      response_payload: response ? JSON.parse(JSON.stringify(response)) : null,
      status,
      error_message: errorMessage ?? null,
      latency_ms: latencyMs ?? null,
    })
  } catch (logErr) {
    // Never let audit logging break the main request.
    console.error('Failed to write ai_sessions row:', logErr)
  }
}
