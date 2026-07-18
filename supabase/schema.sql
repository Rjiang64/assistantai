-- AssistantAI — database schema
-- Run this in the Supabase SQL editor against a fresh project.
--
-- Design notes:
--   * daily_plans is the container for one day's brain-dump + generated
--     schedule. One row per (user, calendar date) — regenerating a plan
--     updates the same row and its child tasks/events are replaced.
--   * tasks holds FLEXIBLE items the AI scheduled (things with an
--     estimated duration that can move around, e.g. "study Python").
--   * calendar_events holds FIXED items with a hard start/end (class,
--     work shift, appointment) — either extracted from the brain dump
--     or entered manually. external_provider / external_event_id exist
--     now so Google/Apple Calendar sync can be added later without a
--     schema migration — no sync logic is implemented yet.
--   * ai_sessions is an audit log of every /api/plan call: raw input,
--     the exact model + payload sent, and the structured response. Used
--     for debugging the AI pipeline and, later, for learning user habits.
--   * integrations is a placeholder table for future Google/Apple Calendar
--     OAuth connections. No code reads/writes it yet — it exists purely
--     so that future work doesn't require a schema migration.

-- =====================================================================
-- profiles: one row per user. Holds scheduling preferences so future
-- features (auto-reprioritization, weekly planning) have somewhere to
-- read defaults from without another migration.
-- =====================================================================

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'UTC',
  -- Free-form bag for forward-compatible preferences, e.g.
  -- {"wake_time": "07:00", "sleep_time": "23:00", "focus_block_minutes": 90}
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================================
-- daily_plans: one brain-dump + generated schedule for a given day.
-- =====================================================================

create table if not exists daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_date date not null,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  input_source text check (input_source in ('voice', 'text')),
  raw_transcript text,
  explanation text,
  conflicts jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, plan_date)
);

create index if not exists daily_plans_user_date_idx
  on daily_plans (user_id, plan_date desc);

-- =====================================================================
-- tasks: FLEXIBLE items the AI (or the user) scheduled. These have an
-- estimated duration and can move; scheduled_start/end is where the
-- scheduler placed them for plan_date.
-- =====================================================================

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_plan_id uuid references daily_plans(id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'personal'
    check (category in ('work', 'study', 'health', 'errand', 'personal', 'chore', 'social', 'other')),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  duration_minutes integer not null check (duration_minutes > 0),
  deadline timestamptz,
  depends_on_task_id uuid references tasks(id) on delete set null,
  status text not null default 'scheduled'
    check (status in ('pending', 'scheduled', 'completed', 'cancelled')),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  sort_order integer not null default 0,
  source text not null default 'voice' check (source in ('voice', 'text', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_daily_plan_idx on tasks (daily_plan_id);
create index if not exists tasks_user_status_idx on tasks (user_id, status);
create index if not exists tasks_user_scheduled_start_idx on tasks (user_id, scheduled_start);

-- =====================================================================
-- calendar_events: FIXED items with a hard start/end (class, work shift,
-- appointment). "internal" today; external_provider/external_event_id
-- are reserved for future Google/Apple Calendar sync.
-- =====================================================================

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_plan_id uuid references daily_plans(id) on delete cascade,
  title text not null,
  event_type text not null default 'other'
    check (event_type in ('class', 'work', 'appointment', 'personal', 'other')),
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_fixed boolean not null default true,
  external_provider text not null default 'internal'
    check (external_provider in ('internal', 'google', 'apple')),
  external_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index if not exists calendar_events_daily_plan_idx on calendar_events (daily_plan_id);
create index if not exists calendar_events_user_start_idx on calendar_events (user_id, start_time);

-- =====================================================================
-- ai_sessions: audit log of every AI pipeline invocation. Never exposes
-- the Anthropic API key (that lives only in the server env) — this just
-- records what was sent/received for debugging and future habit-learning.
-- =====================================================================

create table if not exists ai_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  daily_plan_id uuid references daily_plans(id) on delete set null,
  transcript_raw text,
  model text,
  request_payload jsonb,
  response_payload jsonb,
  status text not null default 'success' check (status in ('success', 'error')),
  error_message text,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists ai_sessions_user_created_idx on ai_sessions (user_id, created_at desc);

-- =====================================================================
-- integrations: FUTURE WORK placeholder for Google Calendar / Apple
-- Calendar OAuth connections. No application code reads or writes this
-- table yet. It exists so that adding real sync later is additive
-- (no migration needed), per the project's "design architecture, do not
-- implement" requirement for external calendar integrations.
-- =====================================================================

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google_calendar', 'apple_calendar')),
  status text not null default 'not_connected'
    check (status in ('not_connected', 'connected', 'error')),
  access_token text,
  refresh_token text,
  external_account_email text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- =====================================================================
-- updated_at trigger, shared across tables
-- =====================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists daily_plans_set_updated_at on daily_plans;
create trigger daily_plans_set_updated_at
  before update on daily_plans
  for each row execute function set_updated_at();

drop trigger if exists tasks_set_updated_at on tasks;
create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

drop trigger if exists calendar_events_set_updated_at on calendar_events;
create trigger calendar_events_set_updated_at
  before update on calendar_events
  for each row execute function set_updated_at();

drop trigger if exists integrations_set_updated_at on integrations;
create trigger integrations_set_updated_at
  before update on integrations
  for each row execute function set_updated_at();

-- =====================================================================
-- Auto-create a profile row whenever a new auth.users row appears.
-- =====================================================================

create or replace function create_profile_for_new_user()
returns trigger
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function create_profile_for_new_user();

-- Backfill profiles for any users that signed up before this trigger existed
insert into profiles (user_id)
  select id from auth.users
  where id not in (select user_id from profiles);

-- =====================================================================
-- Row-Level Security — every table scoped to auth.uid() = user_id.
-- =====================================================================

alter table profiles enable row level security;
alter table daily_plans enable row level security;
alter table tasks enable row level security;
alter table calendar_events enable row level security;
alter table ai_sessions enable row level security;
alter table integrations enable row level security;

drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own daily_plans" on daily_plans;
create policy "own daily_plans" on daily_plans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own tasks" on tasks;
create policy "own tasks" on tasks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own calendar_events" on calendar_events;
create policy "own calendar_events" on calendar_events
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own ai_sessions" on ai_sessions;
create policy "own ai_sessions" on ai_sessions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own integrations" on integrations;
create policy "own integrations" on integrations
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
