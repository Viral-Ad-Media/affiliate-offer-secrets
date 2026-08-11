-- Reconnecting a Meta account was permanently broken after the first disconnect, and the two
-- causes only bite in combination.
--
-- 1. `vault.secrets.name` is UNIQUE, and both store helpers were a bare `vault.create_secret()`
--    with a DETERMINISTIC name (`meta_user_token_{user_id}`, `meta_page_token_{page_id}`). A
--    second connect for the same user or Page therefore raises
--    `duplicate key value violates unique constraint "secrets_name_idx"`.
-- 2. `disconnect_meta()` deleted `meta_connections` (cascading to pages and IG accounts) but left
--    every Vault secret behind. So the pointers vanished while the named secrets survived.
--
-- Either alone is survivable. Together they mean: connect, disconnect, and you can never connect
-- that account again — the leftovers from your own previous connection now collide with you, and
-- the failure surfaces as a generic "Something went wrong connecting to Facebook". Observed live
-- against secrets orphaned on 2026-07-29 by an earlier Meta app.
--
-- CLAUDE.md already stated this hygiene rule for Google ("must delete the old Vault secret, not
-- just repoint the column") and explicitly exempted Meta because "token replacement only happens
-- on a rare full re-auth". That reasoning was wrong twice over: a full re-auth is exactly the
-- common case here, and rarity was never the issue — determinism of the name was.

-- Idempotent by NAME rather than create-only. Reusing the row keeps every existing
-- `*_secret_id` pointer valid and cannot orphan anything, which delete-then-create would risk if
-- it failed between the two statements.
create or replace function public.store_meta_secret(p_token text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    return vault.create_secret(p_token, p_name);
  end if;
  perform vault.update_secret(v_id, p_token, p_name);
  return v_id;
end;
$$;

-- Same flaw, same fix. Used by TikTok and the mail providers, which re-connect for exactly the
-- same reasons Meta does.
create or replace function public.store_oauth_secret(p_token text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    return vault.create_secret(p_token, p_name);
  end if;
  perform vault.update_secret(v_id, p_token, p_name);
  return v_id;
end;
$$;

-- Disconnect now takes its secrets with it. The store helpers above already make reconnect work
-- without this, but leaving live bearer tokens in the vault after a user asked to disconnect is
-- its own problem — the rows are gone, so nothing would ever reference or clean them again.
-- Ids are collected BEFORE the delete, because the delete cascades the pointers away.
create or replace function public.disconnect_meta(p_workspace_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_secret_ids uuid[];
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then
    return;
  end if;

  select array_remove(array_agg(sid), null)
    into v_secret_ids
  from (
    select user_token_secret_id as sid from public.meta_connections where workspace_id = v_ws
    union all
    select page_token_secret_id from public.meta_pages where workspace_id = v_ws
  ) t;

  delete from public.meta_connections where workspace_id = v_ws;

  if v_secret_ids is not null then
    delete from vault.secrets where id = any(v_secret_ids);
  end if;
end;
$$;
