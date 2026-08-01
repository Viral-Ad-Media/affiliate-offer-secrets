-- 0052 recorded one number per product per day (gravity) and nothing else, which left two real
-- holes:
--
--   1. Only gravity had history. A product whose commission doubled while its gravity held steady
--      is a genuinely interesting move and was invisible.
--   2. marketplace_trending INNER JOINed marketplace_products for the title/category/urls — but
--      refreshMarketplaceCache PRUNES that table after every clean sweep, so a product that drops
--      out of the top-100 vanishes from the cache and takes its own history with it. The row it
--      needs to explain "this fell off a cliff" is exactly the row that disappears.
--
-- So the snapshot becomes the whole product, and the trending view reads from history alone.
-- Renamed to match what it now holds.
alter table public.marketplace_gravity_history rename to marketplace_product_history;
alter index if exists marketplace_gravity_history_recent_idx rename to marketplace_product_history_recent_idx;

alter table public.marketplace_product_history
  add column if not exists product_title text,
  add column if not exists category text,
  add column if not exists sub_category text,
  add column if not exists initial_sale double precision,
  add column if not exists avg_sale double precision,
  add column if not exists recurring double precision,
  add column if not exists sales_page_url text;

-- Backfill today's rows from the cache so the existing day isn't a half-empty outlier.
update public.marketplace_product_history h
set product_title = m.product_title,
    category = m.category,
    sub_category = m.sub_category,
    initial_sale = m.initial_sale,
    avg_sale = m.avg_sale,
    recurring = m.recurring,
    sales_page_url = m.sales_page_url
from public.marketplace_products m
where m.network = h.network and m.vendor_id = h.vendor_id
  and h.product_title is null;

-- Dropped rather than replaced: the column list changes, and `create or replace view` can only
-- change column definitions, never their names or order.
drop view if exists public.marketplace_trending;

-- Everything the view needs now lives in one row of history, so a product that has since dropped
-- out of the live cache still reports its own movement instead of silently disappearing.
create view public.marketplace_trending
with (security_invoker = true) as
with windowed as (
  select
    h.network,
    h.vendor_id,
    first_value(h.gravity) over w as first_gravity,
    last_value(h.gravity) over w as last_gravity,
    first_value(h.avg_sale) over w as first_avg_sale,
    last_value(h.avg_sale) over w as last_avg_sale,
    first_value(h.captured_on) over w as first_day,
    last_value(h.captured_on) over w as last_day,
    -- Latest row's own descriptive fields, so no join is needed at all.
    last_value(h.product_title) over w as product_title,
    last_value(h.category) over w as category,
    last_value(h.sub_category) over w as sub_category,
    last_value(h.recurring) over w as recurring,
    last_value(h.sales_page_url) over w as sales_page_url,
    count(*) over (partition by h.network, h.vendor_id) as readings,
    row_number() over (partition by h.network, h.vendor_id order by h.captured_on desc) as rn
  from public.marketplace_product_history h
  where h.captured_on >= current_date - interval '7 days'
  window w as (
    partition by h.network, h.vendor_id order by h.captured_on
    rows between unbounded preceding and unbounded following
  )
)
select
  w.network,
  w.vendor_id,
  w.product_title,
  w.category,
  w.sub_category,
  w.last_gravity as gravity,
  w.last_avg_sale as avg_sale,
  w.recurring,
  w.sales_page_url,
  w.first_gravity,
  w.last_gravity,
  w.last_gravity - w.first_gravity as gravity_change,
  case when w.first_gravity >= 1
    then round((((w.last_gravity - w.first_gravity) / w.first_gravity) * 100)::numeric, 1)
  end as gravity_change_pct,
  -- Payout movement, the thing 0052 couldn't see. Same >= 1 guard, for the same reason.
  w.last_avg_sale - w.first_avg_sale as avg_sale_change,
  case when w.first_avg_sale >= 1
    then round((((w.last_avg_sale - w.first_avg_sale) / w.first_avg_sale) * 100)::numeric, 1)
  end as avg_sale_change_pct,
  -- Whether the product is still in the current top-N sweep. A tenant should be able to tell
  -- "climbing" from "was climbing, then dropped out of the cache entirely".
  exists (
    select 1 from public.marketplace_products m
    where m.network = w.network and m.vendor_id = w.vendor_id
  ) as in_cache,
  w.first_day,
  w.last_day,
  w.readings
from windowed w
where w.rn = 1 and w.readings >= 2 and w.first_day <> w.last_day;

revoke all on public.marketplace_trending from anon, authenticated;
grant select on public.marketplace_trending to authenticated;
