-- Products that have just appeared in the marketplace. Now answerable, because 0053 stores a full
-- row per product per day: "new" is simply a product whose earliest snapshot is recent.
--
-- The one trap, guarded below: on the day history starts, EVERY product's first snapshot is that
-- day, so a naive query would announce 584 brand-new products. The first day of history is
-- therefore excluded outright — it's the day we started looking, not the day those products
-- launched. Nothing shows as new until the sweep has run at least twice, same honesty as trending.
create or replace view public.marketplace_new_products
with (security_invoker = true) as
with bounds as (
  select min(captured_on) as history_start from public.marketplace_product_history
),
first_seen as (
  select
    h.network,
    h.vendor_id,
    min(h.captured_on) as first_seen_on
  from public.marketplace_product_history h
  group by h.network, h.vendor_id
)
select
  f.network,
  f.vendor_id,
  m.product_title,
  m.category,
  m.sub_category,
  m.gravity,
  m.avg_sale,
  m.recurring,
  m.sales_page_url,
  f.first_seen_on,
  (current_date - f.first_seen_on) as days_known
from first_seen f
cross join bounds b
-- Joined to the live cache, not history: a "new" product that has ALREADY dropped back out of the
-- sweep isn't an opportunity, it's noise.
join public.marketplace_products m
  on m.network = f.network and m.vendor_id = f.vendor_id
where f.first_seen_on > b.history_start
  and f.first_seen_on >= current_date - interval '7 days';

revoke all on public.marketplace_new_products from anon, authenticated;
grant select on public.marketplace_new_products to authenticated;
