-- Phase D: custom domains + no-code page editor.

-- Fix #1 (design review): campaigns' original "for all" policy let any authenticated client
-- write presell_html/bridge_html/page_copy directly, bypassing the new editor's validation
-- entirely. These fields are served completely raw to real, unauthenticated ad traffic
-- (servePublicCampaignPage), so an unvalidated client write here is a self-inflicted stored-XSS
-- vector. Narrow to select-only — every legitimate write already goes through the admin client
-- (engine worker, Stripe webhook, and now the page-copy route), so this is pure hardening.
drop policy "own campaigns" on public.campaigns;
create policy "own campaigns" on public.campaigns
  for select using (auth.uid() = user_id);

alter table public.campaigns add column page_copy jsonb;

-- One row per domain a tenant has connected (bring-your-own — the actual DNS/SSL work happens
-- via the Vercel Domains API, see lib/vercel/client.ts). Not a bearer-secret table like
-- meta_pages, but writes are still server-route-only because every write is paired 1:1 with a
-- real Vercel API call that must not be triggerable by a bare client INSERT.
create table public.custom_domains (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  domain text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Fix #3 (design review): partial unique index, not a blanket unique(domain). Anyone
-- authenticated can type in a domain they don't actually own and create a 'pending' claim —
-- expected, ownership is proven later via Vercel's verification challenge. A blanket unique
-- constraint would let an abandoned/never-verified claim permanently block the real owner from
-- ever connecting their own domain here. Scoping uniqueness to status='verified' means multiple
-- tenants can each hold a pending claim on the same string harmlessly (only one can ever actually
-- pass DNS verification), but exactly one can ever reach 'verified'.
create unique index custom_domains_verified_domain_idx
  on public.custom_domains (domain) where status = 'verified';

alter table public.custom_domains enable row level security;
create policy "own domains" on public.custom_domains
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.custom_domains from anon, authenticated;
grant all on public.custom_domains to service_role;

-- Maps a path under a connected domain to one campaign's presell or bridge page. One domain can
-- host many campaigns at different paths (confirmed product decision).
create table public.custom_domain_routes (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.custom_domains(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Fix #4 (design review): on delete cascade, matching the precedent already set on
  -- ad_launches.campaign_id — deleting a campaign should make its domain routes vanish (clean
  -- 404) rather than fail with an opaque FK error.
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  destination text not null check (destination in ('presell', 'bridge')),
  path text not null default '',
  created_at timestamptz not null default now(),
  unique (domain_id, path)
);

alter table public.custom_domain_routes enable row level security;
create policy "own domain routes" on public.custom_domain_routes
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.custom_domain_routes from anon, authenticated;
grant all on public.custom_domain_routes to service_role;

-- Fix (design review): the load-bearing ownership check. Without re-checking BOTH the domain and
-- the campaign here, a tenant could map their own verified domain's path to another tenant's
-- campaign_id and publicly serve/rebrand that tenant's presell page under an attacker-controlled
-- domain. assert_owns_campaign() already exists (supabase/migrations/0008_ad_launches.sql),
-- reused as-is.
create or replace function public.add_domain_route(
  p_domain_id uuid,
  p_path text,
  p_campaign_id uuid,
  p_destination text
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  new_id uuid;
begin
  if not exists (
    select 1 from public.custom_domains where id = p_domain_id and user_id = auth.uid()
  ) then
    raise exception 'domain not found or not owned by caller';
  end if;

  if not public.assert_owns_campaign(p_campaign_id) then
    raise exception 'campaign not found or not owned by caller';
  end if;

  if p_destination not in ('presell', 'bridge') then
    raise exception 'invalid destination';
  end if;

  insert into public.custom_domain_routes (domain_id, user_id, campaign_id, destination, path)
  values (p_domain_id, auth.uid(), p_campaign_id, p_destination, coalesce(p_path, ''))
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.add_domain_route(uuid, text, uuid, text) from public, anon;
grant execute on function public.add_domain_route(uuid, text, uuid, text) to authenticated;

create or replace function public.remove_domain_route(p_route_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.custom_domain_routes where id = p_route_id and user_id = auth.uid();
end;
$$;

revoke execute on function public.remove_domain_route(uuid) from public, anon;
grant execute on function public.remove_domain_route(uuid) to authenticated;
