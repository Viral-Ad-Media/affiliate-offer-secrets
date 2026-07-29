-- Phase K: Broadcast — full autoresponder/drip-sequence email feature. Reuses jobs/claim_job()/
-- worker.ts unchanged; the only new infra is one pg_cron backstop (broadcast-sweep-backstop,
-- registered separately via execute_sql, not committed here — same convention as
-- engine_webhook_url/domains_reverify_url) that finds due work and inserts already-due `jobs`
-- rows, exactly like domains-reverify-backstop's shape (0009_page_domains.sql) — claim_job() has
-- no time-gating, so a step that isn't due yet must never become a jobs row.

-- Global per-contact unsubscribe. unsub_token is a SECOND unguessable uuid, deliberately not
-- contacts.id itself — reusing the row's own PK as a public token would let anyone who's ever
-- observed a contact_id unsubscribe that address without it ever having received an email.
alter table public.contacts
  add column unsubscribed_at timestamptz,
  add column unsub_token uuid not null default gen_random_uuid();

create unique index contacts_unsub_token_idx on public.contacts (unsub_token);

-- Design-review fix: the pooled rate-cap check in run_broadcast_sweep() queries mail_sends by
-- (user_id, created_at) every sweep tick — mail_sends has never had an index beyond its RLS
-- policy scan. Cheap, additive, needed the moment this query becomes a per-minute cron cost.
create index mail_sends_user_id_created_at_idx on public.mail_sends (user_id, created_at);

-- One row per named drip sequence. audience_type drives matching in
-- enroll_broadcast_sequence_contacts() below. No CHECK coupling audience_type='campaign' to
-- campaign_id is not null — deliberately: campaign_id is `on delete set null`, and a CHECK here
-- would make deleting a campaign that still backs an active sequence FAIL instead of leaving the
-- sequence inert. The coupling is enforced at write time in the RPCs instead (same "shape
-- enforced in app code, not a DB CHECK" precedent as fb_ad_angles/page_copy).
create table public.broadcast_sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  audience_type text not null check (audience_type in ('campaign', 'all', 'manual')),
  campaign_id uuid references public.campaigns(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index broadcast_sequences_user_id_idx on public.broadcast_sequences(user_id);

alter table public.broadcast_sequences enable row level security;
create policy "own broadcast sequences" on public.broadcast_sequences for select using (auth.uid() = user_id);
revoke insert, update, delete on public.broadcast_sequences from anon, authenticated;
grant all on public.broadcast_sequences to service_role;

-- Frozen, explicitly-picked contact set for audience_type = 'manual' only.
create table public.broadcast_sequence_contacts (
  sequence_id uuid not null references public.broadcast_sequences(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sequence_id, contact_id)
);

alter table public.broadcast_sequence_contacts enable row level security;
create policy "own broadcast sequence contacts" on public.broadcast_sequence_contacts for select using (auth.uid() = user_id);
revoke insert, update, delete on public.broadcast_sequence_contacts from anon, authenticated;
grant all on public.broadcast_sequence_contacts to service_role;

-- One row per step. delay_days is measured from the CONTACT's own enrolled_at — standard ESP
-- semantics ("day 3 after this contact signed up"), never a shared calendar date.
create table public.broadcast_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.broadcast_sequences(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  step_index integer not null check (step_index >= 0),
  delay_days integer not null check (delay_days >= 0),
  subject text not null,
  body_md text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, step_index)
);

alter table public.broadcast_steps enable row level security;
create policy "own broadcast steps" on public.broadcast_steps for select using (auth.uid() = user_id);
revoke insert, update, delete on public.broadcast_steps from anon, authenticated;
grant all on public.broadcast_steps to service_role;

-- One row per (sequence, contact) — the contact's own clock. unique(sequence_id, contact_id) is
-- the idempotency guard against double-enrollment when activate_broadcast_sequence()'s
-- retroactive pass races a later sweep tick's continuous-enrollment pass, or two sweep ticks
-- race each other.
create table public.broadcast_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.broadcast_sequences(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'unsubscribed')),
  unique (sequence_id, contact_id)
);

create index broadcast_enrollments_user_id_idx on public.broadcast_enrollments(user_id);
create index broadcast_enrollments_sequence_id_idx on public.broadcast_enrollments(sequence_id);

alter table public.broadcast_enrollments enable row level security;
create policy "own broadcast enrollments" on public.broadcast_enrollments for select using (auth.uid() = user_id);
revoke insert, update, delete on public.broadcast_enrollments from anon, authenticated;
grant all on public.broadcast_enrollments to service_role;

-- The actual schedule: one row per (enrollment, step), created all at once at enrollment time
-- from that sequence's CURRENT steps. Editing a sequence's steps after contacts are already
-- enrolled does NOT retroactively reschedule them (see CLAUDE.md's "does not include"). due_at is
-- a real precomputed timestamp — this IS the mechanism that keeps claim_job()'s total lack of
-- time-gating a non-issue: nothing ever inserts a `jobs` row from this table until
-- run_broadcast_sweep() finds status='pending' and due_at <= now(); a pending row sitting here
-- for days is completely inert to claim_job().
create table public.broadcast_enrollment_steps (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.broadcast_enrollments(id) on delete cascade,
  step_id uuid not null references public.broadcast_steps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'queued', 'sent', 'failed', 'skipped')),
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, step_id)
);

create index broadcast_enrollment_steps_due_idx on public.broadcast_enrollment_steps(due_at) where status = 'pending';
create index broadcast_enrollment_steps_user_id_idx on public.broadcast_enrollment_steps(user_id);

alter table public.broadcast_enrollment_steps enable row level security;
create policy "own broadcast enrollment steps" on public.broadcast_enrollment_steps for select using (auth.uid() = user_id);
revoke insert, update, delete on public.broadcast_enrollment_steps from anon, authenticated;
grant all on public.broadcast_enrollment_steps to service_role;

-- Audit-trail table, same owner-select-only/admin-write shape as mail_sends — kept SEPARATE
-- from mail_sends on purpose (that's SendEmail.tsx's one-off audit log; this is Broadcast's).
-- Pooling their COUNTS for the rate cap is a different concern from pooling their ROWS.
-- sequence_id/step_id are on delete set null (history worth keeping, same precedent as
-- contacts.campaign_id); enrollment_step_id is on delete cascade (dependent record, matches
-- ad_launches.campaign_id's cascade precedent). campaign_id is denormalized from the sequence at
-- send time so /audit's existing titleByCampaign join pattern needs zero changes.
create table public.broadcast_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence_id uuid references public.broadcast_sequences(id) on delete set null,
  step_id uuid references public.broadcast_steps(id) on delete set null,
  enrollment_step_id uuid references public.broadcast_enrollment_steps(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  to_address text not null,
  subject text not null,
  message_id text,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

create index broadcast_sends_user_id_idx on public.broadcast_sends(user_id);

alter table public.broadcast_sends enable row level security;
create policy "own broadcast sends" on public.broadcast_sends for select using (auth.uid() = user_id);
revoke insert, update, delete on public.broadcast_sends from anon, authenticated;
grant all on public.broadcast_sends to service_role;

-- ==== Sequence CRUD — mirrors add_domain_route's ownership-check idiom ====

create or replace function public.create_broadcast_sequence(p_name text, p_audience_type text, p_campaign_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if p_audience_type not in ('campaign', 'all', 'manual') then raise exception 'invalid audience_type'; end if;
  if p_audience_type = 'campaign' and (p_campaign_id is null or not public.assert_owns_campaign(p_campaign_id)) then
    raise exception 'campaign not found or not owned by caller';
  end if;
  insert into public.broadcast_sequences (user_id, name, audience_type, campaign_id)
  values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'Untitled sequence'), p_audience_type,
          case when p_audience_type = 'campaign' then p_campaign_id else null end)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_broadcast_sequence(text, text, uuid) from public, anon;
grant execute on function public.create_broadcast_sequence(text, text, uuid) to authenticated;

create or replace function public.update_broadcast_sequence(p_sequence_id uuid, p_name text, p_audience_type text, p_campaign_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.broadcast_sequences where id = p_sequence_id and user_id = auth.uid() and status = 'draft') then
    raise exception 'sequence not found, not owned by caller, or not editable (must be draft)';
  end if;
  if p_audience_type not in ('campaign', 'all', 'manual') then raise exception 'invalid audience_type'; end if;
  if p_audience_type = 'campaign' and (p_campaign_id is null or not public.assert_owns_campaign(p_campaign_id)) then
    raise exception 'campaign not found or not owned by caller';
  end if;
  update public.broadcast_sequences
  set name = coalesce(nullif(trim(p_name), ''), name), audience_type = p_audience_type,
      campaign_id = case when p_audience_type = 'campaign' then p_campaign_id else null end, updated_at = now()
  where id = p_sequence_id;
end;
$$;
revoke execute on function public.update_broadcast_sequence(uuid, text, text, uuid) from public, anon;
grant execute on function public.update_broadcast_sequence(uuid, text, text, uuid) to authenticated;

create or replace function public.delete_broadcast_sequence(p_sequence_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin delete from public.broadcast_sequences where id = p_sequence_id and user_id = auth.uid(); end; $$;
revoke execute on function public.delete_broadcast_sequence(uuid) from public, anon;
grant execute on function public.delete_broadcast_sequence(uuid) to authenticated;

-- ==== Manual audience — full-replace, re-checks EVERY id, not just the sequence (mirrors
-- add_domain_route's "check both sides" idiom — p_contact_ids is caller-supplied). ====
create or replace function public.set_broadcast_sequence_contacts(p_sequence_id uuid, p_contact_ids uuid[])
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.broadcast_sequences where id = p_sequence_id and user_id = auth.uid() and status = 'draft') then
    raise exception 'sequence not found, not owned by caller, or not editable (must be draft)';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_contact_ids, '{}'::uuid[])) cid
    where not exists (select 1 from public.contacts c where c.id = cid and c.user_id = auth.uid())
  ) then
    raise exception 'one or more contacts not found or not owned by caller';
  end if;
  delete from public.broadcast_sequence_contacts where sequence_id = p_sequence_id;
  insert into public.broadcast_sequence_contacts (sequence_id, contact_id, user_id)
  select p_sequence_id, cid, auth.uid() from unnest(coalesce(p_contact_ids, '{}'::uuid[])) cid;
end;
$$;
revoke execute on function public.set_broadcast_sequence_contacts(uuid, uuid[]) from public, anon;
grant execute on function public.set_broadcast_sequence_contacts(uuid, uuid[]) to authenticated;

-- ==== Step CRUD — editable while draft or paused, frozen while active ====
create or replace function public.upsert_broadcast_step(p_sequence_id uuid, p_step_index integer, p_delay_days integer, p_subject text, p_body_md text)
returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.broadcast_sequences where id = p_sequence_id and user_id = auth.uid() and status in ('draft', 'paused')) then
    raise exception 'sequence not found, not owned by caller, or not editable while active';
  end if;
  if p_delay_days < 0 then raise exception 'delay_days must be >= 0'; end if;
  insert into public.broadcast_steps (sequence_id, user_id, step_index, delay_days, subject, body_md)
  values (p_sequence_id, auth.uid(), p_step_index, p_delay_days, coalesce(p_subject, ''), coalesce(p_body_md, ''))
  on conflict (sequence_id, step_index)
  do update set delay_days = excluded.delay_days, subject = excluded.subject, body_md = excluded.body_md, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.upsert_broadcast_step(uuid, integer, integer, text, text) from public, anon;
grant execute on function public.upsert_broadcast_step(uuid, integer, integer, text, text) to authenticated;

create or replace function public.delete_broadcast_step(p_step_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  delete from public.broadcast_steps s using public.broadcast_sequences seq
  where s.id = p_step_id and s.sequence_id = seq.id and seq.user_id = auth.uid() and seq.status in ('draft', 'paused');
end;
$$;
revoke execute on function public.delete_broadcast_step(uuid) from public, anon;
grant execute on function public.delete_broadcast_step(uuid) to authenticated;

-- ==== Enrollment — shared by activation AND the sweep, idempotent, service_role only ====
-- Enrolls every currently-matching, not-already-enrolled, not-unsubscribed contact, and creates
-- that enrollment's full step schedule from the sequence's CURRENT steps. Returns count of NEW
-- enrollments. A null seq.campaign_id (audience_type='campaign' whose campaign was deleted)
-- fails safe automatically — `c.campaign_id = seq.campaign_id` never matches under standard
-- NULL semantics, no special-casing needed.
create or replace function public.enroll_broadcast_sequence_contacts(p_sequence_id uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  with seq as (select * from public.broadcast_sequences where id = p_sequence_id and status = 'active'),
  matched as (
    select c.id as contact_id, seq.user_id, seq.id as sequence_id
    from public.contacts c, seq
    where c.user_id = seq.user_id and c.unsubscribed_at is null
      and (
        (seq.audience_type = 'all')
        or (seq.audience_type = 'campaign' and c.campaign_id = seq.campaign_id)
        or (seq.audience_type = 'manual' and exists (
              select 1 from public.broadcast_sequence_contacts bsc where bsc.sequence_id = seq.id and bsc.contact_id = c.id))
      )
  ),
  inserted as (
    insert into public.broadcast_enrollments (sequence_id, contact_id, user_id)
    select sequence_id, contact_id, user_id from matched
    on conflict (sequence_id, contact_id) do nothing
    returning id, user_id, enrolled_at
  ),
  steps_inserted as (
    insert into public.broadcast_enrollment_steps (enrollment_id, step_id, user_id, due_at)
    select i.id, s.id, i.user_id, i.enrolled_at + (s.delay_days || ' days')::interval
    from inserted i cross join public.broadcast_steps s where s.sequence_id = p_sequence_id
    on conflict (enrollment_id, step_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return coalesce(v_count, 0);
end;
$$;
revoke execute on function public.enroll_broadcast_sequence_contacts(uuid) from public, anon, authenticated;
grant execute on function public.enroll_broadcast_sequence_contacts(uuid) to service_role;

-- ==== Lifecycle ====
create or replace function public.activate_broadcast_sequence(p_sequence_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_seq public.broadcast_sequences; v_step_count integer; v_enrolled integer;
begin
  select * into v_seq from public.broadcast_sequences where id = p_sequence_id and user_id = auth.uid() for update;
  if v_seq.id is null then raise exception 'sequence not found or not owned by caller'; end if;
  if v_seq.status = 'active' then raise exception 'sequence is already active'; end if;

  select count(*) into v_step_count from public.broadcast_steps where sequence_id = p_sequence_id;
  if v_step_count = 0 then raise exception 'add at least one step before activating'; end if;
  if v_seq.audience_type = 'manual' and not exists (select 1 from public.broadcast_sequence_contacts where sequence_id = p_sequence_id) then
    raise exception 'pick at least one contact before activating a manual-audience sequence';
  end if;

  update public.broadcast_sequences set status = 'active', updated_at = now() where id = p_sequence_id;

  -- Retroactive enrollment, synchronous, same transaction — a pure set-based INSERT...SELECT
  -- over rows this tenant already owns, no email actually sent here (even a day-0 step's due_at
  -- is "now", but nothing sends until the next sweep tick claims it — see run_broadcast_sweep).
  select public.enroll_broadcast_sequence_contacts(p_sequence_id) into v_enrolled;
  return jsonb_build_object('enrolled', v_enrolled);
end;
$$;
revoke execute on function public.activate_broadcast_sequence(uuid) from public, anon;
grant execute on function public.activate_broadcast_sequence(uuid) to authenticated;

create or replace function public.pause_broadcast_sequence(p_sequence_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin update public.broadcast_sequences set status = 'paused', updated_at = now() where id = p_sequence_id and user_id = auth.uid() and status = 'active'; end; $$;
revoke execute on function public.pause_broadcast_sequence(uuid) from public, anon;
grant execute on function public.pause_broadcast_sequence(uuid) to authenticated;

create or replace function public.resume_broadcast_sequence(p_sequence_id uuid)
returns void language plpgsql security definer set search_path = public
as $$ begin update public.broadcast_sequences set status = 'active', updated_at = now() where id = p_sequence_id and user_id = auth.uid() and status = 'paused'; end; $$;
revoke execute on function public.resume_broadcast_sequence(uuid) from public, anon;
grant execute on function public.resume_broadcast_sequence(uuid) to authenticated;

-- ==== The sweep — the ONLY place (besides activate's retroactive pass) that enrolls a contact
-- or inserts a `jobs` row for Broadcast. Called every minute by broadcast-sweep-backstop via
-- app/api/broadcast/sweep/route.ts (same x-engine-secret trust boundary as every cron route). ====
create or replace function public.run_broadcast_sweep()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_enrolled integer := 0; v_seq record; v_queued integer := 0;
  v_user record; v_remaining integer; v_step record; v_job_id uuid;
begin
  -- (1) Continuous enrollment for every active sequence — catches contacts that started
  -- matching AFTER activation. Naturally a no-op for 'manual' audiences (frozen pick).
  for v_seq in select id from public.broadcast_sequences where status = 'active' loop
    v_enrolled := v_enrolled + public.enroll_broadcast_sequence_contacts(v_seq.id);
  end loop;

  -- (2)+(3) Per-user, rate-capped claim-and-queue of due steps, oldest-due first so a backlog
  -- (e.g. after pause->resume) drains fairly. Cap pools mail_sends + broadcast_sends — same
  -- Gmail account, same real daily limit. 300/day is a nominal headroom figure under Gmail's
  -- free-tier ~500/day, leaving room for manual test sends — revisit before opening this beyond
  -- solo testing, same caveat shape as every other nominal cap in this codebase.
  for v_user in
    select distinct bes.user_id from public.broadcast_enrollment_steps bes
    where bes.status = 'pending' and bes.due_at <= now()
  loop
    select greatest(0, 300 - (
      (select count(*) from public.mail_sends where user_id = v_user.user_id and created_at >= now() - interval '24 hours')
      + (select count(*) from public.broadcast_sends where user_id = v_user.user_id and status = 'sent' and created_at >= now() - interval '24 hours')
    )) into v_remaining;

    if v_remaining > 0 then
      for v_step in
        select bes.id from public.broadcast_enrollment_steps bes
        join public.broadcast_enrollments e on e.id = bes.enrollment_id
        where bes.user_id = v_user.user_id and bes.status = 'pending' and bes.due_at <= now() and e.status = 'active'
        order by bes.due_at asc limit v_remaining
      loop
        -- Atomic claim, same idiom as claim_campaign_creative's conditional UPDATE — guards
        -- against a concurrent sweep tick double-queueing the same step.
        update public.broadcast_enrollment_steps set status = 'queued', updated_at = now()
        where id = v_step.id and status = 'pending';
        if found then
          insert into public.jobs (user_id, type, payload, status)
          values (v_user.user_id, 'send_broadcast_email', jsonb_build_object('enrollment_step_id', v_step.id), 'pending')
          returning id into v_job_id;
          update public.broadcast_enrollment_steps set job_id = v_job_id where id = v_step.id;
          v_queued := v_queued + 1;
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('enrolled', v_enrolled, 'queued', v_queued);
end;
$$;
revoke execute on function public.run_broadcast_sweep() from public, anon, authenticated;
grant execute on function public.run_broadcast_sweep() to service_role;
