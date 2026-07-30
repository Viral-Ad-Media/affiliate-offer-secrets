-- Shared marketplace preload cache — the products analogue of lib/categories.ts's static category
-- snapshot, kept in a table (not a checked-in file) because gravity/$-per-sale stats drift daily
-- and the catalog is far too large to ship to the client. One row per marketplace listing, NOT
-- tenant data: no user_id, refreshed for everyone by a daily sweep
-- (app/api/marketplace/refresh/route.ts, pg_cron 'marketplace-refresh-backstop' — cron.schedule
-- applied separately via execute_sql, never committed, same convention as every other cron here).
create table public.marketplace_products (
  id uuid primary key default gen_random_uuid(),
  network text not null default 'clickbank' check (network in ('clickbank', 'digistore24')),
  vendor_id text not null,
  category text,
  sub_category text,
  product_title text not null,
  description text,
  gravity double precision,
  initial_sale double precision,
  avg_sale double precision,
  recurring double precision,
  sales_page_url text,
  affiliate_page_url text,
  fetched_at timestamptz not null default now(),
  unique (network, vendor_id)
);

-- Serves the two real read shapes: category(+sub_category) top-N-by-gravity.
create index marketplace_products_lookup_idx
  on public.marketplace_products (network, category, sub_category);

alter table public.marketplace_products enable row level security;

-- Public marketplace data (anyone can see it on clickbank.com) — safe for any signed-in user to
-- read directly; writes only ever come from the refresh sweep running as service_role. Unlike
-- every tenant-owned table here, a plain `using (true)` read policy is correct, not a gap.
create policy "read marketplace cache" on public.marketplace_products
  for select to authenticated using (true);
revoke insert, update, delete on public.marketplace_products from anon, authenticated;
grant all on public.marketplace_products to service_role;
