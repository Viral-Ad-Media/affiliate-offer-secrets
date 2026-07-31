-- Applied via the Supabase MCP on 2026-07-31.
-- Everflow is a PLATFORM, not one network: dozens of CPA networks run on it, each issuing its own
-- affiliate accounts and API keys. One adapter therefore reaches all of them, which is why it goes
-- first. Verified live before writing any of this: GET https://api.eflow.team/v1/affiliates/
-- offersrunnable and /affiliates/offers/{id} both answer 401 (unknown paths answer 404), and the
-- key identifies both the affiliate and their network — there is no separate tenant parameter.
--
-- Storage splits in two on purpose:
--
--   network_connections  — the affiliate id. Public information, embedded in every tracking URL,
--                          so it stays in the existing plain owner-writable table and keeps using
--                          the entitlement plumbing every other network already goes through.
--   everflow_connections — the API key. A real bearer secret: it reads that affiliate's offers and
--                          reporting. Vault-backed with default-deny RLS, exactly like the OAuth
--                          tokens in meta_connections. It must never live beside the affiliate id.
alter table public.network_connections
  drop constraint if exists network_connections_network_check;
alter table public.network_connections
  add constraint network_connections_network_check
  check (network in ('clickbank', 'digistore24', 'everflow'));

alter table public.products
  drop constraint if exists products_network_check;
alter table public.products
  add constraint products_network_check
  check (network in ('clickbank', 'digistore24', 'everflow'));

create table if not exists public.everflow_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  api_key_secret_id uuid not null,
  network_name text,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.everflow_connections enable row level security;
revoke all on public.everflow_connections from anon, authenticated;
grant all on public.everflow_connections to service_role;

create or replace function public.get_everflow_connection_status()
returns table (connected boolean, network_name text, status text, connected_at timestamptz)
language sql security definer set search_path = public
as $$
  select true, e.network_name, e.status, e.connected_at
  from public.everflow_connections e
  where e.user_id = auth.uid();
$$;
revoke execute on function public.get_everflow_connection_status() from public, anon;
grant execute on function public.get_everflow_connection_status() to authenticated;
