-- A tenant-supplied affiliate link that replaces the one this app derives.
--
-- Every hoplink so far has been CONSTRUCTED — buildHoplink(network, affiliateId, vendorId, tid) —
-- from the affiliate ID in network_connections and the vendor id on the product. That is right
-- almost always, and wrong in the cases that matter most: a vendor with a non-standard hop domain,
-- a product promoted through a sub-affiliate or agency account, an offer whose network hands out a
-- pre-built tracking URL, or simply a vendor id this app guessed wrong from the marketplace feed.
-- When it IS wrong, every ad, page and email in the kit points somewhere that pays nobody.
--
-- An OVERRIDE rather than making `hoplink` editable directly, deliberately: products.hoplink is
-- rewritten by discovery/upsert on every refresh, so an edit made there would be silently reverted
-- the next time the marketplace was swept. A separate nullable column is never touched by the
-- engine, so the tenant's value survives, and clearing it falls straight back to the derived link
-- with no second "is this custom?" flag to keep in sync.
alter table public.products
  add column if not exists hoplink_override text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_hoplink_override_url') then
    -- Scheme allowlist, not general URL validation. This value becomes a real href on pages served
    -- to paid traffic, so the thing actually worth stopping is javascript:/data: — the same cheap
    -- guard lib/validate.ts's isValidRedirectUrl applies to funnel redirect URLs, enforced here as
    -- well because products is directly PATCH-able through PostgREST (its RLS is `for all`, unlike
    -- campaigns' select-only), so the route cannot be the only check.
    alter table public.products
      add constraint products_hoplink_override_url
      check (
        hoplink_override is null
        or (hoplink_override ~ '^https?://' and char_length(hoplink_override) between 8 and 2000)
      );
  end if;
end $$;
