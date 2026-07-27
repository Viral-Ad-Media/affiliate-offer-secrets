-- Phase E: Instagram, TikTok, YouTube, and Gmail connectors.

-- Generic Vault secret wrappers (service_role only), used by TikTok/YouTube/Mail instead of the
-- Meta-named ones in 0007_meta_secret_helper.sql — those stay untouched, zero risk to working
-- Phase B/C code. delete_oauth_secret matters more here than it did for Meta: Google access
-- tokens expire hourly, so refreshing repeatedly stores a new secret every ~55 minutes per active
-- user — without an explicit delete, vault.secrets grows unbounded for active users.
create or replace function public.store_oauth_secret(p_token text, p_name text)
returns uuid
language plpgsql
security definer set search_path = public, vault
as $$
begin
  return vault.create_secret(p_token, p_name);
end;
$$;

revoke execute on function public.store_oauth_secret(text, text) from public, anon, authenticated;
grant execute on function public.store_oauth_secret(text, text) to service_role;

create or replace function public.get_oauth_secret(p_secret_id uuid)
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

revoke execute on function public.get_oauth_secret(uuid) from public, anon, authenticated;
grant execute on function public.get_oauth_secret(uuid) to service_role;

create or replace function public.delete_oauth_secret(p_secret_id uuid)
returns void
language plpgsql
security definer set search_path = public, vault
as $$
begin
  delete from vault.secrets where id = p_secret_id;
end;
$$;

revoke execute on function public.delete_oauth_secret(uuid) from public, anon, authenticated;
grant execute on function public.delete_oauth_secret(uuid) to service_role;

-- Needed so a campaign's product image can be served at a real standalone public URL (Instagram's
-- media-creation endpoint requires a fetchable image_url, unlike Facebook's direct-byte-upload
-- Photos API). Re-validated at serve time (app/api/public/campaign-image) against the same
-- allowlist as lib/images/validate.ts — never trust this column's format is guaranteed.
alter table public.campaigns add column embedded_image_data_url text;

-- Instagram Business accounts are discovered per-Page during the existing Meta OAuth callback
-- (app/api/meta/callback/route.ts) — no separate OAuth flow. No token column here: IG Business
-- actions are authorized via the LINKED PAGE's own access token (meta_pages.page_token_secret_id),
-- which is how Meta's Graph API actually works, not a shortcut. Same default-deny RLS shape as
-- meta_pages — no policy at all, reads only via the sanitized get_meta_connection_status() RPC.
create table public.meta_instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.meta_connections(id) on delete cascade,
  ig_user_id text not null,
  ig_username text not null,
  linked_page_id text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, ig_user_id)
);

alter table public.meta_instagram_accounts enable row level security;
revoke all on public.meta_instagram_accounts from anon, authenticated;
grant all on public.meta_instagram_accounts to service_role;

-- Confirms the caller owns this IG-account row — but the route that uses this must ALSO
-- re-scope its Page-token lookup by user_id (not trust linked_page_id alone), mirroring
-- /api/meta/post's existing double-scoped pattern. See app/api/instagram/post/route.ts.
create or replace function public.assert_owns_ig_account(p_ig_user_id text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  return exists (
    select 1 from public.meta_instagram_accounts
    where ig_user_id = p_ig_user_id and user_id = auth.uid()
  );
end;
$$;

revoke execute on function public.assert_owns_ig_account(text) from public, anon;
grant execute on function public.assert_owns_ig_account(text) to authenticated;

-- Extend the existing sanitized status RPC (0006_meta_connections.sql) with linked IG accounts —
-- same shape as the existing pages/ad_accounts arrays, no new client-facing RPC needed.
create or replace function public.get_meta_connection_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  conn public.meta_connections;
  pages jsonb;
  ad_accounts jsonb;
  ig_accounts jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
    'ad_account_id', ad_account_id, 'ad_account_name', ad_account_name, 'currency', currency, 'is_active', is_active
  ) order by ad_account_name), '[]'::jsonb)
  into ad_accounts
  from public.meta_ad_accounts
  where user_id = auth.uid();

  select coalesce(jsonb_agg(jsonb_build_object(
    'ig_user_id', ig_user_id, 'ig_username', ig_username, 'is_active', is_active
  ) order by ig_username), '[]'::jsonb)
  into ig_accounts
  from public.meta_instagram_accounts
  where user_id = auth.uid();

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

revoke execute on function public.get_meta_connection_status() from public, anon;
grant execute on function public.get_meta_connection_status() to authenticated;

-- Audit trail, not a secret — same shape as meta_posts.
create table public.instagram_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  ig_user_id text not null,
  ig_media_id text not null,
  caption text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.instagram_posts enable row level security;
create policy "own instagram posts" on public.instagram_posts for select using (auth.uid() = user_id);
revoke insert, update, delete on public.instagram_posts from anon, authenticated;
grant all on public.instagram_posts to service_role;

-- TikTok: connect-only for now (no posting — this app doesn't generate video). Same default-deny
-- RLS shape as meta_connections.
create table public.tiktok_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  tiktok_user_id text not null,
  tiktok_username text,
  avatar_url text,
  access_token_secret_id uuid not null,
  refresh_token_secret_id uuid,
  token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tiktok_connections enable row level security;
revoke all on public.tiktok_connections from anon, authenticated;
grant all on public.tiktok_connections to service_role;

create or replace function public.get_tiktok_connection_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  conn public.tiktok_connections;
begin
  select * into conn from public.tiktok_connections where user_id = auth.uid();
  if conn.id is null then
    return jsonb_build_object('connected', false);
  end if;
  return jsonb_build_object(
    'connected', true,
    'status', conn.status,
    'tiktok_username', conn.tiktok_username,
    'avatar_url', conn.avatar_url
  );
end;
$$;

revoke execute on function public.get_tiktok_connection_status() from public, anon;
grant execute on function public.get_tiktok_connection_status() to authenticated;

create or replace function public.disconnect_tiktok()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.tiktok_connections where user_id = auth.uid();
end;
$$;

revoke execute on function public.disconnect_tiktok() from public, anon;
grant execute on function public.disconnect_tiktok() to authenticated;

-- YouTube: connect-only for now, same reasoning as TikTok.
create table public.youtube_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  channel_id text not null,
  channel_title text,
  thumbnail_url text,
  access_token_secret_id uuid not null,
  refresh_token_secret_id uuid,
  token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.youtube_connections enable row level security;
revoke all on public.youtube_connections from anon, authenticated;
grant all on public.youtube_connections to service_role;

create or replace function public.get_youtube_connection_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  conn public.youtube_connections;
begin
  select * into conn from public.youtube_connections where user_id = auth.uid();
  if conn.id is null then
    return jsonb_build_object('connected', false);
  end if;
  return jsonb_build_object(
    'connected', true,
    'status', conn.status,
    'channel_title', conn.channel_title,
    'thumbnail_url', conn.thumbnail_url
  );
end;
$$;

revoke execute on function public.get_youtube_connection_status() from public, anon;
grant execute on function public.get_youtube_connection_status() to authenticated;

create or replace function public.disconnect_youtube()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.youtube_connections where user_id = auth.uid();
end;
$$;

revoke execute on function public.disconnect_youtube() from public, anon;
grant execute on function public.disconnect_youtube() to authenticated;

-- Mail: send-from-own-mailbox via Gmail (gmail.send scope only — deliberately not a read scope).
create table public.mail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  email_address text not null,
  access_token_secret_id uuid not null,
  refresh_token_secret_id uuid,
  token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'needs_reconnect')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mail_connections enable row level security;
revoke all on public.mail_connections from anon, authenticated;
grant all on public.mail_connections to service_role;

create or replace function public.get_mail_connection_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  conn public.mail_connections;
begin
  select * into conn from public.mail_connections where user_id = auth.uid();
  if conn.id is null then
    return jsonb_build_object('connected', false);
  end if;
  return jsonb_build_object(
    'connected', true,
    'status', conn.status,
    'email_address', conn.email_address
  );
end;
$$;

revoke execute on function public.get_mail_connection_status() from public, anon;
grant execute on function public.get_mail_connection_status() to authenticated;

create or replace function public.disconnect_mail()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.mail_connections where user_id = auth.uid();
end;
$$;

revoke execute on function public.disconnect_mail() from public, anon;
grant execute on function public.disconnect_mail() to authenticated;

-- Audit trail — mail_sends.campaign_id, when provided, must be validated via
-- assert_owns_campaign() before insert (app/api/mail/send/route.ts) even though the send route
-- itself never operates on another tenant's resource — this only prevents a future feature that
-- joins mail_sends -> campaigns via the admin client from inheriting a mismatched reference.
create table public.mail_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  to_address text not null,
  subject text not null,
  message_id text,
  created_at timestamptz not null default now()
);

alter table public.mail_sends enable row level security;
create policy "own mail sends" on public.mail_sends for select using (auth.uid() = user_id);
revoke insert, update, delete on public.mail_sends from anon, authenticated;
grant all on public.mail_sends to service_role;
