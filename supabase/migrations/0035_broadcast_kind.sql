-- Split the Emails section into "Broadcast" (one-off send) and "Sequences" (multi-step drip).
--
-- A one-off broadcast is structurally just a sequence with exactly one step at delay_days = 0, so
-- it reuses the ENTIRE existing delivery path unchanged — enrollment, run_broadcast_sweep()'s
-- pooled daily cap, the send_broadcast_email job, the code-owned unsubscribe footer,
-- broadcast_sends auditing and terminal-failure handling. This column exists only so the two
-- kinds can be listed separately in the UI; nothing in the delivery machinery reads it.
alter table public.broadcast_sequences
  add column kind text not null default 'sequence' check (kind in ('sequence', 'broadcast'));

-- create_broadcast_sequence gains a defaulted p_kind. The old 3-arg function is DROPPED rather
-- than left in place: keeping both would make an existing 3-arg call ambiguous to the resolver
-- (it matches the old function exactly AND the new one via its default). Dropping means today's
-- 3-arg call sites resolve to the new function with kind='sequence' — same behaviour as before.
drop function if exists public.create_broadcast_sequence(text, text, uuid);

create function public.create_broadcast_sequence(
  p_name text,
  p_audience_type text,
  p_campaign_id uuid,
  p_kind text default 'sequence'
) returns uuid language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if p_audience_type not in ('campaign', 'all', 'manual') then raise exception 'invalid audience_type'; end if;
  if p_kind not in ('sequence', 'broadcast') then raise exception 'invalid kind'; end if;
  if p_audience_type = 'campaign' and (p_campaign_id is null or not public.assert_owns_campaign(p_campaign_id)) then
    raise exception 'campaign not found or not owned by caller';
  end if;
  insert into public.broadcast_sequences (user_id, name, audience_type, campaign_id, kind)
  values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'Untitled sequence'), p_audience_type,
          case when p_audience_type = 'campaign' then p_campaign_id else null end, p_kind)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_broadcast_sequence(text, text, uuid, text) from public, anon;
grant execute on function public.create_broadcast_sequence(text, text, uuid, text) to authenticated;
