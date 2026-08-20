-- Lead moderation queue + deliverability gate. Captured leads whose email looks undeliverable or
-- junky (disposable domain, role mailbox — assessed synchronously in lib/email/deliverability.ts on
-- the public leads path, no MX lookup) are PARKED for review instead of flowing straight into a
-- send. This is the deferred-v1 gap CLAUDE.md names for /api/public/leads.
--
-- Default 'approved' so every existing row and every clean new lead behaves exactly as before —
-- the queue only ever holds what the assessor flagged. The operator approves (→ 'approved') or
-- deletes from Contacts. Enrollment (below) is taught to skip 'pending', so a flagged lead is never
-- emailed until a human clears it — the actual deliverability protection, not just a label.

alter table public.contacts
  add column if not exists review_status text not null default 'approved'
    check (review_status in ('approved', 'pending')),
  add column if not exists review_reason text;

-- Only the pending rows are ever listed as a queue; index just those, newest first, per workspace.
create index if not exists contacts_pending_review_idx
  on public.contacts (workspace_id, created_at desc)
  where review_status = 'pending';

-- Enrollment now enrolls ONLY approved contacts. One added predicate on the existing 0085 function;
-- everything else is copied verbatim so the change is auditable as exactly that one line. Because
-- review_status defaults 'approved', no existing contact's enrollment behaviour changes.
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
      and c.review_status = 'approved'   -- moderation gate (0120): pending leads are held back
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

revoke execute on function public.enroll_broadcast_sequence_contacts(uuid) from public, anon, authenticated;
grant execute on function public.enroll_broadcast_sequence_contacts(uuid) to service_role;
