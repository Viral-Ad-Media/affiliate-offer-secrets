-- Superadmin: cross-tenant observability plus a small set of audited account actions.
--
-- The flag lives on `profiles` rather than in its own table because `profiles` already has exactly
-- one policy — SELECT on auth.uid() = id, no client INSERT/UPDATE/DELETE at all (the general
-- update policy was dropped in 0002_trial.sql precisely so nobody could self-grant
-- access_granted). That makes it the safest table in the schema to hold a privilege bit: a client
-- can read their own flag, which tells them nothing they don't know, and cannot write anyone's.
-- If a broad profiles update policy is ever re-added, this flag becomes a privilege-escalation
-- hole — that is now a third independent reason never to add one.
alter table public.profiles
  add column if not exists is_superadmin boolean not null default false;

-- Callable by the app to decide whether to render the admin surface at all. SECURITY DEFINER so
-- it answers for the caller regardless of RLS, and deliberately answers ONLY about the caller —
-- it takes no user_id argument, so it can never be used to enumerate who the superadmins are.
create or replace function public.is_superadmin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false);
$$;

revoke execute on function public.is_superadmin() from public, anon;
grant execute on function public.is_superadmin() to authenticated;

-- Every state-changing admin action lands here, in the same transaction as its effect (see the
-- RPCs below) — so there is no code path that changes a tenant's access, credits or trial without
-- leaving a record of who did it. Default-deny: no policies at all, service_role only, same shape
-- as the Vault-backed connection tables.
create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_actions_created_at_idx on public.admin_actions (created_at desc);
create index if not exists admin_actions_target_idx on public.admin_actions (target_user_id, created_at desc);

alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;
grant all on public.admin_actions to service_role;

-- Shared guard. Raising (rather than returning false) means a non-superadmin calling any admin RPC
-- directly through PostgREST gets an error, not a silent no-op that could read as success.
create or replace function public.assert_superadmin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'not authorized';
  end if;
end;
$$;

revoke execute on function public.assert_superadmin() from public, anon;
grant execute on function public.assert_superadmin() to authenticated;

-- --------------------------------------------------------------------------------------------
-- Account actions. Each one is SECURITY DEFINER, self-checks superadmin, and writes its audit row
-- in the same statement sequence as its effect — the audit is not a courtesy the caller can skip.
-- --------------------------------------------------------------------------------------------

-- Grant or revoke paid access by hand (a failed webhook, a comped account, a refund).
create or replace function public.admin_set_access(p_user_id uuid, p_granted boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_superadmin();

  update public.profiles set access_granted = p_granted, updated_at = now() where id = p_user_id;
  if not found then
    raise exception 'no such account';
  end if;

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (auth.uid(), 'set_access', p_user_id,
          jsonb_build_object('granted', p_granted, 'reason', p_reason));
end;
$$;

-- Credit adjustment. NOTE: this is a deliberate, documented exception to the standing rule that
-- ONLY the Stripe webhook writes credits_ledger. That rule exists to stop ordinary app code
-- minting credits by accident; a superadmin comping or clawing back credits is a real support
-- action, and doing it by hand in SQL would be less safe, not more — this path is at least
-- authenticated, authorized and audited. The ledger stays append-only either way: a claw-back is
-- a negative delta, never a deletion.
create or replace function public.admin_adjust_credits(p_user_id uuid, p_delta integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_superadmin();

  if p_delta = 0 then
    raise exception 'delta must be non-zero';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'no such account';
  end if;

  insert into public.credits_ledger (user_id, delta, reason)
  values (p_user_id, p_delta, 'admin: ' || btrim(p_reason));

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (auth.uid(), 'adjust_credits', p_user_id,
          jsonb_build_object('delta', p_delta, 'reason', btrim(p_reason)));
end;
$$;

-- Extend (or shorten) a trial. Measured from the later of now and the current expiry, so extending
-- an already-running trial adds days rather than silently truncating it back to now + N.
create or replace function public.admin_extend_trial(p_user_id uuid, p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new timestamptz;
begin
  perform public.assert_superadmin();

  if p_days = 0 then
    raise exception 'days must be non-zero';
  end if;

  update public.profiles
     set trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + make_interval(days => p_days),
         updated_at = now()
   where id = p_user_id
  returning trial_ends_at into v_new;

  if v_new is null then
    raise exception 'no such account';
  end if;

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (auth.uid(), 'extend_trial', p_user_id,
          jsonb_build_object('days', p_days, 'trial_ends_at', v_new));

  return v_new;
end;
$$;

-- Put a terminally-failed job back in the queue. Resets attempts so the worker's MAX_ATTEMPTS cap
-- doesn't immediately re-fail it, and clears locked_at so claim_job() can pick it up on the next
-- tick. Deliberately does NOT reset `stage` — a multi-stage job resumes where it died, which is
-- the whole point of the stage/stage_data design.
create or replace function public.admin_requeue_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  perform public.assert_superadmin();

  update public.jobs
     set status = 'pending', attempts = 0, locked_at = null, result = null,
         updated_at = now()
   where id = p_job_id
  returning user_id into v_user;

  if v_user is null then
    raise exception 'no such job';
  end if;

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (auth.uid(), 'requeue_job', v_user, jsonb_build_object('job_id', p_job_id));
end;
$$;

-- Terminally fail a job that is stuck and shouldn't be retried.
create or replace function public.admin_fail_job(p_job_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  perform public.assert_superadmin();

  update public.jobs
     set status = 'error', locked_at = null,
         result = coalesce(nullif(btrim(p_message), ''), 'failed by an administrator'),
         updated_at = now()
   where id = p_job_id
  returning user_id into v_user;

  if v_user is null then
    raise exception 'no such job';
  end if;

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (auth.uid(), 'fail_job', v_user,
          jsonb_build_object('job_id', p_job_id, 'message', p_message));
end;
$$;

revoke execute on function public.admin_set_access(uuid, boolean, text) from public, anon;
revoke execute on function public.admin_adjust_credits(uuid, integer, text) from public, anon;
revoke execute on function public.admin_extend_trial(uuid, integer) from public, anon;
revoke execute on function public.admin_requeue_job(uuid) from public, anon;
revoke execute on function public.admin_fail_job(uuid, text) from public, anon;

grant execute on function public.admin_set_access(uuid, boolean, text) to authenticated;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;
grant execute on function public.admin_extend_trial(uuid, integer) to authenticated;
grant execute on function public.admin_requeue_job(uuid) to authenticated;
grant execute on function public.admin_fail_job(uuid, text) to authenticated;
