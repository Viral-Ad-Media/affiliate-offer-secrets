-- Read side of the superadmin dashboard.
--
-- These are SECURITY DEFINER and granted to `authenticated`, and each one calls
-- assert_superadmin() as its first act. That is deliberately different from how the rest of this
-- app does cross-tenant reads (admin client + a gate in the route): here the authorization lives
-- in the database, so the app never needs the service-role key to render the dashboard, and a
-- future route that forgets to call requireSuperadminOr404() still gets nothing back. The gate
-- can't be bypassed by forgetting it.
--
-- They also read auth.users for the email, which PostgREST does not expose — another reason this
-- belongs in a definer function rather than an app-side join.

-- Platform-wide totals and queue health: the "what's going on right now" answer.
create or replace function public.admin_platform_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v jsonb;
begin
  perform public.assert_superadmin();

  select jsonb_build_object(
    'accounts',        (select count(*) from public.profiles),
    'accounts_paid',   (select count(*) from public.profiles where access_granted),
    'accounts_trial',  (select count(*) from public.profiles
                         where not access_granted and trial_ends_at > now()),
    'accounts_expired',(select count(*) from public.profiles
                         where not access_granted and (trial_ends_at is null or trial_ends_at <= now())),
    'workspaces',      (select count(*) from public.workspaces),
    'products',        (select count(*) from public.products),
    'campaigns_ready', (select count(*) from public.campaigns where status = 'ready'),
    'funnels_live',    (select count(*) from public.campaigns where bridge_published),
    'contacts',        (select count(*) from public.contacts),
    'ad_launches',     (select count(*) from public.ad_launches),
    'jobs_pending',    (select count(*) from public.jobs where status = 'pending'),
    'jobs_running',    (select count(*) from public.jobs where status = 'running'),
    'jobs_error',      (select count(*) from public.jobs where status = 'error'),
    -- The single most useful number for "is the queue actually moving": if this climbs past a
    -- couple of minutes the trigger/cron path is broken, regardless of how many jobs are pending.
    'oldest_pending_seconds',
      (select coalesce(extract(epoch from (now() - min(created_at)))::int, 0)
         from public.jobs where status = 'pending'),
    'spend_24h',       (select coalesce(sum(cost_usd), 0)::float from public.usage_ledger
                         where created_at > now() - interval '24 hours'),
    'spend_total',     (select coalesce(sum(cost_usd), 0)::float from public.usage_ledger),
    'credits_outstanding',
                       (select coalesce(sum(delta), 0)::int from public.credits_ledger)
  ) into v;

  return v;
end;
$$;

-- One row per account, with the per-tenant numbers a support question actually starts from.
create or replace function public.admin_accounts()
returns table (
  user_id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  access_granted boolean,
  trial_ends_at timestamptz,
  is_superadmin boolean,
  credits integer,
  products integer,
  campaigns integer,
  contacts integer,
  jobs_error integer,
  spend_usd double precision
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.assert_superadmin();

  return query
  select
    p.id,
    u.email::text,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    u.created_at,
    u.last_sign_in_at,
    p.access_granted,
    p.trial_ends_at,
    p.is_superadmin,
    coalesce((select sum(c.delta)::int from public.credits_ledger c where c.user_id = p.id), 0),
    (select count(*)::int from public.products     x where x.user_id = p.id),
    (select count(*)::int from public.campaigns    x where x.user_id = p.id),
    (select count(*)::int from public.contacts     x where x.user_id = p.id),
    (select count(*)::int from public.jobs         x where x.user_id = p.id and x.status = 'error'),
    coalesce((select sum(x.cost_usd)::float from public.usage_ledger x where x.user_id = p.id), 0)
  from public.profiles p
  join auth.users u on u.id = p.id
  order by u.created_at desc;
end;
$$;

-- Jobs that need a human: terminally failed, or pending/running far longer than they should be.
-- Joined to the owner's email so a failure is immediately attributable to an account.
create or replace function public.admin_problem_jobs()
returns table (
  id uuid,
  user_id uuid,
  email text,
  type text,
  status text,
  stage integer,
  attempts integer,
  result text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.assert_superadmin();

  return query
  select j.id, j.user_id, u.email::text, j.type, j.status, j.stage, j.attempts,
         j.result, j.created_at, j.updated_at
  from public.jobs j
  join auth.users u on u.id = j.user_id
  where j.status = 'error'
     or (j.status = 'running' and j.updated_at < now() - interval '15 minutes')
     or (j.status = 'pending' and j.created_at < now() - interval '15 minutes')
  order by j.updated_at desc
  limit 100;
end;
$$;

-- The admin's own trail. Reading it is itself only possible as a superadmin.
create or replace function public.admin_recent_actions()
returns table (
  id uuid,
  actor_email text,
  action text,
  target_email text,
  detail jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.assert_superadmin();

  return query
  select a.id, actor.email::text, a.action, target.email::text, a.detail, a.created_at
  from public.admin_actions a
  left join auth.users actor  on actor.id  = a.actor_user_id
  left join auth.users target on target.id = a.target_user_id
  order by a.created_at desc
  limit 50;
end;
$$;

revoke execute on function public.admin_platform_stats()  from public, anon;
revoke execute on function public.admin_accounts()        from public, anon;
revoke execute on function public.admin_problem_jobs()    from public, anon;
revoke execute on function public.admin_recent_actions()  from public, anon;

grant execute on function public.admin_platform_stats()  to authenticated;
grant execute on function public.admin_accounts()        to authenticated;
grant execute on function public.admin_problem_jobs()    to authenticated;
grant execute on function public.admin_recent_actions()  to authenticated;
