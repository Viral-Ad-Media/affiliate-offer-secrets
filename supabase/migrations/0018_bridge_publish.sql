-- Bridge pages used to be publicly servable the instant a campaign hit status='ready' — the
-- campaign UUID was the only access control. This adds an explicit publish/draft gate on top of
-- that: a freshly built (or freshly edited) bridge page starts as a draft and isn't publicly
-- reachable until the tenant explicitly publishes it (see app/api/campaigns/[id]/publish/route.ts).
-- No backfill needed: at the time of this migration there are zero rows in ad_launches or
-- custom_domain_routes (verified via execute_sql before writing this), so no real ad traffic is
-- currently depending on any campaign's bridge page being publicly reachable — every existing
-- 'ready' campaign safely defaults to unpublished, same as a brand-new one.
alter table public.campaigns
  add column bridge_published boolean not null default false;
