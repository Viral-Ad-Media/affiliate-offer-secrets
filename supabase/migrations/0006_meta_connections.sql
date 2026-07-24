-- Phase B: Connect Facebook OAuth + real Page posting.
--
-- Tokens are live bearer secrets, not inert data (unlike credits_ledger/payments/usage_ledger,
-- which safely use a plain "for select using (auth.uid()=user_id)" policy). meta_connections/
-- meta_pages get NO RLS policy at all (default-deny) plus an explicit revoke at the GRANT layer
-- as belt-and-suspenders against a future migration accidentally adding a permissive policy.
-- Raw tokens are never stored as plaintext columns — only a Vault secret_id, first per-row use
-- of Vault in this codebase (existing secrets are static, named, singular).

create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  fb_user_id text not null,
  user_token_secret_id uuid not null,       -- points into Vault, not a plaintext token
  token_expires_at timestamptz,             -- from /debug_token; null = non-expiring per Meta
  status text not null default 'connected' check (status in ('connected','needs_reconnect')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meta_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,   -- denormalized for simple RPC checks
  connection_id uuid not null references public.meta_connections(id) on delete cascade,
  page_id text not null,
  page_name text not null,
  page_token_secret_id uuid not null,
  token_expires_at timestamptz,
  is_active boolean not null default false,
  status text not null default 'connected' check (status in ('connected','needs_reconnect')),
  created_at timestamptz not null default now(),
  unique (user_id, page_id)
);

create table public.meta_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  page_id text not null,
  fb_post_id text not null,
  message text,
  image_url text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.meta_connections enable row level security;
alter table public.meta_pages enable row level security;
alter table public.meta_posts enable row level security;

-- Default-deny for the token tables — no policies, plus explicit GRANT-layer lockout.
revoke all on public.meta_connections from anon, authenticated;
revoke all on public.meta_pages from anon, authenticated;
grant all on public.meta_connections to service_role;
grant all on public.meta_pages to service_role;

-- meta_posts is an audit trail, not a secret — same shape as credits_ledger/payments/usage_ledger.
create policy "own posts" on public.meta_posts for select using (auth.uid() = user_id);
revoke insert, update, delete on public.meta_posts from anon, authenticated;
grant all on public.meta_posts to service_role;

-- Sanitized status read — no token columns ever leave this function.
create or replace function public.get_meta_connection_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  conn public.meta_connections;
  pages jsonb;
begin
  select * into conn from public.meta_connections where user_id = auth.uid();
  if conn.id is null then
    return jsonb_build_object('connected', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'page_id', page_id, 'page_name', page_name, 'is_active', is_active, 'status', status
  ) order by page_name), '[]'::jsonb)
  into pages
  from public.meta_pages
  where user_id = auth.uid();

  return jsonb_build_object(
    'connected', true,
    'status', conn.status,
    'token_expires_at', conn.token_expires_at,
    'pages', pages
  );
end;
$$;

revoke execute on function public.get_meta_connection_status() from public, anon;
grant execute on function public.get_meta_connection_status() to authenticated;

-- Ownership check — must be called before any server code reaches for the admin client to
-- fetch a token. Closes a cross-tenant IDOR: Facebook Page IDs aren't secret, so without this,
-- any authenticated user could pass another tenant's page_id to /api/meta/post.
create or replace function public.assert_owns_meta_page(p_page_id text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  return exists (
    select 1 from public.meta_pages
    where page_id = p_page_id and user_id = auth.uid()
  );
end;
$$;

revoke execute on function public.assert_owns_meta_page(text) from public, anon;
grant execute on function public.assert_owns_meta_page(text) to authenticated;

create or replace function public.set_active_meta_page(p_page_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.meta_pages where page_id = p_page_id and user_id = auth.uid()) then
    raise exception 'Page not found for this account';
  end if;
  update public.meta_pages set is_active = false where user_id = auth.uid();
  update public.meta_pages set is_active = true where page_id = p_page_id and user_id = auth.uid();
end;
$$;

revoke execute on function public.set_active_meta_page(text) from public, anon;
grant execute on function public.set_active_meta_page(text) to authenticated;

create or replace function public.disconnect_meta()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.meta_connections where user_id = auth.uid();
end;
$$;

revoke execute on function public.disconnect_meta() from public, anon;
grant execute on function public.disconnect_meta() to authenticated;

-- The one function that actually returns a raw token — service_role only, never authenticated.
create or replace function public.get_meta_secret(p_secret_id uuid)
returns text
language plpgsql
security definer set search_path = public, vault
as $$
declare
  secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where id = p_secret_id;
  return secret;
end;
$$;

revoke execute on function public.get_meta_secret(uuid) from public, anon, authenticated;
grant execute on function public.get_meta_secret(uuid) to service_role;
