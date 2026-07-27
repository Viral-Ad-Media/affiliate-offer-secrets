-- Generalizes the single-network (ClickBank-only) assumption baked into products/hoplinks into a
-- pluggable "network" concept, and adds the self-service connection this app has been missing
-- since Phase A: today profiles.nickname can only ever be set via direct admin SQL — there is no
-- UI or RPC for a client to set their own ClickBank affiliate nickname, which is a hard blocker
-- for a real multi-tenant SaaS (every client needs their own nickname for correctly-attributed
-- hoplinks). Digistore24 is the second network landing on this same foundation.

-- Not a secret — an affiliate ID/nickname is embedded in the public hoplink URL every ad visitor
-- sees, unlike meta_connections/tiktok_connections/youtube_connections/mail_connections, which
-- store real OAuth bearer tokens in Vault behind default-deny RLS. A plain owner-scoped table is
-- the right trust tier here — never add a genuinely sensitive column to this table without
-- revisiting that decision. The charset check is the DB-layer half of a three-layer XSS defense
-- (see lib/engine/renderPages.ts's buildHoplink()/escapeHtml() changes in the same phase) — this
-- value flows unescaped into presell/bridge pages served to real, unauthenticated ad traffic, so
-- loosen this constraint only as far as genuinely required by real ClickBank/Digistore24 ID
-- formats, never to a bare length check.
create table public.network_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  network text not null check (network in ('clickbank', 'digistore24')),
  affiliate_id text not null check (
    char_length(affiliate_id) between 1 and 64
    and affiliate_id ~ '^[A-Za-z0-9_.-]+$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, network)
);

alter table public.network_connections enable row level security;
create policy "own network connections" on public.network_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Backfill: existing admin-set profiles.nickname values become each user's ClickBank connection
-- so no one's working hoplinks break on upgrade. profiles.nickname itself is left in place as a
-- deprecated, unread legacy mirror (not dropped, to avoid a destructive migration) — no code path
-- reads it after this phase ships; a later cleanup migration can drop it once that's confirmed.
insert into public.network_connections (user_id, network, affiliate_id)
select id, 'clickbank', nickname
from public.profiles
where nickname is not null and nickname <> ''
on conflict (user_id, network) do nothing;

-- Every product row now records which network it came from. Existing rows default to
-- 'clickbank' (the only network that has ever existed) with no backfill needed beyond the
-- column default itself.
alter table public.products add column network text not null default 'clickbank'
  check (network in ('clickbank', 'digistore24'));

-- The old (user_id, vendor_id) uniqueness would let a Digistore24 numeric product ID collide
-- with an unrelated ClickBank vendor_id string and silently merge two different products.
alter table public.products drop constraint products_user_id_vendor_id_key;
alter table public.products add constraint products_user_id_network_vendor_id_key
  unique (user_id, network, vendor_id);

-- Same merge semantics as before (0004_atomic_product_upsert.sql), just conflict-keyed on
-- (user_id, network, vendor_id) instead of (user_id, vendor_id), and network is taken from the
-- incoming payload (defaulting to 'clickbank' so existing callers that never pass it keep working
-- unchanged).
create or replace function public.upsert_product(p_user_id uuid, p_meta jsonb)
returns public.products
language plpgsql
security definer set search_path = public
as $$
declare
  result public.products;
begin
  insert into public.products (
    user_id, network, vendor_id, niche, product_title, description, gravity, initial_sale,
    avg_sale, recurring, commission_pct, sales_page_url, affiliate_page_url, hoplink,
    score, angle_notes, page_verified, status, assets_link, date_added
  )
  values (
    p_user_id,
    coalesce(p_meta->>'network', 'clickbank'),
    p_meta->>'vendor_id',
    coalesce(p_meta->>'niche', 'unknown'),
    p_meta->>'product_title',
    p_meta->>'description',
    (p_meta->>'gravity')::numeric,
    (p_meta->>'initial_sale')::numeric,
    (p_meta->>'avg_sale')::numeric,
    (p_meta->>'recurring')::numeric,
    (p_meta->>'commission_pct')::numeric,
    p_meta->>'sales_page_url',
    p_meta->>'affiliate_page_url',
    p_meta->>'hoplink',
    (p_meta->>'score')::integer,
    p_meta->>'angle_notes',
    coalesce((p_meta->>'page_verified')::boolean, false),
    coalesce(p_meta->>'status', 'New'),
    p_meta->>'assets_link',
    coalesce((p_meta->>'date_added')::date, current_date)
  )
  on conflict (user_id, network, vendor_id) do update set
    gravity = coalesce(excluded.gravity, products.gravity),
    initial_sale = coalesce(excluded.initial_sale, products.initial_sale),
    avg_sale = coalesce(excluded.avg_sale, products.avg_sale),
    recurring = coalesce(excluded.recurring, products.recurring),
    commission_pct = coalesce(excluded.commission_pct, products.commission_pct),
    niche = coalesce(products.niche, excluded.niche),
    product_title = coalesce(products.product_title, excluded.product_title),
    description = coalesce(products.description, excluded.description),
    sales_page_url = coalesce(products.sales_page_url, excluded.sales_page_url),
    affiliate_page_url = coalesce(products.affiliate_page_url, excluded.affiliate_page_url),
    hoplink = coalesce(products.hoplink, excluded.hoplink),
    score = coalesce(products.score, excluded.score),
    angle_notes = coalesce(products.angle_notes, excluded.angle_notes),
    page_verified = coalesce(products.page_verified, excluded.page_verified),
    status = coalesce(products.status, excluded.status),
    assets_link = coalesce(products.assets_link, excluded.assets_link),
    date_added = coalesce(products.date_added, excluded.date_added),
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.upsert_product(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_product(uuid, jsonb) to service_role;
