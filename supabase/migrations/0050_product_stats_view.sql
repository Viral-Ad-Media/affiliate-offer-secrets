-- Marketplace's stat tiles (products tracked, avg gravity, promoting/selected counts) used to be
-- derived in JS from the full products array — which is exactly why that page had to fetch every
-- product on every 5s poll. Aggregating in Postgres is what lets the list itself be paged.
--
-- security_invoker = true so products' own owner RLS applies: one row per user, and a caller only
-- ever sees theirs. Same reasoning as audit_events (0049).
create or replace view public.product_stats
with (security_invoker = true) as
select
  user_id,
  count(*)::int as total,
  count(*) filter (where status = 'Promoting')::int as promoting,
  count(*) filter (where status = 'Selected')::int as selected,
  -- Products with no gravity yet (manually added, or discovered but unscored) would drag a plain
  -- avg toward zero; ignoring the nulls answers "average of what we actually know".
  coalesce(avg(gravity) filter (where gravity is not null), 0)::float as avg_gravity
from public.products
group by user_id;

revoke all on public.product_stats from anon, authenticated;
grant select on public.product_stats to authenticated;

-- The list is ordered by (score, gravity) desc and always filtered by user_id.
create index if not exists products_user_score_gravity_idx
  on public.products (user_id, score desc nulls last, gravity desc nulls last);
