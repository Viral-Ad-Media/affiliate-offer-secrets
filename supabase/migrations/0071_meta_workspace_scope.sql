-- Meta connections belong to the workspace, not to the person who clicked Connect.
--
-- Phase 2 added workspace_id to all six Meta tables and Phase 2 Step C made it NOT NULL, but the
-- UNIQUE constraints and three of the RPCs were never carried across. That left three real bugs:
--
--   1. unique(user_id) on meta_connections meant one Meta connection per PERSON, globally. A user
--      in two workspaces could not connect Meta in the second one at all -- the insert collided
--      with their first workspace's row. Same shape on pages/ad accounts/IG accounts.
--   2. get_meta_connection_status() read `where user_id = auth.uid()`, so a teammate who did not
--      personally run the OAuth flow saw "not connected" for a workspace that IS connected, and
--      could not use any of it.
--   3. disconnect_meta() deleted `where user_id = auth.uid()` -- the wrong row set entirely once a
--      person is in more than one workspace, and a no-op for a teammate trying to disconnect the
--      workspace's own connection.
--
-- Safe to widen right now: all Meta rows live in a single workspace and no user currently belongs
-- to more than one, so every new constraint is satisfied by existing data.
--
-- assert_owns_meta_page/assert_owns_ig_account already had a workspace leg; what they also had was
-- `user_id = auth.uid() OR ...`, which let a person REMOVED from a workspace keep passing the
-- ownership check on rows they originally created. That leg is dropped here -- membership is the
-- authorization boundary, exactly as it is everywhere else since Phase 2.

-- ---------------------------------------------------------------------------
-- Constraints: re-key from the connecting user to the owning workspace.
-- ---------------------------------------------------------------------------

alter table public.meta_connections drop constraint if exists meta_connections_user_id_key;
alter table public.meta_connections add constraint meta_connections_workspace_id_key unique (workspace_id);

alter table public.meta_pages drop constraint if exists meta_pages_user_id_page_id_key;
alter table public.meta_pages add constraint meta_pages_workspace_id_page_id_key unique (workspace_id, page_id);

alter table public.meta_ad_accounts drop constraint if exists meta_ad_accounts_user_id_ad_account_id_key;
alter table public.meta_ad_accounts add constraint meta_ad_accounts_workspace_id_ad_account_id_key unique (workspace_id, ad_account_id);

alter table public.meta_instagram_accounts drop constraint if exists meta_instagram_accounts_user_id_ig_user_id_key;
alter table public.meta_instagram_accounts add constraint meta_instagram_accounts_workspace_id_ig_user_id_key unique (workspace_id, ig_user_id);

-- The post routes already dedupe on (workspace_id, idempotency_key); the constraint disagreed with
-- them, so a second member could re-publish an identical post the dedupe query thought was taken.
alter table public.meta_posts drop constraint if exists meta_posts_user_id_idempotency_key_key;
alter table public.meta_posts add constraint meta_posts_workspace_id_idempotency_key_key unique (workspace_id, idempotency_key);

alter table public.instagram_posts drop constraint if exists instagram_posts_user_id_idempotency_key_key;
alter table public.instagram_posts add constraint instagram_posts_workspace_id_idempotency_key_key unique (workspace_id, idempotency_key);

-- ---------------------------------------------------------------------------
-- RPCs: workspace-scoped.
--
-- Each takes an optional p_workspace_id so a caller that has already resolved the workspace from
-- the request host (Phase 3's rule -- the hostname decides, not profiles.active_workspace_id) can
-- pass it, rather than the RPC silently re-resolving to a different workspace than the page the
-- user is looking at. Omitted, it falls back to current_workspace_id(), which is what browser-side
-- callers do. Membership is checked either way, so passing an id can only ever narrow, never widen.
--
-- The old zero-arg/one-arg versions are dropped rather than left alongside: an added defaulted
-- parameter would otherwise make every existing no-arg call ambiguous at the PostgREST layer.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_workspace_arg(p_workspace_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ws uuid;
begin
  v_ws := coalesce(p_workspace_id, public.current_workspace_id());
  if v_ws is null then
    return null;
  end if;
  -- Never trust a caller-supplied workspace id on its own.
  if not public.is_workspace_member(v_ws) then
    raise exception 'Workspace not found for this account';
  end if;
  return v_ws;
end;
$$;

revoke execute on function public.resolve_workspace_arg(uuid) from public, anon;
grant execute on function public.resolve_workspace_arg(uuid) to authenticated;

drop function if exists public.get_meta_connection_status();

create function public.get_meta_connection_status(p_workspace_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  conn public.meta_connections;
  pages jsonb;
  ad_accounts jsonb;
  ig_accounts jsonb;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then
    return jsonb_build_object('connected', false);
  end if;

  select * into conn from public.meta_connections where workspace_id = v_ws;
  if conn.id is null then
    return jsonb_build_object('connected', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'page_id', page_id, 'page_name', page_name, 'is_active', is_active, 'status', status
  ) order by page_name), '[]'::jsonb)
  into pages
  from public.meta_pages
  where workspace_id = v_ws;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ad_account_id', ad_account_id, 'ad_account_name', ad_account_name, 'currency', currency, 'is_active', is_active
  ) order by ad_account_name), '[]'::jsonb)
  into ad_accounts
  from public.meta_ad_accounts
  where workspace_id = v_ws;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ig_user_id', ig_user_id, 'ig_username', ig_username, 'is_active', is_active
  ) order by ig_username), '[]'::jsonb)
  into ig_accounts
  from public.meta_instagram_accounts
  where workspace_id = v_ws;

  return jsonb_build_object(
    'connected', true,
    'status', conn.status,
    'token_expires_at', conn.token_expires_at,
    'ads_management_granted', conn.ads_management_granted,
    'pages', pages,
    'ad_accounts', ad_accounts,
    'instagram_accounts', ig_accounts
  );
end;
$$;

revoke execute on function public.get_meta_connection_status(uuid) from public, anon;
grant execute on function public.get_meta_connection_status(uuid) to authenticated;

drop function if exists public.disconnect_meta();

create function public.disconnect_meta(p_workspace_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then
    return;
  end if;
  -- meta_pages / meta_ad_accounts / meta_instagram_accounts cascade via connection_id.
  delete from public.meta_connections where workspace_id = v_ws;
end;
$$;

revoke execute on function public.disconnect_meta(uuid) from public, anon;
grant execute on function public.disconnect_meta(uuid) to authenticated;

drop function if exists public.set_active_meta_page(text);

create function public.set_active_meta_page(p_page_id text, p_workspace_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null or not exists (
    select 1 from public.meta_pages where page_id = p_page_id and workspace_id = v_ws
  ) then
    raise exception 'Page not found for this account';
  end if;

  update public.meta_pages set is_active = false where workspace_id = v_ws;
  update public.meta_pages set is_active = true where page_id = p_page_id and workspace_id = v_ws;
end;
$$;

revoke execute on function public.set_active_meta_page(text, uuid) from public, anon;
grant execute on function public.set_active_meta_page(text, uuid) to authenticated;

-- Membership only -- see the header note on the removed-member hole.
create or replace function public.assert_owns_meta_page(p_page_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.meta_pages p
     where p.page_id = p_page_id
       and public.is_workspace_member(p.workspace_id)
  ) then
    raise exception 'Page not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_ig_account(p_ig_user_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.meta_instagram_accounts a
     where a.ig_user_id = p_ig_user_id
       and public.is_workspace_member(a.workspace_id)
  ) then
    raise exception 'Instagram account not found for this account';
  end if;
  return true;
end;
$$;
