-- vault.create_secret lives in the vault schema, which isn't exposed to PostgREST — the admin
-- client can't call it directly via .rpc(). This thin service_role-only wrapper is the bridge,
-- used by the OAuth callback to store a Meta access token and get back a secret_id to persist
-- instead of the raw token (see 0006_meta_connections.sql for the rationale).
create or replace function public.store_meta_secret(p_token text, p_name text)
returns uuid
language plpgsql
security definer set search_path = public, vault
as $$
begin
  return vault.create_secret(p_token, p_name);
end;
$$;

revoke execute on function public.store_meta_secret(text, text) from public, anon, authenticated;
grant execute on function public.store_meta_secret(text, text) to service_role;
