-- Profile: split full_name into first/last, and add an avatar.
--
-- `full_name` was introduced in 0039 and holds no data yet, so this splits it rather than
-- carrying a redundant third column. If it ever HAD held data, the honest move would be a
-- backfill (split on the last space) — noted so a future reader doesn't copy this shortcut into
-- a case where rows actually exist.
alter table public.profiles drop column if exists full_name;

alter table public.profiles
  add column first_name text check (first_name is null or char_length(first_name) <= 60),
  add column last_name  text check (last_name  is null or char_length(last_name)  <= 60),
  -- Avatar is a data URL on the row, not Supabase Storage: it's one small square per account,
  -- read on every page load (the sidebar shows it), so a row read beats a Storage round trip plus
  -- signed-URL minting, and it reuses the image validation this codebase already has instead of
  -- adding a second bucket and a new public-serving surface.
  --
  -- The size cap is the load-bearing part — `profiles` is selected on every authenticated
  -- request, so an unbounded blob here would slow the whole app, not just this page. The client
  -- downscales to 256px first; this is the actual boundary.
  add column avatar_url text check (avatar_url is null or char_length(avatar_url) <= 400000);

-- Still the only client write path into `profiles` (SELECT-only RLS, see 0039) and still limited
-- to columns a user legitimately owns — never access_granted, trial_ends_at or
-- active_mail_provider.
create or replace function public.update_profile(
  p_first_name text,
  p_last_name text,
  p_timezone text,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_first text;
  v_last text;
  v_tz text;
  v_avatar text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  v_first := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last := nullif(btrim(coalesce(p_last_name, '')), '');
  v_tz := nullif(btrim(coalesce(p_timezone, '')), '');
  v_avatar := nullif(btrim(coalesce(p_avatar_url, '')), '');

  if char_length(coalesce(v_first, '')) > 60 or char_length(coalesce(v_last, '')) > 60 then
    raise exception 'Name is too long';
  end if;

  if v_tz is not null and not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'Unknown timezone: %', v_tz;
  end if;

  if v_avatar is not null then
    if char_length(v_avatar) > 400000 then
      raise exception 'Image is too large — use one under about 300KB';
    end if;
    -- Same allowlist as lib/images/validate.ts: png/jpeg/webp/gif, never svg. An avatar renders
    -- in-app via <img>, so an attacker-supplied SVG is the stored-XSS shape 0010 already closed
    -- for campaign images. Enforced here so a forged direct RPC call can't bypass the client.
    if v_avatar !~ '^data:image/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$' then
      raise exception 'Unsupported image format';
    end if;
  end if;

  update public.profiles
     set first_name = v_first,
         last_name = v_last,
         timezone = v_tz,
         -- Three states, not two: send an avatar to replace it, set p_clear_avatar to remove it,
         -- send neither to leave it alone. Without the explicit clear flag, saving the form
         -- without re-uploading would silently wipe an existing avatar.
         avatar_url = case
                        when p_clear_avatar then null
                        when v_avatar is not null then v_avatar
                        else avatar_url
                      end,
         updated_at = now()
   where id = auth.uid();
end;
$$;

revoke execute on function public.update_profile(text, text, text, text, boolean) from public, anon;
grant execute on function public.update_profile(text, text, text, text, boolean) to authenticated;

-- 0039's 2-arg signature has to go, or calls become ambiguous across the two overloads — the same
-- trap 0035 hit with create_broadcast_sequence.
drop function if exists public.update_profile(text, text);
