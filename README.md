# AssistantAI

An AI-powered personal assistant. Speak (or type)
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

**Live demo:** https://assistantai-sooty.vercel.app

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
