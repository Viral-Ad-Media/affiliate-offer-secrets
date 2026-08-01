-- "Trending" needs change over time, and nothing here recorded any: marketplace_products holds one
-- row per product and the daily sweep overwrites it. Without history, a "Trending" tab could only
-- ever be a second ranking of the same snapshot wearing a different label — so this table records
-- one gravity reading per product per day, appended by the same sweep.
--
-- Consequence, stated plainly rather than hidden: the Trending list is empty until at least two
-- daily sweeps have run. The UI says so. That's better than inventing movement from a single
-- snapshot.
--
-- Shared marketplace data like marketplace_products (0029) — no user_id, authenticated-select,
-- service_role writes.
create table if not exists public.marketplace_gravity_history (
  network text not null,
  vendor_id text not null,
  captured_on date not null,
  gravity double precision,
  primary key (network, vendor_id, captured_on)
);

-- The trending query reads "all rows for a product within the window", so that's the index.
create index if not exists marketplace_gravity_history_recent_idx
  on public.marketplace_gravity_history (captured_on desc);

alter table public.marketplace_gravity_history enable row level security;
create policy "read marketplace history" on public.marketplace_gravity_history
  for select to authenticated using (true);
revoke insert, update, delete on public.marketplace_gravity_history from anon, authenticated;
grant all on public.marketplace_gravity_history to service_role;

-- Gravity movement over the last week. first/last are the earliest and latest readings INSIDE the
-- window, not fixed days — a product added to the sweep three days ago still gets a truthful
-- 3-day delta instead of being excluded or compared against a zero it never had.
create or replace view public.marketplace_trending
with (security_invoker = true) as
with windowed as (
  select
    h.network,
    h.vendor_id,
    first_value(h.gravity) over w as first_gravity,
    last_value(h.gravity) over w as last_gravity,
    first_value(h.captured_on) over w as first_day,
    last_value(h.captured_on) over w as last_day,
    count(*) over (partition by h.network, h.vendor_id) as readings,
    row_number() over (partition by h.network, h.vendor_id order by h.captured_on desc) as rn
  from public.marketplace_gravity_history h
  where h.captured_on >= current_date - interval '7 days'
  window w as (
    partition by h.network, h.vendor_id order by h.captured_on
    rows between unbounded preceding and unbounded following
  )
)
select
  w.network,
  w.vendor_id,
  m.product_title,
  m.category,
  m.sub_category,
  m.gravity,
  m.avg_sale,
  m.recurring,
  m.sales_page_url,
  w.first_gravity,
  w.last_gravity,
  w.last_gravity - w.first_gravity as gravity_change,
  -- Percent change is only meaningful off a non-trivial base: a product going 0.1 -> 1.0 is
  -- +900% and tells you nothing, so anything under 1.0 gravity reports null and is ranked by the
  -- absolute change instead.
  case when w.first_gravity >= 1
    then round((((w.last_gravity - w.first_gravity) / w.first_gravity) * 100)::numeric, 1)
  end as gravity_change_pct,
  w.first_day,
  w.last_day,
  w.readings
from windowed w
join public.marketplace_products m
  on m.network = w.network and m.vendor_id = w.vendor_id
-- Two readings on different days is the minimum that can show movement at all.
where w.rn = 1 and w.readings >= 2 and w.first_day <> w.last_day;

revoke all on public.marketplace_trending from anon, authenticated;
grant select on public.marketplace_trending to authenticated;
