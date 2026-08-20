-- Self-contained production error monitoring. Every server-side captureError() (lib/errorMonitor.ts)
-- lands one row here, best-effort — it must never block or fail the operation it wraps, the same
-- discipline as notify(). Superadmin-only READ, service-role-only WRITE: identical trust boundary to
-- admin_actions (0055), RLS on with zero client policies plus an explicit GRANT revoke.
--
-- This is the always-on floor that needs no external account. Sentry is the "layer on later" half of
-- the decision — lib/errorMonitor.ts has the forwarding seam; this table does not depend on it.
--
-- Grouping is by `fingerprint` (a hash of source + a normalized message with ids/numbers/urls masked,
-- computed in the app), so "job <uuid> failed" collapses into one group with a count rather than a
-- wall of near-identical rows. Resolving is per-fingerprint: an operator marks a whole class handled.

create table if not exists public.error_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  level text not null default 'error' check (level in ('error', 'warning')),
  source text not null,                       -- e.g. 'engine.worker', 'api.billing.webhook'
  message text not null,
  fingerprint text not null,                  -- app-computed group key
  stack text,
  context jsonb not null default '{}'::jsonb, -- structured extras; callers must never put secrets here
  user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  resolved_at timestamptz
);

create index if not exists error_events_created_idx on public.error_events (created_at desc);
create index if not exists error_events_fingerprint_idx on public.error_events (fingerprint, created_at desc);
create index if not exists error_events_unresolved_idx on public.error_events (resolved_at) where resolved_at is null;

alter table public.error_events enable row level security;
revoke all on public.error_events from anon, authenticated;

-- Grouped read for the superadmin dashboard: one row per fingerprint, newest group first.
create or replace function public.admin_error_groups(p_limit int default 100)
returns table (
  fingerprint text,
  source text,
  level text,
  latest_message text,
  total bigint,
  unresolved bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  perform public.assert_superadmin();
  return query
    select
      e.fingerprint,
      (array_agg(e.source order by e.created_at desc))[1]  as source,
      (array_agg(e.level order by e.created_at desc))[1]   as level,
      (array_agg(e.message order by e.created_at desc))[1] as latest_message,
      count(*)                                              as total,
      count(*) filter (where e.resolved_at is null)         as unresolved,
      min(e.created_at)                                     as first_seen,
      max(e.created_at)                                     as last_seen
    from public.error_events e
    group by e.fingerprint
    order by max(e.created_at) desc
    limit greatest(1, least(p_limit, 500));
end;
$$;

-- Mark every event in a group resolved. Returns how many rows flipped.
create or replace function public.admin_resolve_error_group(p_fingerprint text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n integer;
begin
  perform public.assert_superadmin();
  update public.error_events
    set resolved_at = now()
    where fingerprint = p_fingerprint and resolved_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.admin_error_groups(int) from public, anon;
revoke execute on function public.admin_resolve_error_group(text) from public, anon;
grant execute on function public.admin_error_groups(int) to authenticated;
grant execute on function public.admin_resolve_error_group(text) to authenticated;
