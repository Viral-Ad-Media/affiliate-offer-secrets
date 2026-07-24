-- Replaces upsertProduct's client-side check-then-insert-or-update (lib/engine/core.ts) with a
-- single atomic INSERT ... ON CONFLICT. The client-side version raced under real-world
-- conditions the automated worker actually hits — the same vendor_id appearing twice in one
-- marketplace response, or a job retry re-processing hits already saved by an earlier attempt —
-- producing spurious "duplicate key" failures. One atomic statement removes the race entirely.
--
-- Merge semantics match the original TS logic exactly: gravity/initial_sale/avg_sale/recurring/
-- commission_pct always take the fresh incoming value when present (marketplace stats change
-- daily); every other field only fills a gap that's currently null.

create or replace function public.upsert_product(p_user_id uuid, p_meta jsonb)
returns public.products
language plpgsql
security definer set search_path = public
as $$
declare
  result public.products;
begin
  insert into public.products (
    user_id, vendor_id, niche, product_title, description, gravity, initial_sale,
    avg_sale, recurring, commission_pct, sales_page_url, affiliate_page_url, hoplink,
    score, angle_notes, page_verified, status, assets_link, date_added
  )
  values (
    p_user_id,
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
  on conflict (user_id, vendor_id) do update set
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
