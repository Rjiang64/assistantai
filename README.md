# AssistantAI

An AI-powered personal executive assistant — not a chatbot. Speak (or type)
a messy brain dump of everything you need to do today, and AssistantAI
extracts every task and fixed event, estimates missing durations,
prioritizes, detects conflicts, and builds one optimized daily schedule with
a plain-language explanation of its reasoning.

```
"I have class from 9 to 11. I need to finish my SQL assignment which
should take about two hours. I have work from 3 until 11. I should go to
the gym before work. I need groceries. I should call my mom. I need to
study Python for an hour."
```

becomes a full, conflict-checked timeline — class, gym, the assignment,
groceries, study time, lunch, work — in one shot, with a note on why it was
ordered that way.

## Tech stack

- React + Vite, React Router
- Bootstrap 5 (+ plain CSS) — no Tailwind
- Supabase (Postgres + Auth + Row-Level Security)
- Vercel serverless functions
- Anthropic API (Claude), server-side only

## Architecture overview

```
Browser (React SPA)
  |
  |-- Supabase Auth (email/password) --> Supabase (Postgres, RLS)
  |
  |-- POST /api/plan (Bearer <user JWT>)
        |
        v
  Vercel serverless function (api/plan.js)
    1. Verify JWT against Supabase, scope a Supabase client to that user
    2. Call Claude with a forced tool call (submit_daily_plan) that:
         - extracts fixed events + flexible tasks
         - estimates missing durations, assigns priority
         - builds one non-overlapping optimized schedule
         - writes a short explanation + any conflicts
    3. Re-validate the structured output before writing anything
    4. Upsert daily_plans, replace its tasks + calendar_events,
       log the call to ai_sessions
    5. Return the full assembled plan to the browser
```

The frontend never talks to Anthropic directly and never sees the API key.
Every database table is protected by Postgres RLS policies scoped to
`auth.uid()`, so the anon key is safe to ship in the browser bundle.

## Folder structure

```
AssistantAI/
├── api/
│   └── plan.js                 # The AI pipeline (Vercel serverless function)
├── src/
│   ├── components/
│   │   ├── AuthLayout.jsx      # Split-screen auth wrapper
│   │   ├── BlockEditModal.jsx  # Edit/delete modal for tasks + events
│   │   ├── Layout.jsx          # Navbar + page shell
│   │   └── ProtectedRoute.jsx  # Redirects to /login when signed out
│   ├── context/
│   │   └── AuthContext.jsx     # Supabase session provider
│   ├── lib/
│   │   ├── api.js              # Supabase queries + /api/plan client wrapper
│   │   ├── sampleTranscript.js # "Use example" brain dump for demos
│   │   ├── speech.js           # Browser Web Speech API hook (voice input)
│   │   ├── supabase.js         # Supabase client
│   │   └── time.js             # Date/time formatting helpers
│   ├── pages/
│   │   ├── Login.jsx / Signup.jsx
│   │   ├── Dashboard.jsx       # Today's schedule, upcoming tasks, quick capture, progress
│   │   ├── CreatePlan.jsx      # Primary workflow: mic + text -> "Analyzing your day..."
│   │   └── ScheduleDetail.jsx  # Full editable timeline for one day
│   ├── App.jsx                 # Routes
│   ├── main.jsx                # Entry point
│   └── index.css               # Design system (CSS variables) + components
├── supabase/
│   └── schema.sql              # Full schema, triggers, RLS — source of truth
├── .env.example
├── vercel.json
└── vite.config.js
```

## Database schema

All tables live in `supabase/schema.sql` and are RLS-protected
(`auth.uid() = user_id`).

| Table | Purpose |
|---|---|
| `profiles` | One row per user. `preferences` jsonb holds forward-compatible scheduling defaults (wake/sleep time, focus block length) — not read by any code yet. |
| `daily_plans` | One brain-dump + generated schedule per `(user_id, plan_date)`. Holds the raw transcript, the AI's explanation, detected conflicts, and which model produced it. |
| `tasks` | Flexible to-dos the scheduler placed: category, priority, duration, deadline, `depends_on_task_id`, status (`pending`/`scheduled`/`completed`/`cancelled`), and `scheduled_start`/`scheduled_end`. |
| `calendar_events` | Fixed blocks with a hard start/end (class, work, appointment). `external_provider`/`external_event_id` are reserved for future Google/Apple Calendar sync — unused today. |
| `ai_sessions` | Audit log of every `/api/plan` call: request payload, raw Claude response, status, latency. Used for debugging and future habit-learning. |
| `integrations` | **Not implemented.** Placeholder for future Google/Apple Calendar OAuth connections so that feature won't need a schema migration later. |

## API endpoints

### `POST /api/plan`

The entire AI pipeline. Requires `Authorization: Bearer <supabase-access-token>`.

**Request**
```json
{
  "transcript": "I have class from 9 to 11...",
  "inputSource": "voice",
  "planDate": "2026-07-17"
}
```

**Response `200`**
```json
{
  "plan": { "id": "...", "plan_date": "2026-07-17", "explanation": "...", "conflicts": [], "status": "active" },
  "tasks": [ { "id": "...", "title": "SQL assignment", "priority": "high", "scheduled_start": "...", "scheduled_end": "..." } ],
  "events": [ { "id": "...", "title": "Class", "start_time": "...", "end_time": "..." } ],
  "explanation": "...",
  "conflicts": [],
  "model": "claude-sonnet-4-5"
}
```

Errors: `400` invalid input, `401` missing/invalid session, `413` transcript
too long, `422` the AI output failed structural validation, `502` Anthropic
call failed, `500` failed to persist.

All other reads/writes (dashboard data, editing, deleting, completing,
rescheduling) go straight from the browser to Supabase via `src/lib/api.js`,
protected by RLS — no additional API routes are needed for those.

## Setup

1. **Supabase**: create a project, then run `supabase/schema.sql` in the SQL
   editor.
2. **Environment**: copy `.env.example` to `.env.local` and fill in
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`
   (server-side only — do not prefix with `VITE_`), and optionally
   `ANTHROPIC_MODEL`.
3. **Install & run**:
   ```bash
   npm install
   npm run dev        # local dev (note: /api routes need `vercel dev` to run locally)
   npm run build       # production build
   ```
4. **Deploy**: push to GitHub, import into Vercel, set the same env vars in
   the Vercel project settings (framework is auto-detected via
   `vercel.json`).

## Implementation summary

Every workflow in the MVP is fully wired end to end, not a placeholder:

- **Auth** — Supabase email/password sign up/in, protected routes, session
  persisted via `AuthContext`.
- **Voice + text capture** — `useVoiceInput()` wraps the browser
  `SpeechRecognition` API; every voice entry point also has a live-editable
  text area fallback.
- **AI pipeline** — `api/plan.js` calls Claude with a forced structured tool
  call, validates the result, and persists it.
- **Schedule generation** — real optimization happens in the prompt
  (priority ordering, dependency ordering, conflict-avoidance) plus a
  deterministic overlap check as a safety net.
- **Dashboard** — today's schedule preview, upcoming tasks with one-tap
  complete, live progress bar, and a quick capture box that can re-plan the
  day on the spot.
- **Schedule Detail** — full timeline with per-block edit (time, title,
  category/type, priority, duration), delete, and complete/reopen.
- **Task management** — edit, delete, complete, and reschedule all work
  against real Supabase rows (`src/lib/api.js`), not mock data.

## Remaining work after MVP

- Google Calendar / Apple Calendar sync (schema is ready; no OAuth flow yet).
- Push notifications / reminders.
- Learning user habits and automatic reprioritization over time.
- Weekly planning view and recurring tasks.
- Travel time and weather-aware scheduling.
- Focus session mode (Pomodoro-style blocks, do-not-disturb).
- Real per-user timezone handling (`profiles.timezone` exists but is
  unused — see the timezone convention note in `CLAUDE.md`).
- Automated tests (none exist yet — validated so far via `npm run build`
  and manual pipeline review).
