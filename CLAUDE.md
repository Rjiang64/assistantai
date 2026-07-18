# CLAUDE.md

Project-specific instructions for Claude when working in this repository.

## Project

**AssistantAI**

## Goal

An AI-powered personal executive assistant. The user speaks (or types) a
messy brain dump of everything they need to do today; AssistantAI extracts
every task and fixed event, estimates missing durations, prioritizes,
detects conflicts, and builds one optimized daily schedule with an
explanation of its reasoning.

## Core workflow

Voice/text brain dump -> `/api/plan` (Claude tool call, forced structured
JSON) -> extraction (fixed events + flexible tasks) -> optimized schedule ->
explanation -> persisted to Supabase -> rendered as an editable timeline.

## Important positioning

- This is **not** a chatbot. There is no message thread / conversational UI.
- This is **not** a generic calendar app or Jira-style task manager.
- This **is** a single-workflow tool: brain dump in, optimized day out.

## Technical rules

- **React + Vite** for the frontend, **React Router** for navigation.
- **Bootstrap** for all styling (CSS classes only) + plain custom CSS in
  `src/index.css`. **No Tailwind.**
- **Supabase** for auth (email/password) and Postgres storage, protected by
  **Row-Level Security** — every table policy is `auth.uid() = user_id`.
- **Vercel serverless function** (`api/plan.js`) is the only place that calls
  the Anthropic API.
- **Never expose `ANTHROPIC_API_KEY`** or any AI key in frontend code.
  Variables prefixed `VITE_` are bundled into the browser — the Anthropic
  key must NOT use that prefix.
- Store secrets only in environment variables (`.env.local` locally, Vercel
  project env vars in production). `.env.example` documents variable names
  only — never real values.
- Browser **Web Speech API** for voice (`src/lib/speech.js`), with a text
  area fallback everywhere voice is offered. **No Whisper, no external
  speech API**, per MVP scope.

## Timezone convention (read before touching time code)

There is no real per-user timezone handling yet (`profiles.timezone` is a
reserved column for future work). To keep the MVP correct for a single day
without solving real TZ math, every timestamp written by `api/plan.js`
encodes the **literal wall-clock time the user meant** as a UTC-labeled ISO
string, e.g. `"2026-07-17T09:00:00.000Z"` really means "9:00 AM local", not
9:00 AM UTC. The frontend (`src/lib/time.js`) always formats with
`{ timeZone: 'UTC' }` so the displayed time matches what was spoken,
regardless of the viewer's system clock. If you change one side, you must
change the other, or displayed times will silently drift.

## AI pipeline (`api/plan.js`)

- Single forced tool call (`submit_daily_plan`) does all four pipeline
  steps in one atomic response: extract fixed events, extract flexible
  tasks (duration/priority/deadline/dependencies), build the optimized
  non-overlapping schedule, and write the explanation — one JSON object,
  never free-form/markdown text.
- The tool's `input_schema` is validated by the Anthropic API itself; the
  function re-validates structurally in `validatePlan()` before writing
  anything to Postgres (never save a corrupted/partial plan).
- `detectOverlaps()` is a deterministic safety net that re-checks the final
  schedule for overlapping blocks even after the model's own reasoning.
- Regenerating a plan for a date **replaces** that day's tasks and
  calendar_events (upsert on `daily_plans(user_id, plan_date)`, then
  delete+reinsert children). There is no merge-with-previous-transcript
  behavior in the MVP — documented, not a bug.
- Every call is logged to `ai_sessions` (request payload, raw response,
  status, latency) whether it succeeds or fails, for debugging and future
  habit-learning features.

## Database

Source of truth: `supabase/schema.sql`. Tables: `profiles`, `daily_plans`,
`tasks`, `calendar_events`, `ai_sessions`, and a not-yet-wired `integrations`
placeholder for future Google/Apple Calendar OAuth. Every table has RLS
enabled and scoped to the owning user.

## Design rules

- Minimal, professional, modern SaaS. Blue palette only (see CSS variables
  in `src/index.css`). Bootstrap only, no Tailwind.
- It should feel like handing your morning to an assistant, not opening a
  chat window — no chat bubbles, no "type a message" affordance anywhere.

## Development workflow

- Run `npm run build` before declaring a change complete.
- Do not modify unrelated files unnecessarily.
- Do not implement the "Future features" below unless explicitly asked.

## Future features (architecture allows for these; NOT implemented)

- Google Calendar / Apple Calendar sync (`integrations` table + the
  `external_provider`/`external_event_id` columns on `calendar_events`
  already exist for this).
- Push notifications / reminders.
- Learning user habits, automatic reprioritization.
- Weekly planning, recurring tasks.
- Travel time and weather-aware scheduling.
- Focus sessions.

## File layout reference

```
api/plan.js                 # Vercel serverless function — the entire AI pipeline
src/components/              # Layout, ProtectedRoute, AuthLayout, BlockEditModal
src/pages/                    # Login, Signup, Dashboard, CreatePlan, ScheduleDetail
src/lib/                      # supabase client, api wrapper, speech, time helpers
src/context/AuthContext.jsx   # Supabase auth provider
supabase/schema.sql           # Tables, indexes, RLS policies — source of truth
.env.example                  # Documented env var names (no secrets)
```
