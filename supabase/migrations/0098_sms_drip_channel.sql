-- SMS drips reuse the broadcast machinery rather than a parallel set of tables. Applied 2026-08-17.
--
-- `channel` is to delivery what `kind` ('sequence'|'broadcast') is to presentation: one column, and
-- everything around it is already correct — broadcast_enrollments, the precomputed due_at that
-- keeps an un-due step out of the jobs queue, run_broadcast_sweep's admission control, the attempts
-- cap and terminal-failure mirroring all apply unchanged. A second set of tables would mean a second
-- scheduler, and the scheduler is the part that was hard to get right.
alter table public.broadcast_sequences
  add column if not exists channel text not null default 'email' check (channel in ('email', 'sms'));

comment on column public.broadcast_sequences.channel is
  'Delivery channel. email = sendViaActiveSender; sms = sendSmsToContact. Default email, so every existing sequence is unchanged.';

-- An SMS step has no subject. Rather than widen the NOT NULL (which would let an EMAIL step be
-- created without one — a real regression), sms steps store a short internal label there.
comment on column public.broadcast_steps.subject is
  'Email subject. For channel=sms this is an internal label only and is never sent.';

-- Enrollment becomes channel-aware, and this is the load-bearing half. Email excludes
-- unsubscribed_at; SMS requires phone AND sms_consent_at AND no sms_opted_out_at, and must NOT be
-- blocked by an email unsubscribe (0097: the two consents are legally distinct). Enforcing it here
-- means an ineligible contact never gets an enrollment row — no due step, no job — rather than
-- relying on the sender to refuse later. The sender re-checks anyway; two layers, same split as
-- every other trust boundary here.
create or replace function public.enroll_broadcast_sequence_contacts(p_sequence_id uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  with seq as (select * from public.broadcast_sequences where id = p_sequence_id and status = 'active'),
  matched as (
    select c.id as contact_id, seq.user_id, seq.id as sequence_id
    from public.contacts c, seq
    where c.user_id = seq.user_id
      and (
        (seq.channel = 'email' and c.unsubscribed_at is null)
        or (seq.channel = 'sms'
            and c.phone is not null
            and c.sms_consent_at is not null
            and c.sms_opted_out_at is null)
      )
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

-- create_broadcast_sequence gains a defaulted p_channel. The previous signature is DROPPED rather
-- than left alongside: keeping both makes every existing 4-arg call ambiguous to Postgres's
-- resolver (matching the old exactly AND the new via its default) — the problem 0035 documented
-- when it added p_kind.
drop function if exists public.create_broadcast_sequence(text, text, uuid, text);

create or replace function public.create_broadcast_sequence(
  p_name text, p_audience_type text, p_campaign_id uuid default null,
  p_kind text default 'sequence', p_channel text default 'email'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ws uuid;
begin
  v_ws := current_workspace_id();
  if v_ws is null then raise exception 'No active workspace'; end if;
  if p_audience_type not in ('all','campaign','manual') then raise exception 'Invalid audience type'; end if;
  if p_kind not in ('sequence','broadcast') then raise exception 'Invalid kind'; end if;
  if p_channel not in ('email','sms') then raise exception 'Invalid channel'; end if;
  if p_audience_type = 'campaign' then
    if p_campaign_id is null then raise exception 'Campaign audience needs a campaign'; end if;
    perform public.assert_owns_campaign(p_campaign_id);
  end if;
  insert into public.broadcast_sequences (workspace_id, user_id, name, audience_type, campaign_id, kind, channel, status)
  values (v_ws, auth.uid(), p_name, p_audience_type, p_campaign_id, p_kind, p_channel, 'draft')
  returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.create_broadcast_sequence(text, text, uuid, text, text) from public, anon;
grant execute on function public.create_broadcast_sequence(text, text, uuid, text, text) to authenticated;
