-- Profile + Settings.
--
-- `profiles` is deliberately SELECT-only for clients (the general update policy was dropped in
-- 0002_trial.sql because it let a user self-grant access_granted). So every profile edit goes
-- through a narrow SECURITY DEFINER RPC that can only touch the columns a user legitimately owns
-- — never access_granted, trial_ends_at, or active_mail_provider. Do NOT re-add a general update
-- policy to make a settings form simpler; that is exactly the hole 0002 closed.

alter table public.profiles
  add column full_name text check (full_name is null or char_length(full_name) <= 120),
  -- IANA zone name, validated against pg_timezone_names at write time (see below) rather than by
  -- a CHECK, since the zone list ships with the server and changes with tzdata updates — a CHECK
  -- would turn a future tzdata change into a constraint violation on existing rows.
  add column timezone text;

create or replace function public.update_profile(p_full_name text, p_timezone text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_name text;
  v_tz text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- Empty string means "cleared", not "a name that is the empty string".
  v_name := nullif(btrim(coalesce(p_full_name, '')), '');
  v_tz := nullif(btrim(coalesce(p_timezone, '')), '');

  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'Name is too long';
  end if;

  if v_tz is not null and not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'Unknown timezone: %', v_tz;
  end if;

  update public.profiles
     set full_name = v_name,
         timezone = v_tz,
         updated_at = now()
   where id = auth.uid();
end;
$$;

revoke execute on function public.update_profile(text, text) from public, anon;
grant execute on function public.update_profile(text, text) to authenticated;
