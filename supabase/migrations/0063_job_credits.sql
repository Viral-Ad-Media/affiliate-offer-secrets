-- Credits actually get consumed by work now, not just by authorising ad spend.
--
-- Until this, credits_ledger was debited in exactly one place — reserve_ad_credits() at ad
-- activation — while every unit of real platform cost (Anthropic calls, kie.ai images, Veo video)
-- was recorded in usage_ledger as tracking only, with nothing ever deducted. That was the right
-- call while one operator tested solo and every generation was billed to the operator's own API
-- keys; it does not survive paying customers.
--
-- THREE decisions worth understanding before changing any of this:
--
-- 1. A job is charged ONCE, at queue time, keyed on its own id — never inside a stage handler.
--    lib/engine/worker.ts re-runs stages, reclaims jobs whose locked_at went stale, and retries up
--    to MAX_ATTEMPTS; a debit written inside a stage would charge again on every one of those.
--    The partial unique index below makes "once" a database guarantee rather than app discipline,
--    so even a buggy future caller cannot double-charge.
--
-- 2. The balance is summed by WORKSPACE, not by user — and this fixes a real pre-existing bug.
--    reserve_ad_credits() summed `where user_id = auth.uid()` while credits_ledger has been
--    workspace-scoped since 0057 and app/(app)/layout.tsx's credits chip sums by workspace_id. In
--    a workspace with more than one member those two disagree: credits bought by one member were
--    invisible to another member trying to spend them, while the chip cheerfully showed the shared
--    total. Both now go through workspace_credit_balance().
--
-- 3. Both debit paths take the SAME advisory lock key ('credits:' || workspace_id), so a job
--    charge and an ad-spend reservation serialise against each other. Two debits racing under
--    READ COMMITTED can both read the same starting balance and both pass — the exact race
--    0008 documented for reserve_ad_credits, which only holds if everyone shares the lock.

-- Ties a ledger row to the work that caused it: the idempotency key, the refund lookup, and the
-- audit trail ("what did this actually pay for") in one column. on delete set null so purging old
-- jobs never destroys billing history — the same reasoning as contacts.campaign_id.
alter table public.credits_ledger
  add column if not exists job_id uuid references public.jobs(id) on delete set null;

-- At most one charge and one refund per job, enforced by the database. Separate partial indexes on
-- sign rather than one on job_id, because a refunded job legitimately has two rows.
create unique index if not exists credits_ledger_one_charge_per_job
  on public.credits_ledger (job_id) where job_id is not null and delta < 0;
create unique index if not exists credits_ledger_one_refund_per_job
  on public.credits_ledger (job_id) where job_id is not null and delta > 0;

create index if not exists credits_ledger_workspace_idx
  on public.credits_ledger (workspace_id);

-- The single definition of "what is this workspace's balance". Every caller uses it so the number
-- the UI shows and the number a debit checks can never drift apart again.
create or replace function public.workspace_credit_balance(p_workspace_id uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(delta), 0)::integer
  from public.credits_ledger
  where workspace_id = p_workspace_id;
$$;

revoke execute on function public.workspace_credit_balance(uuid) from public, anon;
grant execute on function public.workspace_credit_balance(uuid) to authenticated, service_role;

-- Charge a queued job. Returns the remaining balance, or NULL when the workspace cannot afford it
-- (the caller then deletes the job and answers 402 — see lib/credits.server.ts).
--
-- The workspace comes from the JOB ROW, never from a parameter, and membership is re-checked here:
-- this is granted to `authenticated`, so a caller reaching the RPC directly must not be able to
-- charge — or probe the balance of — a workspace they don't belong to.
create or replace function public.charge_job_credits(p_job_id uuid, p_amount integer, p_reason text)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  ws uuid;
  bal integer;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be >= 0';
  end if;

  select workspace_id into ws from public.jobs where id = p_job_id;
  -- Same generic message for "no such job" and "not your workspace" — no existence oracle, the
  -- same discipline every public route here already follows.
  if ws is null or not public.is_workspace_member(ws) then
    raise exception 'Job not found';
  end if;

  if p_amount = 0 then
    return public.workspace_credit_balance(ws);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('credits:' || ws::text, 0));

  bal := public.workspace_credit_balance(ws);
  if bal < p_amount then
    return null;
  end if;

  insert into public.credits_ledger (user_id, workspace_id, delta, reason, job_id)
  values (auth.uid(), ws, -p_amount, p_reason, p_job_id);

  return bal - p_amount;
exception
  -- Already charged for this job. Idempotent by design: a retried queue request must not debit
  -- twice, and reporting success with the current balance is the honest answer.
  when unique_violation then
    return public.workspace_credit_balance(ws);
end;
$$;

revoke execute on function public.charge_job_credits(uuid, integer, text) from public, anon;
grant execute on function public.charge_job_credits(uuid, integer, text) to authenticated;

-- Compensating refund when a job fails terminally. service_role only — the caller is the worker
-- (lib/engine/worker.ts's failJob), which has no session. Mirrors the original debit exactly
-- rather than taking an amount, so a price change between queueing and failing can't refund the
-- wrong number.
create or replace function public.refund_job_credits(p_job_id uuid, p_reason text)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  charge record;
begin
  select user_id, workspace_id, delta
    into charge
  from public.credits_ledger
  where job_id = p_job_id and delta < 0
  limit 1;

  if not found then
    return 0; -- nothing was ever charged (a free job type, or queued before this shipped)
  end if;

  insert into public.credits_ledger (user_id, workspace_id, delta, reason, job_id)
  values (charge.user_id, charge.workspace_id, -charge.delta, p_reason, p_job_id);

  return -charge.delta;
exception
  when unique_violation then
    return 0; -- already refunded
end;
$$;

revoke execute on function public.refund_job_credits(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_job_credits(uuid, text) to service_role;

-- Fix #2 above: ad-spend reservation now reads the shared workspace balance instead of the
-- caller's own rows, and takes the workspace-keyed lock so it serialises with job charges.
-- Signature unchanged, so app/api/meta/ads/activate/route.ts needs no edit.
create or replace function public.reserve_ad_credits(p_amount integer, p_reason text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  ws uuid;
  balance integer;
begin
  ws := public.current_workspace_id();
  if ws is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('credits:' || ws::text, 0));

  balance := public.workspace_credit_balance(ws);
  if balance < p_amount then
    return false;
  end if;

  insert into public.credits_ledger (user_id, workspace_id, delta, reason)
  values (auth.uid(), ws, -p_amount, p_reason);

  return true;
end;
$$;

revoke execute on function public.reserve_ad_credits(integer, text) from public, anon;
grant execute on function public.reserve_ad_credits(integer, text) to authenticated;
