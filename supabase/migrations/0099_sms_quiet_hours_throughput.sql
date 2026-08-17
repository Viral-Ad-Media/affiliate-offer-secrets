-- Two limits that decide whether a drip is legal and whether it survives contact with a carrier.
-- Applied 2026-08-17.
--
-- QUIET HOURS. US rules (TCPA) forbid marketing texts outside 8am-9pm in the RECIPIENT's local
-- time, and carriers enforce their own version regardless. We store a window and a timezone on the
-- connection because that is the honest thing this app can know:
--
--   *** This is the SENDER's timezone, not the recipient's. ***
--
-- Mapping a number to a timezone means an area-code table that is wrong for every ported mobile,
-- and being confidently wrong about a legal window is worse than being explicitly approximate. The
-- default window is deliberately TIGHTER than the legal one (9-20 rather than 8-21) so a sender in
-- a neighbouring timezone still lands inside it. Said in the UI, not only here.
--
-- THROUGHPUT. A Twilio long code sends about one message per second; exceeding it doesn't fail
-- loudly, it queues at the carrier and arrives late or gets filtered. Per-minute rather than
-- per-second because the sweep claims work in batches.
alter table public.sms_connections
  add column if not exists quiet_hours_start smallint not null default 9
    check (quiet_hours_start between 0 and 23),
  add column if not exists quiet_hours_end smallint not null default 20
    check (quiet_hours_end between 0 and 23),
  add column if not exists quiet_hours_tz text not null default 'UTC',
  add column if not exists messages_per_minute smallint not null default 30
    check (messages_per_minute between 1 and 600);

comment on column public.sms_connections.quiet_hours_tz is
  'IANA timezone the quiet-hours window is evaluated in. The SENDER''s zone — this app cannot know the recipient''s without an area-code table that is wrong for every ported number.';

-- Timezone validated against the real tz database rather than a CHECK, so a future tzdata change
-- can't invalidate stored rows — the call update_profile() already makes for profiles.timezone.
create or replace function public.set_sms_sending_limits(
  p_quiet_start smallint, p_quiet_end smallint, p_tz text, p_per_minute smallint
) returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  v_ws := current_workspace_id();
  if v_ws is null or not is_workspace_member(v_ws) then raise exception 'No active workspace'; end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then raise exception 'Unknown timezone'; end if;
  update public.sms_connections
     set quiet_hours_start = p_quiet_start, quiet_hours_end = p_quiet_end,
         quiet_hours_tz = p_tz, messages_per_minute = p_per_minute, updated_at = now()
   where workspace_id = v_ws;
end; $$;

revoke all on function public.set_sms_sending_limits(smallint, smallint, text, smallint) from public, anon;
grant execute on function public.set_sms_sending_limits(smallint, smallint, text, smallint) to authenticated;
