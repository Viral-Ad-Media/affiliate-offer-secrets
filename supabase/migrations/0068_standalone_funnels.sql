-- Funnels that aren't attached to an offer.
--
-- Until now a campaign always came from Promote, so product_id was reasonably NOT NULL. Now a
-- funnel can be built by hand for its own sake — a webinar registration, a lead magnet, a page you
-- point ads at before you've picked an offer — and demanding a product first made people attach an
-- arbitrary one just to get past the dialog, which is worse data than none.
alter table public.campaigns alter column product_id drop not null;

-- What to call a funnel that has no product to borrow a title from. Nullable: an AI-built
-- campaign still shows its product's title, and copying that here would go stale the moment the
-- product title changed.
alter table public.campaigns add column if not exists name text;

-- Where the opt-in page's call to action goes when there's no product, so no hoplink can be built.
-- With a product this stays null and the hoplink wins — one source of truth for the destination,
-- never two competing ones. ^https?:// mirrors the check on products.hoplink_override.
alter table public.campaigns add column if not exists cta_url text
  check (cta_url is null or cta_url ~ '^https?://');

-- unique (user_id, product_id) still stands: Postgres treats NULLs as distinct, so a workspace can
-- hold any number of standalone funnels while still being limited to one campaign per product.
