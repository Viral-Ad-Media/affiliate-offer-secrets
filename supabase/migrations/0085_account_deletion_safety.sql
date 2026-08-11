-- Account deletion must follow workspace ownership, not historical row authorship.
--
-- `workspace_id` is the owner of tenant data, while `user_id` is only the creator attribution
-- (0057/0059). Those creator columns still point directly at auth.users with ON DELETE CASCADE,
-- though, so deleting one member currently deletes every shared row they ever created. Keep a
-- PII-free attribution tombstone instead: application code retains the same non-null UUID shape,
-- shared rows survive, and no deleted email/profile data has to be retained.

create table if not exists public.account_attributions (
  user_id uuid primary key,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.account_attributions enable row level security;
revoke all on public.account_attributions from anon, authenticated;
grant all on public.account_attributions to service_role;

-- Keep the attribution registry complete for future signups. This is deliberately a separate
-- auth trigger from handle_new_user: attribution is a database invariant and must not depend on
-- the best-effort profile/workspace setup inside that function.
create or replace function public.register_account_attribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.account_attributions (user_id)
  values (new.id)
  on conflict (user_id) do update set deleted_at = null;
  return new;
end;
$$;

revoke execute on function public.register_account_attribution() from public, anon, authenticated;

drop trigger if exists on_auth_user_attribution_created on auth.users;
create trigger on_auth_user_attribution_created
  after insert on auth.users
  for each row execute function public.register_account_attribution();

-- Every existing creator is valid because the old foreign keys still point at auth.users. Install
-- the insert trigger first so a concurrent signup cannot land between this backfill and the trigger.
insert into public.account_attributions (user_id, created_at)
select u.id, coalesce(u.created_at, now())
from auth.users u
on conflict (user_id) do nothing;

-- Repoint every workspace-owned creator FK in the current schema. Deriving this from the
-- presence of workspace_id also covers workspace tables added after 0057 (and optional deployed
-- tables that are not present in every environment). workspace_members is intentionally excluded:
-- membership is person-scoped and should disappear when that person does.
do $$
declare
  r record;
begin
  for r in
    select c.conname, n.nspname, t.relname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute creator
        on creator.attrelid = t.oid
       and creator.attnum = c.conkey[1]
       and not creator.attisdropped
     where c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
       and array_length(c.conkey, 1) = 1
       and n.nspname = 'public'
       and creator.attname = 'user_id'
       and t.relname <> 'workspace_members'
       and exists (
         select 1
           from pg_attribute workspace_column
          where workspace_column.attrelid = t.oid
            and workspace_column.attname = 'workspace_id'
            and not workspace_column.attisdropped
       )
  loop
    execute format('alter table %I.%I drop constraint %I', r.nspname, r.relname, r.conname);
    execute format(
      'alter table %I.%I add constraint %I foreign key (user_id) references public.account_attributions(user_id) on delete restrict',
      r.nspname, r.relname, r.conname
    );
  end loop;
end;
$$;

-- Admin audit rows have the same need for durable attribution. This also fixes the impossible
-- actor_user_id NOT NULL / ON DELETE SET NULL combination from 0055: neither actor nor target is
-- erased when an auth identity is removed, and the actor column can remain correctly NOT NULL.
do $$
declare
  r record;
begin
  for r in
    select c.conname, a.attname
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = c.conkey[1]
       and not a.attisdropped
     where c.contype = 'f'
       and c.conrelid = 'public.admin_actions'::regclass
       and c.confrelid = 'auth.users'::regclass
       and array_length(c.conkey, 1) = 1
       and a.attname in ('actor_user_id', 'target_user_id')
  loop
    execute format('alter table public.admin_actions drop constraint %I', r.conname);
    execute format(
      'alter table public.admin_actions add constraint %I foreign key (%I) references public.account_attributions(user_id) on delete restrict',
      r.conname, r.attname
    );
  end loop;
end;
$$;

-- Final database guard. The app performs the same preflight for a useful 409 response, but only
-- this trigger closes the race with a concurrent invite/ownership change and protects deletions
-- made outside the app. Lock both the owned workspace and ownership rows before checking, reject
-- team workspaces, then explicitly delete sole-member workspaces so their data follows the
-- workspace_id cascades. Memberships in other workspaces still follow workspace_members' auth FK.
create or replace function public.prepare_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_blocked_workspaces text;
begin
  perform 1
    from public.workspaces w
    join public.workspace_members ownership
      on ownership.workspace_id = w.id
     and ownership.user_id = old.id
     and ownership.role = 'owner'
   for update of w, ownership;

  select string_agg(w.name, ', ' order by w.name)
    into v_blocked_workspaces
    from public.workspaces w
    join public.workspace_members ownership
      on ownership.workspace_id = w.id
     and ownership.user_id = old.id
     and ownership.role = 'owner'
   where exists (
     select 1
       from public.workspace_members other_member
      where other_member.workspace_id = w.id
        and other_member.user_id <> old.id
   );

  if v_blocked_workspaces is not null then
    raise exception using
      errcode = 'P0001',
      message = 'Transfer workspace ownership before deleting this account: ' || v_blocked_workspaces;
  end if;

  delete from public.workspaces w
   using public.workspace_members ownership
   where ownership.workspace_id = w.id
     and ownership.user_id = old.id
     and ownership.role = 'owner';

  update public.account_attributions
     set deleted_at = now()
   where user_id = old.id;

  return old;
end;
$$;

revoke execute on function public.prepare_account_deletion() from public, anon, authenticated;

drop trigger if exists before_auth_user_account_deletion on auth.users;
create trigger before_auth_user_account_deletion
  before delete on auth.users
  for each row execute function public.prepare_account_deletion();

-- Broadcast was created before workspaces and several RPCs still treated user_id as ownership.
-- Once creator UUIDs become durable attribution, those predicates would orphan an active shared
-- sequence after its author leaves. Replace the write/lifecycle boundary with workspace membership
-- and stamp every automation insert explicitly, including the service-role sweep (which has no
-- auth session from which the generic stamp trigger could recover a workspace).
create or replace function public.enroll_broadcast_sequence_contacts(p_sequence_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  with seq as (
    select * from public.broadcast_sequences
    where id = p_sequence_id and status = 'active'
  ),
  matched as (
    select c.id as contact_id, seq.user_id, seq.id as sequence_id, seq.workspace_id
    from public.contacts c, seq
    where c.workspace_id = seq.workspace_id
      and c.unsubscribed_at is null
      and (
        seq.audience_type = 'all'
        or (seq.audience_type = 'campaign' and c.campaign_id = seq.campaign_id)
        or (seq.audience_type = 'manual' and exists (
          select 1 from public.broadcast_sequence_contacts bsc
          where bsc.sequence_id = seq.id and bsc.contact_id = c.id
        ))
      )
  ),
  inserted as (
    insert into public.broadcast_enrollments (
      sequence_id, contact_id, user_id, workspace_id
    )
    select sequence_id, contact_id, user_id, workspace_id from matched
    on conflict (sequence_id, contact_id) do nothing
    returning id, user_id, workspace_id, enrolled_at
  ),
  steps_inserted as (
    insert into public.broadcast_enrollment_steps (
      enrollment_id, step_id, user_id, workspace_id, due_at
    )
    select
      i.id,
      s.id,
      i.user_id,
      i.workspace_id,
      i.enrolled_at + (s.delay_days || ' days')::interval
    from inserted i
    join public.broadcast_steps s
      on s.sequence_id = p_sequence_id and s.workspace_id = i.workspace_id
    on conflict (enrollment_id, step_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public.enroll_broadcast_sequence_contacts(uuid)
  from public, anon, authenticated;
grant execute on function public.enroll_broadcast_sequence_contacts(uuid) to service_role;

create or replace function public.is_capped_mail_workspace(p_workspace_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_provider text;
  v_host text;
begin
  select active_mail_provider into v_provider
  from public.workspaces
  where id = p_workspace_id;

  -- Missing configuration fails safe. Transactional providers carry their own plan limits; only
  -- SMTP pointed at a consumer-mailbox host needs the pooled 300/day protection here.
  if v_provider is null then
    return true;
  end if;
  if v_provider = 'smtp' then
    select smtp_host into v_host
    from public.mail_provider_connections
    where workspace_id = p_workspace_id and provider = 'smtp';
    return v_host is null
      or v_host ilike '%gmail%'
      or v_host ilike '%googlemail%'
      or v_host ilike '%yahoo%';
  end if;
  return false;
end;
$$;

revoke execute on function public.is_capped_mail_workspace(uuid)
  from public, anon, authenticated;
grant execute on function public.is_capped_mail_workspace(uuid) to service_role;

create or replace function public.run_broadcast_sweep()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_enrolled integer := 0;
  v_sequence record;
  v_queued integer := 0;
  v_scope record;
  v_remaining integer;
  v_step record;
  v_job_id uuid;
begin
  for v_sequence in
    select id from public.broadcast_sequences where status = 'active'
  loop
    v_enrolled := v_enrolled + public.enroll_broadcast_sequence_contacts(v_sequence.id);
  end loop;

  -- One cap per real sender/workspace, not per historical row author.
  for v_scope in
    select distinct bes.workspace_id
    from public.broadcast_enrollment_steps bes
    join public.broadcast_enrollments e
      on e.id = bes.enrollment_id and e.workspace_id = bes.workspace_id
    join public.broadcast_sequences seq
      on seq.id = e.sequence_id and seq.workspace_id = e.workspace_id
    where bes.status = 'pending' and bes.due_at <= now()
      and e.status = 'active'
      and seq.status = 'active'
  loop
    if public.is_capped_mail_workspace(v_scope.workspace_id) then
      select greatest(0, 300 - (
        (select count(*) from public.mail_sends
          where workspace_id = v_scope.workspace_id
            and created_at >= now() - interval '24 hours')
        + (select count(*) from public.broadcast_sends
          where workspace_id = v_scope.workspace_id
            and status = 'sent'
            and created_at >= now() - interval '24 hours')
      )) into v_remaining;
    else
      v_remaining := 1000000;
    end if;

    if v_remaining > 0 then
      for v_step in
        select bes.id, bes.user_id
        from public.broadcast_enrollment_steps bes
        join public.broadcast_enrollments e
          on e.id = bes.enrollment_id and e.workspace_id = bes.workspace_id
        join public.broadcast_sequences seq
          on seq.id = e.sequence_id and seq.workspace_id = e.workspace_id
        where bes.workspace_id = v_scope.workspace_id
          and bes.status = 'pending'
          and bes.due_at <= now()
          and e.status = 'active'
          and seq.status = 'active'
        order by bes.due_at asc
        limit v_remaining
      loop
        update public.broadcast_enrollment_steps
        set status = 'queued', updated_at = now()
        where id = v_step.id
          and workspace_id = v_scope.workspace_id
          and status = 'pending';

        if found then
          insert into public.jobs (user_id, workspace_id, type, payload, status)
          values (
            v_step.user_id,
            v_scope.workspace_id,
            'send_broadcast_email',
            jsonb_build_object('enrollment_step_id', v_step.id),
            'pending'
          )
          returning id into v_job_id;

          update public.broadcast_enrollment_steps
          set job_id = v_job_id
          where id = v_step.id and workspace_id = v_scope.workspace_id;
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

create or replace function public.update_broadcast_sequence(
  p_sequence_id uuid, p_name text, p_audience_type text, p_campaign_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.broadcast_sequences
  where id = p_sequence_id and status = 'draft';
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'sequence not found or not editable (must be draft)';
  end if;
  if p_audience_type not in ('campaign', 'all', 'manual') then
    raise exception 'invalid audience_type';
  end if;
  if p_audience_type = 'campaign' and (
    p_campaign_id is null or not exists (
      select 1 from public.campaigns
      where id = p_campaign_id and workspace_id = v_workspace_id
    )
  ) then
    raise exception 'campaign not found for this workspace';
  end if;

  update public.broadcast_sequences
  set name = coalesce(nullif(trim(p_name), ''), name),
      audience_type = p_audience_type,
      campaign_id = case when p_audience_type = 'campaign' then p_campaign_id else null end,
      updated_at = now()
  where id = p_sequence_id and workspace_id = v_workspace_id;
end;
$$;

create or replace function public.delete_broadcast_sequence(p_sequence_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.broadcast_sequences
  where id = p_sequence_id and public.is_workspace_member(workspace_id);
end;
$$;

create or replace function public.set_broadcast_sequence_contacts(
  p_sequence_id uuid, p_contact_ids uuid[]
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.broadcast_sequences
  where id = p_sequence_id and status = 'draft';
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'sequence not found or not editable (must be draft)';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_contact_ids, '{}'::uuid[])) cid
    where not exists (
      select 1 from public.contacts c
      where c.id = cid and c.workspace_id = v_workspace_id
    )
  ) then
    raise exception 'one or more contacts not found for this workspace';
  end if;

  delete from public.broadcast_sequence_contacts
  where sequence_id = p_sequence_id and workspace_id = v_workspace_id;
  insert into public.broadcast_sequence_contacts (
    sequence_id, contact_id, user_id, workspace_id
  )
  select p_sequence_id, cid, auth.uid(), v_workspace_id
  from unnest(coalesce(p_contact_ids, '{}'::uuid[])) cid;
end;
$$;

create or replace function public.upsert_broadcast_step(
  p_sequence_id uuid, p_step_index integer, p_delay_days integer,
  p_subject text, p_body_md text
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.broadcast_sequences
  where id = p_sequence_id and status in ('draft', 'paused');
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'sequence not found or not editable while active';
  end if;
  if p_delay_days < 0 then
    raise exception 'delay_days must be >= 0';
  end if;

  insert into public.broadcast_steps (
    sequence_id, user_id, workspace_id, step_index, delay_days, subject, body_md
  )
  values (
    p_sequence_id, auth.uid(), v_workspace_id, p_step_index, p_delay_days,
    coalesce(p_subject, ''), coalesce(p_body_md, '')
  )
  on conflict (sequence_id, step_index)
  do update set
    delay_days = excluded.delay_days,
    subject = excluded.subject,
    body_md = excluded.body_md,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_broadcast_step(p_step_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.broadcast_steps s
  using public.broadcast_sequences seq
  where s.id = p_step_id
    and s.sequence_id = seq.id
    and s.workspace_id = seq.workspace_id
    and seq.status in ('draft', 'paused')
    and public.is_workspace_member(seq.workspace_id);
end;
$$;

create or replace function public.activate_broadcast_sequence(p_sequence_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_sequence public.broadcast_sequences;
  v_step_count integer;
  v_enrolled integer;
begin
  select * into v_sequence
  from public.broadcast_sequences
  where id = p_sequence_id
  for update;
  if v_sequence.id is null or not public.is_workspace_member(v_sequence.workspace_id) then
    raise exception 'sequence not found';
  end if;
  if v_sequence.status = 'active' then
    raise exception 'sequence is already active';
  end if;
  select count(*) into v_step_count
  from public.broadcast_steps
  where sequence_id = p_sequence_id and workspace_id = v_sequence.workspace_id;
  if v_step_count = 0 then
    raise exception 'add at least one step before activating';
  end if;
  if v_sequence.audience_type = 'manual' and not exists (
    select 1 from public.broadcast_sequence_contacts
    where sequence_id = p_sequence_id and workspace_id = v_sequence.workspace_id
  ) then
    raise exception 'pick at least one contact before activating a manual-audience sequence';
  end if;

  update public.broadcast_sequences
  set status = 'active', updated_at = now()
  where id = p_sequence_id and workspace_id = v_sequence.workspace_id;
  v_enrolled := public.enroll_broadcast_sequence_contacts(p_sequence_id);
  return jsonb_build_object('enrolled', v_enrolled);
end;
$$;

create or replace function public.pause_broadcast_sequence(p_sequence_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.broadcast_sequences
  set status = 'paused', updated_at = now()
  where id = p_sequence_id
    and status = 'active'
    and public.is_workspace_member(workspace_id);
end;
$$;

create or replace function public.resume_broadcast_sequence(p_sequence_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.broadcast_sequences
  set status = 'active', updated_at = now()
  where id = p_sequence_id
    and status = 'paused'
    and public.is_workspace_member(workspace_id);
end;
$$;

-- CREATE OR REPLACE retains existing grants, but restate the public boundary so a future schema
-- default cannot make one of these SECURITY DEFINER writes callable by anon.
revoke execute on function public.update_broadcast_sequence(uuid, text, text, uuid) from public, anon;
revoke execute on function public.delete_broadcast_sequence(uuid) from public, anon;
revoke execute on function public.set_broadcast_sequence_contacts(uuid, uuid[]) from public, anon;
revoke execute on function public.upsert_broadcast_step(uuid, integer, integer, text, text) from public, anon;
revoke execute on function public.delete_broadcast_step(uuid) from public, anon;
revoke execute on function public.activate_broadcast_sequence(uuid) from public, anon;
revoke execute on function public.pause_broadcast_sequence(uuid) from public, anon;
revoke execute on function public.resume_broadcast_sequence(uuid) from public, anon;

grant execute on function public.update_broadcast_sequence(uuid, text, text, uuid) to authenticated;
grant execute on function public.delete_broadcast_sequence(uuid) to authenticated;
grant execute on function public.set_broadcast_sequence_contacts(uuid, uuid[]) to authenticated;
grant execute on function public.upsert_broadcast_step(uuid, integer, integer, text, text) to authenticated;
grant execute on function public.delete_broadcast_step(uuid) to authenticated;
grant execute on function public.activate_broadcast_sequence(uuid) to authenticated;
grant execute on function public.pause_broadcast_sequence(uuid) to authenticated;
grant execute on function public.resume_broadcast_sequence(uuid) to authenticated;

-- Workspace membership is the authorization boundary. The workspace migration widened these
-- helpers with `creator OR member`, but retaining the creator leg means a removed teammate can
-- keep mutating rows they originally made. Account attribution surviving deletion makes that
-- distinction especially important, so remove the creator bypass everywhere these helpers feed
-- an admin-client write.
create or replace function public.assert_owns_campaign(p_campaign_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.campaigns c
    where c.id = p_campaign_id
      and public.is_workspace_member(c.workspace_id)
  ) then
    raise exception 'Campaign not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_bridge_variant(p_variant_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bridge_variants v
    where v.id = p_variant_id
      and not v.is_control
      and public.is_workspace_member(v.workspace_id)
  ) then
    raise exception 'Variant not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_funnel_step(p_step_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.funnel_steps s
    where s.id = p_step_id
      and public.is_workspace_member(s.workspace_id)
  ) then
    raise exception 'Step not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_meta_ad_account(p_ad_account_id text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.meta_ad_accounts a
    where a.ad_account_id = p_ad_account_id
      and public.is_workspace_member(a.workspace_id)
  ) then
    raise exception 'Ad account not found for this account';
  end if;
  return true;
end;
$$;

revoke execute on function public.assert_owns_campaign(uuid) from public, anon;
revoke execute on function public.assert_owns_bridge_variant(uuid) from public, anon;
revoke execute on function public.assert_owns_funnel_step(uuid) from public, anon;
revoke execute on function public.assert_owns_meta_ad_account(text) from public, anon;
grant execute on function public.assert_owns_campaign(uuid) to authenticated;
grant execute on function public.assert_owns_bridge_variant(uuid) to authenticated;
grant execute on function public.assert_owns_funnel_step(uuid) to authenticated;
grant execute on function public.assert_owns_meta_ad_account(text) to authenticated;

-- 0071 moved the other Meta selectors to workspace scope but left this ad-account selector on
-- historical creator attribution. Use the same explicit workspace argument as set_active_meta_page
-- so a removed member cannot keep changing a workspace connection.
drop function if exists public.set_active_meta_ad_account(text);
create function public.set_active_meta_ad_account(
  p_ad_account_id text, p_workspace_id uuid default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  v_workspace_id := public.resolve_workspace_arg(p_workspace_id);
  if v_workspace_id is null or not exists (
    select 1 from public.meta_ad_accounts
    where workspace_id = v_workspace_id and ad_account_id = p_ad_account_id
  ) then
    raise exception 'Ad account not found for this account';
  end if;

  update public.meta_ad_accounts
  set is_active = false
  where workspace_id = v_workspace_id;
  update public.meta_ad_accounts
  set is_active = true
  where workspace_id = v_workspace_id and ad_account_id = p_ad_account_id;
end;
$$;

revoke execute on function public.set_active_meta_ad_account(text, uuid) from public, anon;
grant execute on function public.set_active_meta_ad_account(text, uuid) to authenticated;

-- Split-test lifecycle RPCs predate workspaces. Resolve every row through the campaign's owning
-- workspace, stamp new variants explicitly, and never use historical creator attribution as an
-- authorization predicate.
create or replace function public.start_bridge_split_test(p_campaign_id uuid)
returns setof public.bridge_variants
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('bridge_variants:' || p_campaign_id::text, 0));

  select c.workspace_id into v_workspace_id
  from public.campaigns c
  where c.id = p_campaign_id
    and c.status = 'ready'
    and c.bridge_html is not null;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Campaign not found or not ready to split test';
  end if;

  if exists (
    select 1 from public.bridge_variants
    where campaign_id = p_campaign_id and workspace_id = v_workspace_id
  ) then
    return query
      select v.* from public.bridge_variants v
      where v.campaign_id = p_campaign_id and v.workspace_id = v_workspace_id
      order by v.created_at;
    return;
  end if;

  insert into public.bridge_variants (
    user_id, workspace_id, campaign_id, label, is_control, weight
  )
  values (auth.uid(), v_workspace_id, p_campaign_id, 'Control', true, 50);

  insert into public.bridge_variants (
    user_id, workspace_id, campaign_id, label, is_control, weight,
    bridge_html, page_copy, embedded_image_data_url
  )
  select
    auth.uid(), v_workspace_id, p_campaign_id, 'B', false, 50,
    c.bridge_html, c.page_copy, c.embedded_image_data_url
  from public.campaigns c
  where c.id = p_campaign_id and c.workspace_id = v_workspace_id;

  return query
    select v.* from public.bridge_variants v
    where v.campaign_id = p_campaign_id and v.workspace_id = v_workspace_id
    order by v.created_at;
end;
$$;

create or replace function public.add_bridge_variant(p_campaign_id uuid)
returns public.bridge_variants
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_count integer;
  v_label text;
  v_row public.bridge_variants;
begin
  perform pg_advisory_xact_lock(hashtextextended('bridge_variants:' || p_campaign_id::text, 0));

  select c.workspace_id into v_workspace_id
  from public.campaigns c
  where c.id = p_campaign_id;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Campaign not found';
  end if;

  select count(*) into v_count
  from public.bridge_variants
  where campaign_id = p_campaign_id and workspace_id = v_workspace_id;
  if v_count = 0 then
    raise exception 'Start a split test first';
  end if;
  if v_count >= 5 then
    raise exception 'Maximum of 5 variants per campaign';
  end if;

  v_label := chr(ascii('A') + v_count);
  insert into public.bridge_variants (
    user_id, workspace_id, campaign_id, label, is_control, weight,
    bridge_html, page_copy, embedded_image_data_url
  )
  select
    auth.uid(), v_workspace_id, p_campaign_id, v_label, false, 50,
    c.bridge_html, c.page_copy, c.embedded_image_data_url
  from public.campaigns c
  where c.id = p_campaign_id and c.workspace_id = v_workspace_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_bridge_variant_weight(p_variant_id uuid, p_weight integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_weight < 1 or p_weight > 100 then
    raise exception 'weight must be between 1 and 100';
  end if;
  update public.bridge_variants
  set weight = p_weight, updated_at = now()
  where id = p_variant_id and public.is_workspace_member(workspace_id);
  if not found then
    raise exception 'variant not found';
  end if;
end;
$$;

create or replace function public.pause_bridge_variant(p_variant_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.bridge_variants
  set status = 'paused', updated_at = now()
  where id = p_variant_id and public.is_workspace_member(workspace_id);
  if not found then
    raise exception 'variant not found';
  end if;
end;
$$;

create or replace function public.resume_bridge_variant(p_variant_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.bridge_variants
  set status = 'active', updated_at = now()
  where id = p_variant_id and public.is_workspace_member(workspace_id);
  if not found then
    raise exception 'variant not found';
  end if;
end;
$$;

create or replace function public.delete_bridge_variant(p_variant_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.bridge_variants
    where id = p_variant_id
      and is_control
      and public.is_workspace_member(workspace_id)
  ) then
    raise exception 'Cannot delete the control variant directly — end the split test instead';
  end if;

  delete from public.bridge_variants
  where id = p_variant_id and public.is_workspace_member(workspace_id);
  if not found then
    raise exception 'variant not found';
  end if;
end;
$$;

create or replace function public.end_bridge_split_test(
  p_campaign_id uuid, p_promote_variant_id uuid default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_workspace_id uuid;
  v_winner public.bridge_variants;
begin
  perform pg_advisory_xact_lock(hashtextextended('bridge_variants:' || p_campaign_id::text, 0));

  select c.workspace_id into v_workspace_id
  from public.campaigns c
  where c.id = p_campaign_id;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Campaign not found';
  end if;

  if p_promote_variant_id is not null then
    select * into v_winner
    from public.bridge_variants
    where id = p_promote_variant_id
      and campaign_id = p_campaign_id
      and workspace_id = v_workspace_id
      and not is_control;
    if not found then
      raise exception 'variant not found';
    end if;

    update public.campaigns
    set bridge_html = v_winner.bridge_html,
        page_copy = v_winner.page_copy,
        embedded_image_data_url = v_winner.embedded_image_data_url
    where id = p_campaign_id and workspace_id = v_workspace_id;
  end if;

  delete from public.bridge_variants
  where campaign_id = p_campaign_id and workspace_id = v_workspace_id;
end;
$$;

revoke execute on function public.start_bridge_split_test(uuid) from public, anon;
revoke execute on function public.add_bridge_variant(uuid) from public, anon;
revoke execute on function public.update_bridge_variant_weight(uuid, integer) from public, anon;
revoke execute on function public.pause_bridge_variant(uuid) from public, anon;
revoke execute on function public.resume_bridge_variant(uuid) from public, anon;
revoke execute on function public.delete_bridge_variant(uuid) from public, anon;
revoke execute on function public.end_bridge_split_test(uuid, uuid) from public, anon;
grant execute on function public.start_bridge_split_test(uuid) to authenticated;
grant execute on function public.add_bridge_variant(uuid) to authenticated;
grant execute on function public.update_bridge_variant_weight(uuid, integer) to authenticated;
grant execute on function public.pause_bridge_variant(uuid) to authenticated;
grant execute on function public.resume_bridge_variant(uuid) to authenticated;
grant execute on function public.delete_bridge_variant(uuid) to authenticated;
grant execute on function public.end_bridge_split_test(uuid, uuid) to authenticated;

-- Campaign creative generation is another creator-scoped claim that writes through a definer
-- function. Preserve the original idempotent claim behavior while authorizing through the
-- campaign workspace and explicitly stamping new rows into that workspace.
create or replace function public.claim_campaign_creative(
  p_campaign_id uuid, p_source text, p_item_index integer, p_kind text
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_workspace_id uuid;
begin
  select c.workspace_id into v_workspace_id
  from public.campaigns c
  where c.id = p_campaign_id;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    raise exception 'Campaign not found for this account';
  end if;

  insert into public.campaign_creatives (
    user_id, workspace_id, campaign_id, source, item_index, kind, status
  )
  values (
    auth.uid(), v_workspace_id, p_campaign_id, p_source, p_item_index, p_kind, 'generating'
  )
  on conflict (campaign_id, source, item_index, kind)
  do update set status = 'generating', error = null, updated_at = now()
  where campaign_creatives.status <> 'generating'
    and campaign_creatives.workspace_id = v_workspace_id
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.claim_campaign_creative(uuid, text, integer, text)
  from public, anon;
grant execute on function public.claim_campaign_creative(uuid, text, integer, text)
  to authenticated;

-- Contact deletion and statutory erasure must cover the workspace's data regardless of which
-- member originally collected or sent it. Email erasure takes an explicit workspace because a
-- browser RPC cannot infer a workspace subdomain from the HTTP Host used by Next.js.
create or replace function public.cancel_contact_broadcast_jobs(
  p_workspace_id uuid, p_contact_ids uuid[]
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_affected integer;
begin
  update public.jobs j
  set stage_data = '{}'::jsonb,
      status = case when j.status in ('pending', 'running') then 'error' else j.status end,
      result = case
        when j.status in ('pending', 'running') then 'cancelled: contact erased or unsubscribed'
        else null
      end,
      locked_at = case when j.status in ('pending', 'running') then null else j.locked_at end,
      updated_at = now()
  where j.workspace_id = p_workspace_id
    and j.type = 'send_broadcast_email'
    and exists (
      select 1
      from public.broadcast_enrollment_steps bes
      join public.broadcast_enrollments e
        on e.id = bes.enrollment_id and e.workspace_id = bes.workspace_id
      where bes.id::text = j.payload->>'enrollment_step_id'
        and bes.workspace_id = p_workspace_id
        and e.contact_id = any(coalesce(p_contact_ids, '{}'::uuid[]))
    );
  get diagnostics v_affected = row_count;

  update public.broadcast_enrollment_steps bes
  set status = 'skipped', updated_at = now()
  from public.broadcast_enrollments e
  where e.id = bes.enrollment_id
    and e.workspace_id = bes.workspace_id
    and bes.workspace_id = p_workspace_id
    and e.contact_id = any(coalesce(p_contact_ids, '{}'::uuid[]))
    and bes.status in ('pending', 'queued');

  return v_affected;
end;
$$;

revoke execute on function public.cancel_contact_broadcast_jobs(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.cancel_contact_broadcast_jobs(uuid, uuid[]) to service_role;

-- Old workers persisted recipient email/token/body in stage_data. The new worker reloads every
-- value at send time, so scrub historical and open broadcast jobs during rollout as well as on
-- each future erasure.
update public.jobs
set stage_data = '{}'::jsonb, result = null, updated_at = now()
where type = 'send_broadcast_email'
  and (stage_data <> '{}'::jsonb or result is not null);

create or replace function public.delete_contact(p_contact_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_deleted integer;
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.contacts
  where id = p_contact_id;
  if v_workspace_id is null or not public.is_workspace_member(v_workspace_id) then
    return false;
  end if;

  perform public.cancel_contact_broadcast_jobs(v_workspace_id, array[p_contact_id]);
  delete from public.contacts
  where id = p_contact_id and workspace_id = v_workspace_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

drop function if exists public.erase_contact_email(text);
create function public.erase_contact_email(p_email text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_contacts integer;
  v_sends integer;
  v_broadcasts integer;
  v_contact_ids uuid[];
begin
  if v_email = '' or v_email is null then
    raise exception 'An email address is required';
  end if;
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'Workspace not found for this account';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_contact_ids
  from public.contacts
  where workspace_id = p_workspace_id and lower(email) = v_email;

  perform public.cancel_contact_broadcast_jobs(p_workspace_id, v_contact_ids);

  delete from public.contacts
  where workspace_id = p_workspace_id and lower(email) = v_email;
  get diagnostics v_contacts = row_count;

  update public.mail_sends
  set to_address = 'erased@redacted.invalid'
  where workspace_id = p_workspace_id and lower(to_address) = v_email;
  get diagnostics v_sends = row_count;

  update public.broadcast_sends
  set to_address = 'erased@redacted.invalid'
  where workspace_id = p_workspace_id and lower(to_address) = v_email;
  get diagnostics v_broadcasts = row_count;

  return jsonb_build_object(
    'contacts_deleted', v_contacts,
    'mail_sends_redacted', v_sends,
    'broadcast_sends_redacted', v_broadcasts
  );
end;
$$;

revoke execute on function public.delete_contact(uuid) from public, anon;
revoke execute on function public.erase_contact_email(text, uuid) from public, anon;
grant execute on function public.delete_contact(uuid) to authenticated;
grant execute on function public.erase_contact_email(text, uuid) to authenticated;

create index if not exists contacts_workspace_email_lower_idx
  on public.contacts (workspace_id, lower(email));
create index if not exists mail_sends_workspace_to_lower_idx
  on public.mail_sends (workspace_id, lower(to_address));
create index if not exists broadcast_sends_workspace_to_lower_idx
  on public.broadcast_sends (workspace_id, lower(to_address));
