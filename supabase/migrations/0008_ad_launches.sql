-- Phase C: real Meta ad campaign launches, credit-gated.

-- Meta's consent dialog allows partial scope grants — a successful token exchange doesn't
-- guarantee ads_management was actually granted. Verified explicitly at connect time (see
-- app/api/meta/callback/route.ts) so the UI can gate "Launch Ad" proactively instead of
-- discovering the gap via a failed API call deep inside a launch_ad job stage.
alter table public.meta_connections add column ads_management_granted boolean not null default false;

create table public.meta_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.meta_connections(id) on delete cascade,
  ad_account_id text not null,   -- Meta's "act_XXXXXXXXXX" format
  ad_account_name text not null,
  currency text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, ad_account_id)
);
-- No token column — unlike Pages, ad accounts don't get their own token; calls reuse
-- meta_connections.user_token_secret_id. Same default-deny treatment as meta_pages.

alter table public.meta_ad_accounts enable row level security;
revoke all on public.meta_ad_accounts from anon, authenticated;
grant all on public.meta_ad_accounts to service_role;

-- Domain/detail table jobs.type='launch_ad' processes into — same relationship campaigns
-- already has to jobs.type='build_campaign'.
create table public.ad_launches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  ad_account_id text not null,
  page_id text not null,
  destination text not null check (destination in ('presell', 'bridge')),
  headline text not null,
  primary_text text not null,
  country text not null default 'US',
  budget_credits integer not null check (budget_credits > 0),
  status text not null default 'building' check (status in (
    'building', 'paused_review', 'activating', 'active', 'failed'
  )),
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,
  activation_state jsonb not null default '{}'::jsonb,  -- per-level activation outcome
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id)
);

alter table public.ad_launches enable row level security;
create policy "own ad launches" on public.ad_launches for select using (auth.uid() = user_id);
revoke insert, update, delete on public.ad_launches from anon, authenticated;
grant all on public.ad_launches to service_role;

-- Credit reservation. A plain "select sum() then insert" is NOT atomic against two concurrent
-- calls under READ COMMITTED (both can read the same starting balance before either commits) —
-- the advisory lock below serializes concurrent calls for the SAME user. This closes the
-- cross-launch balance race; a SEPARATE guard (an optimistic status transition on ad_launches,
-- done by the caller before this is ever invoked) closes the other race — the same launch being
-- reserved-against twice (double-click/retry) — see app/api/meta/ads/activate/route.ts.
create or replace function public.reserve_ad_credits(p_amount integer, p_reason text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  balance integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('credits:' || auth.uid()::text, 0));

  select coalesce(sum(delta), 0) into balance from public.credits_ledger where user_id = auth.uid();
  if balance < p_amount then
    return false;
  end if;

  insert into public.credits_ledger (user_id, delta, reason)
  values (auth.uid(), -p_amount, p_reason);

  return true;
end;
$$;

revoke execute on function public.reserve_ad_credits(integer, text) from public, anon;
grant execute on function public.reserve_ad_credits(integer, text) to authenticated;

-- Compensating refund — service_role only, used when activation fails after credits were
-- already reserved (see app/api/meta/ads/activate/route.ts). Takes an explicit user_id since
-- the caller here is the trusted server route, not necessarily running with that user's session.
create or replace function public.refund_ad_credits(p_user_id uuid, p_amount integer, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.credits_ledger (user_id, delta, reason)
  values (p_user_id, p_amount, p_reason);
end;
$$;

revoke execute on function public.refund_ad_credits(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.refund_ad_credits(uuid, integer, text) to service_role;

-- Ownership checks for the new entities, same pattern as assert_owns_meta_page. Called by the
-- API routes AND re-checked inside the worker's launch_ad "verify" stage — the route's check is
-- a UX nicety, the worker's re-check (running as service_role, which bypasses RLS) is the real
-- boundary, since jobs' own RLS policy only validates the row's user_id, not payload contents.
create or replace function public.assert_owns_meta_ad_account(p_ad_account_id text)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  return exists (
    select 1 from public.meta_ad_accounts
    where ad_account_id = p_ad_account_id and user_id = auth.uid()
  );
end;
$$;

revoke execute on function public.assert_owns_meta_ad_account(text) from public, anon;
grant execute on function public.assert_owns_meta_ad_account(text) to authenticated;

create or replace function public.assert_owns_campaign(p_campaign_id uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  return exists (
    select 1 from public.campaigns
    where id = p_campaign_id and user_id = auth.uid()
  );
end;
$$;

revoke execute on function public.assert_owns_campaign(uuid) from public, anon;
grant execute on function public.assert_owns_campaign(uuid) to authenticated;

create or replace function public.set_active_meta_ad_account(p_ad_account_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.meta_ad_accounts where ad_account_id = p_ad_account_id and user_id = auth.uid()
  ) then
    raise exception 'Ad account not found for this account';
  end if;
  update public.meta_ad_accounts set is_active = false where user_id = auth.uid();
  update public.meta_ad_accounts set is_active = true where ad_account_id = p_ad_account_id and user_id = auth.uid();
end;
$$;

revoke execute on function public.set_active_meta_ad_account(text) from public, anon;
grant execute on function public.set_active_meta_ad_account(text) to authenticated;

-- Refresh the connection-status RPC to also report ad-launch readiness and connected ad accounts.
create or replace function public.get_meta_connection_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  conn public.meta_connections;
  pages jsonb;
  ad_accounts jsonb;
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
    'ad_account_id', ad_account_id, 'ad_account_name', ad_account_name,
    'currency', currency, 'is_active', is_active
  ) order by ad_account_name), '[]'::jsonb)
  into ad_accounts
  from public.meta_ad_accounts
  where user_id = auth.uid();

  return jsonb_build_object(
    'connected', true,
    'status', conn.status,
    'token_expires_at', conn.token_expires_at,
    'ads_management_granted', conn.ads_management_granted,
    'pages', pages,
    'ad_accounts', ad_accounts
  );
end;
$$;

revoke execute on function public.get_meta_connection_status() from public, anon;
grant execute on function public.get_meta_connection_status() to authenticated;
