-- Close the two remaining credit-integrity gaps:
--
--   1. Authenticated clients could write jobs directly, bypassing the credit ledger entirely.
--      Even the intended application path inserted a runnable pending job first and charged it in
--      a second transaction, so the insert trigger could wake a worker before a declined charge
--      deleted the row.
--   2. reserve_ad_credits(amount, reason) trusted both caller-controlled values. A negative amount
--      minted credits, members could spend a workspace's ad budget, and retries had no durable key.
--
-- queue_job() below is the only authenticated job-write path. The job and its debit commit in the
-- same database transaction; no other transaction can claim the row until that debit also exists.
-- Free user-queueable jobs still go through the same gate. send_broadcast_email remains internal:
-- run_broadcast_sweep() inserts it as service_role after applying its scheduling/send-cap rules.

-- Durable ad reservation identity. Deliberately not a foreign key: the append-only billing trail
-- must retain its launch key (and therefore its idempotency guarantee) even if operational launch
-- rows are later removed.
alter table public.credits_ledger
  add column if not exists ad_launch_id uuid;

alter table public.ad_launches
  add column if not exists activation_locked_at timestamptz,
  add column if not exists activation_lease_id uuid;

create unique index if not exists credits_ledger_one_charge_per_ad_launch
  on public.credits_ledger (ad_launch_id)
  where ad_launch_id is not null and delta < 0;

create unique index if not exists credits_ledger_one_refund_per_ad_launch
  on public.credits_ledger (ad_launch_id)
  where ad_launch_id is not null and delta > 0;

-- This helper is exposed to the balance endpoint. Its original SECURITY DEFINER body accepted any
-- workspace UUID, so an authenticated caller could use it as a cross-tenant balance oracle.
-- Service-role callers have no auth.uid(); signed-in callers must be members of the requested
-- workspace before the definer function reads through RLS.
create or replace function public.workspace_credit_balance(p_workspace_id uuid)
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace not found';
  end if;

  return (
    select coalesce(sum(delta), 0)::integer
    from public.credits_ledger
    where workspace_id = p_workspace_id
  );
end;
$$;

revoke execute on function public.workspace_credit_balance(uuid) from public, anon;
grant execute on function public.workspace_credit_balance(uuid) to authenticated, service_role;

-- ad_launches is a business-key upsert on (campaign_id, angle_index). A live reservation must never
-- be reset to `building`: doing so would reuse the old launch id and therefore its idempotency key.
-- Once a failed activation has been refunded, rebuilding is valid again, but it gets a fresh row id
-- so the next reservation has a fresh ledger key. No table has an FK to ad_launches.id; the ledger
-- intentionally retains the old UUID as immutable history.
create or replace function public.prevent_charged_ad_launch_rebuild()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'building' and exists (
    select 1 from public.credits_ledger
    where ad_launch_id = old.id and delta < 0
  ) then
    if not exists (
      select 1 from public.credits_ledger
      where ad_launch_id = old.id and delta > 0
    ) then
      raise exception 'A charged ad launch cannot be rebuilt';
    end if;
    new.id := gen_random_uuid();
    new.meta_campaign_id := null;
    new.meta_adset_id := null;
    new.meta_creative_id := null;
    new.meta_ad_id := null;
    new.meta_video_id := null;
    new.activation_state := '{}'::jsonb;
    new.activation_locked_at := null;
    new.activation_lease_id := null;
    new.notes := null;
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_charged_ad_launch_rebuild()
  from public, anon, authenticated;

drop trigger if exists prevent_charged_ad_launch_rebuild on public.ad_launches;
create trigger prevent_charged_ad_launch_rebuild
  before update on public.ad_launches
  for each row execute function public.prevent_charged_ad_launch_rebuild();

-- The old overloads accepted caller-controlled financial values. Remove them so they cannot remain
-- reachable through PostgREST after the application switches to the launch-keyed functions below.
drop function if exists public.reserve_ad_credits(integer, text);
drop function if exists public.refund_ad_credits(uuid, integer, text);

create or replace function public.reserve_ad_credits(p_launch_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_launch public.ad_launches;
  v_role text;
  v_balance integer;
  v_existing_charge integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_launch_id is null then
    raise exception 'Launch is required';
  end if;

  -- Locks the launch as the per-launch serialization point. The route changes paused_review to
  -- activating before calling this function; accepting no other state prevents an arbitrary debit
  -- against a draft, failed, or already-active launch.
  select * into v_launch
  from public.ad_launches
  where id = p_launch_id
  for update;

  if v_launch.id is null or not public.is_workspace_member(v_launch.workspace_id) then
    raise exception 'Launch not found';
  end if;

  v_role := public.workspace_role(v_launch.workspace_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Only workspace owners and admins can spend ad credits';
  end if;

  if v_launch.status <> 'activating' then
    raise exception 'Launch is not awaiting activation';
  end if;

  -- budget_credits is protected by ad_launches' positive CHECK, but keep this fail-closed guard at
  -- the financial boundary too. No amount or reason is accepted from the caller.
  if v_launch.budget_credits is null or v_launch.budget_credits <= 0 then
    raise exception 'Launch budget must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('credits:' || v_launch.workspace_id::text, 0));

  -- A response can be lost after commit. Retrying the SAME, still-live reservation is success, not
  -- a second debit. A refunded reservation or one whose amount no longer matches must never be
  -- reused for a rebuilt ad.
  select delta into v_existing_charge
  from public.credits_ledger
  where ad_launch_id = p_launch_id and delta < 0
  limit 1;

  if found then
    if -v_existing_charge <> v_launch.budget_credits then
      raise exception 'Launch budget no longer matches its reservation';
    end if;
    if exists (
      select 1 from public.credits_ledger
      where ad_launch_id = p_launch_id and delta > 0
    ) then
      raise exception 'This launch reservation has already been refunded';
    end if;
    return true;
  end if;

  v_balance := public.workspace_credit_balance(v_launch.workspace_id);
  if v_balance < v_launch.budget_credits then
    return false;
  end if;

  insert into public.credits_ledger (
    user_id, workspace_id, delta, reason, ad_launch_id
  ) values (
    auth.uid(),
    v_launch.workspace_id,
    -v_launch.budget_credits,
    'ad launch: ' || p_launch_id::text,
    p_launch_id
  );

  return true;
end;
$$;

revoke execute on function public.reserve_ad_credits(uuid) from public, anon;
grant execute on function public.reserve_ad_credits(uuid) to authenticated;

-- A short database lease makes the external Meta activation resumable without allowing two
-- requests to drive the same launch concurrently. Existing `activating` rows from an interrupted
-- pre-migration request have a NULL lease and are immediately recoverable.
create or replace function public.claim_ad_activation(p_launch_id uuid, p_lease_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_launch public.ad_launches;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_lease_id is null then
    raise exception 'Activation lease is required';
  end if;

  select * into v_launch
  from public.ad_launches
  where id = p_launch_id
  for update;

  if v_launch.id is null or not public.is_workspace_member(v_launch.workspace_id) then
    raise exception 'Launch not found';
  end if;
  v_role := public.workspace_role(v_launch.workspace_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Only workspace owners and admins can activate ads';
  end if;

  if v_launch.status = 'paused_review' then
    update public.ad_launches
    set status = 'activating',
        activation_locked_at = now(),
        activation_lease_id = p_lease_id,
        notes = null,
        updated_at = now()
    where id = p_launch_id;
    return true;
  end if;

  if v_launch.status = 'activating' then
    if v_launch.activation_locked_at is not null
       and v_launch.activation_locked_at >= now() - interval '2 minutes' then
      return false;
    end if;
    update public.ad_launches
    set activation_locked_at = now(), activation_lease_id = p_lease_id, updated_at = now()
    where id = p_launch_id;
    return true;
  end if;

  raise exception 'Launch cannot be activated from status %', v_launch.status;
end;
$$;

revoke execute on function public.claim_ad_activation(uuid, uuid) from public, anon;
grant execute on function public.claim_ad_activation(uuid, uuid) to authenticated;

-- Refunds mirror the original charge's user, workspace and amount and are unique per launch. The
-- service caller supplies no amount/workspace/reason that could drift from the reservation.
create or replace function public.refund_ad_credits(p_launch_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_charge record;
begin
  if p_launch_id is null then
    return 0;
  end if;

  select user_id, workspace_id, delta
    into v_charge
  from public.credits_ledger
  where ad_launch_id = p_launch_id and delta < 0
  limit 1;

  if not found then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('credits:' || v_charge.workspace_id::text, 0));

  if exists (
    select 1 from public.credits_ledger
    where ad_launch_id = p_launch_id and delta > 0
  ) then
    return 0;
  end if;

  insert into public.credits_ledger (
    user_id, workspace_id, delta, reason, ad_launch_id
  ) values (
    v_charge.user_id,
    v_charge.workspace_id,
    -v_charge.delta,
    'refund: ad activation failed for launch ' || p_launch_id::text,
    p_launch_id
  );

  return -v_charge.delta;
end;
$$;

revoke execute on function public.refund_ad_credits(uuid) from public, anon, authenticated;
grant execute on function public.refund_ad_credits(uuid) to service_role;

-- Once every possibly-live Meta object has been confirmed PAUSED, refunding and marking the
-- launch failed must be one transaction. A process loss cannot leave `failed` without a refund or
-- `activating` with a refund that the next retry cannot reconcile.
create or replace function public.finalize_failed_ad_activation(
  p_launch_id uuid,
  p_lease_id uuid,
  p_notes text,
  p_activation_state jsonb
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_refunded integer;
begin
  perform 1
  from public.ad_launches
  where id = p_launch_id
    and status = 'activating'
    and activation_lease_id = p_lease_id
  for update;
  if not found then
    raise exception 'Activation lease is no longer current';
  end if;

  v_refunded := public.refund_ad_credits(p_launch_id);
  update public.ad_launches
  set status = 'failed',
      activation_state = coalesce(p_activation_state, '{}'::jsonb),
      activation_locked_at = null,
      activation_lease_id = null,
      notes = left(coalesce(p_notes, 'Activation failed'), 1000),
      updated_at = now()
  where id = p_launch_id;

  return v_refunded;
end;
$$;

revoke execute on function public.finalize_failed_ad_activation(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_failed_ad_activation(uuid, uuid, text, jsonb) to service_role;

-- Authenticated callers may read their work queue, but all writes now go through narrow RPCs or
-- service_role worker/sweep code. Replace the old FOR ALL policy as defense in depth as well as
-- revoking the underlying table privileges.
drop policy if exists "own jobs" on public.jobs;
drop policy if exists "workspace members read jobs" on public.jobs;
create policy "workspace members read jobs" on public.jobs
  for select using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.jobs from anon, authenticated;

-- Drain every old queue/charge transaction, including charge_job_credits() transactions that only
-- SELECT the job before writing the ledger. ACCESS EXCLUSIVE is intentional: a weaker jobs lock
-- does not conflict with that SELECT and can leave a quarantined row charged just after our refund
-- snapshot. Keep both locks through catch-up; after commit authenticated callers can only use the
-- atomic queue_job path.
lock table public.jobs in access exclusive mode;
lock table public.credits_ledger in share row exclusive mode;

-- Authenticated clients used to have direct UPDATE access to every internal worker column. A
-- forged job could therefore start at stage > 0 (or carry attacker-chosen stage_data) and skip
-- the stage-zero resource/workspace verifier. Never let one of those rows cross the new trust
-- boundary. Fresh queued work always starts at stage 0 with empty stage_data; genuine in-flight
-- legacy work is deliberately failed and refunded rather than guessing whether its internal state
-- came from a worker or a caller.
with quarantined as (
  update public.jobs j
  set status = 'error',
      stage_data = '{}'::jsonb,
      result = 'quarantined: untrusted legacy worker state',
      locked_at = null,
      updated_at = now()
  where j.status in ('pending', 'running')
    and (j.stage <> 0 or j.stage_data <> '{}'::jsonb)
  returning j.id
)
insert into public.credits_ledger (user_id, workspace_id, delta, reason, job_id)
select
  charge.user_id,
  charge.workspace_id,
  -charge.delta,
  'refund: quarantined unsafe legacy job',
  charge.job_id
from public.credits_ledger charge
join quarantined q on q.id = charge.job_id
where charge.delta < 0
  and not exists (
    select 1
    from public.credits_ledger refund
    where refund.job_id = charge.job_id and refund.delta > 0
  )
on conflict do nothing;

-- Quarantine replaces worker terminal-failure handling, so reconcile the few resource status
-- flags that would otherwise remain permanently "generating"/"queued" and reject a retry. Use
-- text equality against JSON payloads: legacy payloads were caller-controlled and an invalid UUID
-- string must not abort the migration.
update public.campaigns c
set video_status = 'failed',
    video_error = 'Generation was interrupted during a security upgrade. Please retry.',
    updated_at = now()
where c.video_status = 'generating'
  and exists (
    select 1 from public.jobs j
    where j.status = 'error'
      and j.result = 'quarantined: untrusted legacy worker state'
      and j.type = 'generate_video'
      and j.workspace_id = c.workspace_id
      and j.payload->>'campaign_id' = c.id::text
  );

update public.campaign_creatives creative
set status = 'failed',
    error = 'Generation was interrupted during a security upgrade. Please retry.',
    updated_at = now()
where creative.status = 'generating'
  and exists (
    select 1 from public.jobs j
    where j.status = 'error'
      and j.result = 'quarantined: untrusted legacy worker state'
      and j.type in ('generate_creative_image', 'generate_creative_video')
      and j.workspace_id = creative.workspace_id
      and j.payload->>'campaign_creative_id' = creative.id::text
  );

update public.blog_posts post
set featured_image_status = 'failed',
    featured_image_error = 'Generation was interrupted during a security upgrade. Please retry.',
    updated_at = now()
where post.featured_image_status = 'generating'
  and exists (
    select 1 from public.jobs j
    where j.status = 'error'
      and j.result = 'quarantined: untrusted legacy worker state'
      and j.type = 'generate_blog_image'
      and j.workspace_id = post.workspace_id
      and j.payload->>'post_id' = post.id::text
  );

-- Before this migration, authenticated callers could forge the internal-only free broadcast type.
-- A legitimate sweep job is linked back from the exact queued enrollment step in the same
-- workspace. Quarantine every open legacy row that lacks that provenance before workers resume.
update public.jobs j
set status = 'error',
    stage_data = '{}'::jsonb,
    result = 'quarantined: invalid legacy broadcast job',
    locked_at = null,
    updated_at = now()
where j.type = 'send_broadcast_email'
  and j.status in ('pending', 'running')
  and not exists (
    select 1
    from public.broadcast_enrollment_steps bes
    where bes.job_id = j.id
      and bes.workspace_id = j.workspace_id
      and bes.user_id = j.user_id
      and j.payload->>'enrollment_step_id' = bes.id::text
  );

-- Run this after BOTH quarantine passes. job_id is the durable sweep link, so even a legacy row
-- whose mutable user/workspace/payload fields were corrupted cannot leave its real step queued.
update public.broadcast_enrollment_steps step
set status = 'skipped', updated_at = now()
where step.status in ('pending', 'queued')
  and exists (
    select 1 from public.jobs j
    where j.id = step.job_id
      and j.status = 'error'
      and j.type = 'send_broadcast_email'
      and j.result in (
        'quarantined: untrusted legacy worker state',
        'quarantined: invalid legacy broadcast job'
      )
  );

-- The old two-step charge function is no longer part of the authenticated API. Keeping its SQL
-- definition preserves ledger history/debuggability, but removing EXECUTE prevents callers from
-- choosing their own price or reason outside queue_job().
revoke execute on function public.charge_job_credits(uuid, integer, text) from authenticated;

-- Rollout catch-up: jobs inserted through the old authenticated table policy could exist without
-- a debit. Charge every still-runnable paid job once before the new gate becomes visible. This is
-- intentionally allowed to take a workspace negative: the work was already admitted, and silently
-- letting it run for free would preserve the vulnerability this migration closes. The existing
-- per-job unique index makes this safe against an old route charging concurrently.
insert into public.credits_ledger (user_id, workspace_id, delta, reason, job_id)
select
  j.user_id,
  j.workspace_id,
  -(case j.type
    when 'discover_products' then 1
    when 'build_campaign' then 5
    when 'generate_ad_image' then 2
    when 'generate_creative_image' then 2
    when 'generate_blog_image' then 2
    when 'generate_video' then 10
    when 'generate_creative_video' then 10
  end),
  'job: ' || j.type || ' (queue migration catch-up)',
  j.id
from public.jobs j
where j.status in ('pending', 'running')
  and j.type in (
    'discover_products', 'build_campaign', 'generate_ad_image',
    'generate_creative_image', 'generate_blog_image',
    'generate_video', 'generate_creative_video'
  )
  and not exists (
    select 1 from public.credits_ledger l
    where l.job_id = j.id and l.delta < 0
  )
on conflict do nothing;

create or replace function public.queue_job(
  p_workspace_id uuid,
  p_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cost integer;
  v_balance integer;
  v_job_id uuid;
  v_existing_job_id uuid;
  v_target_id uuid;
  v_campaign_id uuid;
  v_angle_index integer;
  v_budget integer;
  v_count integer;
  v_kind text;
begin
  if v_user_id is null then
    raise exception 'Not signed in';
  end if;
  if p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace not found';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Job payload must be an object';
  end if;

  -- Whitelist user-queueable work and validate every referenced entity against the explicit
  -- workspace. The internal send_broadcast_email type is intentionally absent: only the sweep may
  -- queue it after checking due_at, unsubscribe state and provider limits.
  case p_type
    when 'discover_products' then
      v_cost := 1;
      begin
        v_count := (p_payload->>'count')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Invalid discovery count';
      end;
      if coalesce(p_payload->>'network', '') <> 'clickbank'
         or coalesce(p_payload->>'mode', '') not in ('category', 'keyword')
         or coalesce(p_payload->>'niche', '') = ''
         or char_length(p_payload->>'niche') > 200
         or v_count is null or v_count not between 1 and 30
         or (p_payload->>'mode' = 'category' and (
              coalesce(p_payload->>'category', '') = '' or char_length(p_payload->>'category') > 200
            ))
         or (p_payload->>'mode' = 'keyword' and (
              coalesce(p_payload->>'keyword', '') = '' or char_length(p_payload->>'keyword') > 200
            ))
         or not exists (
              select 1 from public.network_connections
              where workspace_id = p_workspace_id
                and network = 'clickbank'
                and coalesce(affiliate_id, '') <> ''
            ) then
        raise exception 'Invalid discovery job payload';
      end if;

    when 'build_campaign' then
      v_cost := 5;
      begin
        v_target_id := (p_payload->>'product_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid product id';
      end;
      if v_target_id is null or not exists (
        select 1
        from public.products p
        join public.network_connections n
          on n.workspace_id = p.workspace_id and n.network = p.network
        where p.id = v_target_id
          and p.workspace_id = p_workspace_id
          and coalesce(n.affiliate_id, '') <> ''
      ) then
        raise exception 'Product not found for this workspace';
      end if;

    when 'generate_ad_image' then
      v_cost := 2;
      begin
        v_target_id := (p_payload->>'campaign_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid campaign id';
      end;
      if v_target_id is null or not exists (
        select 1 from public.campaigns
        where id = v_target_id and workspace_id = p_workspace_id
      ) then
        raise exception 'Campaign not found for this workspace';
      end if;

    when 'generate_video' then
      v_cost := 10;
      begin
        v_target_id := (p_payload->>'campaign_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid campaign id';
      end;
      if v_target_id is null or not exists (
        select 1 from public.campaigns
        where id = v_target_id
          and workspace_id = p_workspace_id
          and video_status = 'generating'
      ) then
        raise exception 'Campaign is not claimed for video generation';
      end if;

    when 'generate_creative_image', 'generate_creative_video' then
      v_cost := case when p_type = 'generate_creative_video' then 10 else 2 end;
      begin
        v_target_id := (p_payload->>'campaign_creative_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid creative id';
      end;
      if v_target_id is null or not exists (
        select 1 from public.campaign_creatives
        where id = v_target_id
          and workspace_id = p_workspace_id
          and status = 'generating'
      ) then
        raise exception 'Creative is not claimed for generation';
      end if;

    when 'generate_blog_image' then
      v_cost := 2;
      begin
        v_target_id := (p_payload->>'post_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid blog post id';
      end;
      if v_target_id is null or not exists (
        select 1 from public.blog_posts
        where id = v_target_id
          and workspace_id = p_workspace_id
          and featured_image_status = 'generating'
      ) then
        raise exception 'Blog post is not claimed for image generation';
      end if;

    when 'launch_ad' then
      v_cost := 0;
      begin
        v_campaign_id := (p_payload->>'campaign_id')::uuid;
        v_angle_index := (p_payload->>'angle_index')::integer;
        v_budget := (p_payload->>'budget_credits')::integer;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Invalid ad launch payload';
      end;
      v_kind := p_payload->>'creative_kind';
      if v_campaign_id is null
         or v_angle_index is null or v_angle_index < 0
         or v_budget is null or v_budget <= 0
         or coalesce(v_kind, '') not in ('image', 'video')
         or coalesce(p_payload->>'ad_account_id', '') = ''
         or coalesce(p_payload->>'page_id', '') = ''
         or coalesce(btrim(p_payload->>'headline'), '') = ''
         or coalesce(btrim(p_payload->>'primary_text'), '') = ''
         or coalesce(p_payload->>'destination', '') <> 'bridge'
         or not exists (
              select 1 from public.campaigns
              where id = v_campaign_id
                and workspace_id = p_workspace_id
                and bridge_published
                and case
                      when jsonb_typeof(fb_ad_angles) = 'array'
                        then jsonb_array_length(fb_ad_angles)
                      else 0
                    end > v_angle_index
            )
         or not exists (
              select 1 from public.meta_ad_accounts
              where workspace_id = p_workspace_id
                and ad_account_id = p_payload->>'ad_account_id'
            )
         or not exists (
              select 1 from public.meta_pages
              where workspace_id = p_workspace_id
                and page_id = p_payload->>'page_id'
            )
         or not exists (
              select 1 from public.campaign_creatives
              where workspace_id = p_workspace_id
                and campaign_id = v_campaign_id
                and source = 'fb_ad_angle'
                and item_index = v_angle_index
                and kind = v_kind
                and status = 'ready'
            )
         or exists (
              select 1 from public.ad_launches al
              where al.workspace_id = p_workspace_id
                and al.campaign_id = v_campaign_id
                and al.angle_index = v_angle_index
                and al.status in ('paused_review', 'activating', 'active')
            )
         or exists (
              select 1
              from public.ad_launches al
              join public.credits_ledger l
                on l.ad_launch_id = al.id and l.delta < 0
              where al.workspace_id = p_workspace_id
                and al.campaign_id = v_campaign_id
                and al.angle_index = v_angle_index
                and not exists (
                  select 1 from public.credits_ledger refund
                  where refund.ad_launch_id = al.id and refund.delta > 0
                )
            ) then
        raise exception 'Invalid ad launch job payload';
      end if;

    else
      raise exception 'Unsupported user job type';
  end case;

  perform pg_advisory_xact_lock(hashtextextended('credits:' || p_workspace_id::text, 0));

  -- Route-level "is one already open?" checks are only a latency optimization. This check runs
  -- under the same workspace lock as charging, so two concurrent requests cannot both miss and
  -- create separately charged jobs. Each key mirrors the user-visible operation's natural target.
  select j.id into v_existing_job_id
  from public.jobs j
  where j.workspace_id = p_workspace_id
    and j.status in ('pending', 'running')
    and (
      (p_type = 'discover_products' and j.type = p_type and j.payload = p_payload)
      or (p_type = 'build_campaign' and j.type = p_type
          and j.payload->>'product_id' = p_payload->>'product_id')
      or (p_type in ('generate_ad_image', 'generate_video') and j.type = p_type
          and j.payload->>'campaign_id' = p_payload->>'campaign_id')
      or (p_type in ('generate_creative_image', 'generate_creative_video') and j.type = p_type
          and j.payload->>'campaign_creative_id' = p_payload->>'campaign_creative_id')
      or (p_type = 'generate_blog_image' and j.type = p_type
          and j.payload->>'post_id' = p_payload->>'post_id')
      or (p_type = 'launch_ad' and j.type = p_type
          and j.payload->>'campaign_id' = p_payload->>'campaign_id'
          and j.payload->>'angle_index' = p_payload->>'angle_index')
    )
  order by j.created_at
  limit 1;

  if v_existing_job_id is not null then
    -- Transition safety for a direct insert that raced this migration's privilege revocation. An
    -- open paid job is never acknowledged unless a debit exists; if it does not, attach the fixed
    -- server-side price now. Catch-up charges may take the workspace negative because the work was
    -- already admitted before this gate existed.
    if v_cost > 0 and not exists (
      select 1 from public.credits_ledger
      where job_id = v_existing_job_id and delta < 0
    ) then
      v_balance := public.workspace_credit_balance(p_workspace_id);
      insert into public.credits_ledger (user_id, workspace_id, delta, reason, job_id)
      values (v_user_id, p_workspace_id, -v_cost, 'job: ' || p_type || ' (dedupe catch-up)', v_existing_job_id)
      on conflict do nothing;

      return jsonb_build_object(
        'ok', true,
        'job_id', v_existing_job_id,
        'charged', v_cost,
        'balance', v_balance - v_cost,
        'deduped', true
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'job_id', v_existing_job_id,
      'charged', 0,
      'balance', public.workspace_credit_balance(p_workspace_id),
      'deduped', true
    );
  end if;

  v_balance := public.workspace_credit_balance(p_workspace_id);

  if v_balance < v_cost then
    return jsonb_build_object(
      'ok', false,
      'code', 'insufficient_credits',
      'needed', v_cost,
      'balance', v_balance
    );
  end if;

  insert into public.jobs (user_id, workspace_id, type, payload, status)
  values (v_user_id, p_workspace_id, p_type, p_payload, 'pending')
  returning id into v_job_id;

  if v_cost > 0 then
    insert into public.credits_ledger (user_id, workspace_id, delta, reason, job_id)
    values (v_user_id, p_workspace_id, -v_cost, 'job: ' || p_type, v_job_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', v_job_id,
    'charged', v_cost,
    'balance', v_balance - v_cost,
    'deduped', false
  );
end;
$$;

revoke execute on function public.queue_job(uuid, text, jsonb) from public, anon;
grant execute on function public.queue_job(uuid, text, jsonb) to authenticated;

-- Replacing direct DELETE requires a narrow equivalent for the Jobs UI. Only terminal history may
-- be removed. Refunding and deleting fresh pending rows would create a free queue/cancel loop that
-- still fires the worker webhook, while deleting a retry could refund work whose provider cost was
-- already incurred. An error row gets one final idempotent refund attempt before its job key is
-- detached.
create or replace function public.delete_job(p_workspace_id uuid, p_job_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_job public.jobs;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace not found';
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id and workspace_id = p_workspace_id
  for update;

  if v_job.id is null then
    return false;
  end if;
  if v_job.status not in ('done', 'error') then
    raise exception 'Only completed jobs can be deleted';
  end if;

  if v_job.status = 'error' then
    perform public.refund_job_credits(v_job.id, 'refund: terminal job failure');
  end if;

  delete from public.jobs where id = v_job.id;
  return true;
end;
$$;

revoke execute on function public.delete_job(uuid, uuid) from public, anon;
grant execute on function public.delete_job(uuid, uuid) to authenticated;
