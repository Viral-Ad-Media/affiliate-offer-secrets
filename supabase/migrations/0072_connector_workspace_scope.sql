-- The rest of the connectors, same fix as 0071 did for Meta.
--
-- TikTok, YouTube, Gmail, the mail providers, Everflow and the affiliate networks all still keyed
-- their UNIQUE constraints and their status/disconnect RPCs on user_id, even though Phase 2 gave
-- every one of them a workspace_id. Identical consequences: a user in two workspaces could only
-- ever connect once, and a teammate who did not personally run the connect flow saw "not
-- connected" for a workspace that is connected.
--
-- Zero duplicates exist under any of the new constraints (checked before applying: everflow/
-- mail_connections/tiktok/youtube/tiktok_posts/youtube_posts are empty, mail_provider_connections
-- has 1 row, network_connections 3 rows across 3 distinct workspaces).
--
-- One thing here is NOT just a re-key: profiles.active_mail_provider. See below.

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------

alter table public.everflow_connections drop constraint if exists everflow_connections_user_id_key;
alter table public.everflow_connections add constraint everflow_connections_workspace_id_key unique (workspace_id);

alter table public.mail_connections drop constraint if exists mail_connections_user_id_key;
alter table public.mail_connections add constraint mail_connections_workspace_id_key unique (workspace_id);

alter table public.tiktok_connections drop constraint if exists tiktok_connections_user_id_key;
alter table public.tiktok_connections add constraint tiktok_connections_workspace_id_key unique (workspace_id);

alter table public.youtube_connections drop constraint if exists youtube_connections_user_id_key;
alter table public.youtube_connections add constraint youtube_connections_workspace_id_key unique (workspace_id);

alter table public.mail_provider_connections drop constraint if exists mail_provider_connections_user_id_provider_key;
alter table public.mail_provider_connections add constraint mail_provider_connections_workspace_id_provider_key unique (workspace_id, provider);

alter table public.network_connections drop constraint if exists network_connections_user_id_network_key;
alter table public.network_connections add constraint network_connections_workspace_id_network_key unique (workspace_id, network);

alter table public.tiktok_posts drop constraint if exists tiktok_posts_user_id_idempotency_key_key;
alter table public.tiktok_posts add constraint tiktok_posts_workspace_id_idempotency_key_key unique (workspace_id, idempotency_key);

alter table public.youtube_posts drop constraint if exists youtube_posts_user_id_idempotency_key_key;
alter table public.youtube_posts add constraint youtube_posts_workspace_id_idempotency_key_key unique (workspace_id, idempotency_key);

-- ---------------------------------------------------------------------------
-- The active mail sender moves from the person to the workspace.
--
-- This one is a real bug, not just an inconsistency. lib/mail/send.ts read the provider NAME from
-- profiles.active_mail_provider (keyed by user) and then looked the CONNECTION up by workspace_id
-- -- a split-brain that only works while every workspace has exactly one member. Concretely: the
-- Broadcast engine passes job.user_id, so whichever member happened to create a sequence decided
-- which provider the whole workspace sent through, and if that person's personal pointer named a
-- provider the workspace had not connected, every send in that sequence failed "not_connected"
-- with nothing in the UI explaining why.
--
-- profiles.active_mail_provider is left in place as an unread legacy mirror rather than dropped --
-- same call already made for profiles.nickname in 0015.
-- ---------------------------------------------------------------------------

alter table public.workspaces add column if not exists active_mail_provider text
  check (active_mail_provider in ('resend', 'sendgrid', 'mailgun', 'smtp'));

-- Backfill from whichever member's personal pointer actually names a provider this workspace has
-- connected, preferring the owner. A pointer naming an unconnected provider is exactly the broken
-- state described above and is deliberately not carried across.
update public.workspaces w
set active_mail_provider = sub.provider
from (
  select distinct on (m.workspace_id) m.workspace_id, p.active_mail_provider as provider
  from public.workspace_members m
  join public.profiles p on p.id = m.user_id
  where p.active_mail_provider is not null
    and exists (
      select 1 from public.mail_provider_connections c
      where c.workspace_id = m.workspace_id and c.provider = p.active_mail_provider
    )
  order by m.workspace_id, (m.role = 'owner') desc, m.created_at
) sub
where w.id = sub.workspace_id and w.active_mail_provider is null;

-- ---------------------------------------------------------------------------
-- RPCs -- workspace-scoped, same optional-p_workspace_id shape 0071 established.
-- resolve_workspace_arg() re-checks membership, so a caller-supplied id can only narrow.
-- Old signatures are dropped first: an added defaulted parameter would make every existing
-- no-arg call ambiguous at the PostgREST layer.
-- ---------------------------------------------------------------------------

drop function if exists public.get_tiktok_connection_status();
create function public.get_tiktok_connection_status(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; conn public.tiktok_connections;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then return jsonb_build_object('connected', false); end if;
  select * into conn from public.tiktok_connections where workspace_id = v_ws;
  if conn.id is null then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', true, 'status', conn.status,
    'tiktok_username', conn.tiktok_username, 'avatar_url', conn.avatar_url);
end; $$;
revoke execute on function public.get_tiktok_connection_status(uuid) from public, anon;
grant execute on function public.get_tiktok_connection_status(uuid) to authenticated;

drop function if exists public.get_youtube_connection_status();
create function public.get_youtube_connection_status(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; conn public.youtube_connections;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then return jsonb_build_object('connected', false); end if;
  select * into conn from public.youtube_connections where workspace_id = v_ws;
  if conn.id is null then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', true, 'status', conn.status,
    'channel_title', conn.channel_title, 'thumbnail_url', conn.thumbnail_url);
end; $$;
revoke execute on function public.get_youtube_connection_status(uuid) from public, anon;
grant execute on function public.get_youtube_connection_status(uuid) to authenticated;

drop function if exists public.get_mail_connection_status();
create function public.get_mail_connection_status(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; conn public.mail_connections;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then return jsonb_build_object('connected', false); end if;
  select * into conn from public.mail_connections where workspace_id = v_ws;
  if conn.id is null then return jsonb_build_object('connected', false); end if;
  return jsonb_build_object('connected', true, 'status', conn.status,
    'email_address', conn.email_address);
end; $$;
revoke execute on function public.get_mail_connection_status(uuid) from public, anon;
grant execute on function public.get_mail_connection_status(uuid) to authenticated;

drop function if exists public.get_everflow_connection_status();
create function public.get_everflow_connection_status(p_workspace_id uuid default null)
returns table(connected boolean, network_name text, status text, connected_at timestamptz)
language sql security definer set search_path = public as $$
  select true, e.network_name, e.status, e.connected_at
  from public.everflow_connections e
  where e.workspace_id = public.resolve_workspace_arg(p_workspace_id);
$$;
revoke execute on function public.get_everflow_connection_status(uuid) from public, anon;
grant execute on function public.get_everflow_connection_status(uuid) to authenticated;

drop function if exists public.get_mail_provider_connections();
create function public.get_mail_provider_connections(p_workspace_id uuid default null)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'active_provider', (
      select w.active_mail_provider from public.workspaces w
      where w.id = public.resolve_workspace_arg(p_workspace_id)
    ),
    'providers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'provider', c.provider, 'from_address', c.from_address, 'from_name', c.from_name,
        'status', c.status, 'error', c.error, 'smtp_host', c.smtp_host,
        'mailgun_domain', c.mailgun_domain
      ) order by c.provider)
      from public.mail_provider_connections c
      where c.workspace_id = public.resolve_workspace_arg(p_workspace_id)
    ), '[]'::jsonb)
  );
$$;
revoke execute on function public.get_mail_provider_connections(uuid) from public, anon;
grant execute on function public.get_mail_provider_connections(uuid) to authenticated;

drop function if exists public.get_active_mail_sender();
create function public.get_active_mail_sender(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v_provider text; v_connected boolean;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then return jsonb_build_object('connected', false, 'provider', null); end if;

  select active_mail_provider into v_provider from public.workspaces where id = v_ws;
  if v_provider is null then
    return jsonb_build_object('connected', false, 'provider', null);
  end if;

  select exists (
    select 1 from public.mail_provider_connections
    where workspace_id = v_ws and provider = v_provider and status = 'connected'
  ) into v_connected;

  return jsonb_build_object('connected', v_connected, 'provider', v_provider);
end; $$;
revoke execute on function public.get_active_mail_sender(uuid) from public, anon;
grant execute on function public.get_active_mail_sender(uuid) to authenticated;

drop function if exists public.set_active_mail_provider(text);
create function public.set_active_mail_provider(p_provider text, p_workspace_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then raise exception 'Not signed in'; end if;

  if p_provider is not null then
    if p_provider not in ('resend', 'sendgrid', 'mailgun', 'smtp') then
      raise exception 'Unknown mail provider: %', p_provider;
    end if;
    if not exists (
      select 1 from public.mail_provider_connections
      where workspace_id = v_ws and provider = p_provider
    ) then
      raise exception 'Connect % before making it the active sender', p_provider;
    end if;
  end if;

  update public.workspaces set active_mail_provider = p_provider, updated_at = now()
  where id = v_ws;
end; $$;
revoke execute on function public.set_active_mail_provider(text, uuid) from public, anon;
grant execute on function public.set_active_mail_provider(text, uuid) to authenticated;

drop function if exists public.disconnect_tiktok();
create function public.disconnect_tiktok(p_workspace_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then return; end if;
  delete from public.tiktok_connections where workspace_id = v_ws;
end; $$;
revoke execute on function public.disconnect_tiktok(uuid) from public, anon;
grant execute on function public.disconnect_tiktok(uuid) to authenticated;

drop function if exists public.disconnect_youtube();
create function public.disconnect_youtube(p_workspace_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then return; end if;
  delete from public.youtube_connections where workspace_id = v_ws;
end; $$;
revoke execute on function public.disconnect_youtube(uuid) from public, anon;
grant execute on function public.disconnect_youtube(uuid) to authenticated;

drop function if exists public.disconnect_mail();
create function public.disconnect_mail(p_workspace_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then return; end if;
  delete from public.mail_connections where workspace_id = v_ws;
end; $$;
revoke execute on function public.disconnect_mail(uuid) from public, anon;
grant execute on function public.disconnect_mail(uuid) to authenticated;
