-- The funnel type a page was built as, so the editor can tell you what that kind of funnel still
-- needs. It was previously accepted by POST /api/funnels, used to seed the steps and the starter
-- copy, and then thrown away — nothing recorded what a funnel was meant to BE, which is exactly
-- what a "required elements" checklist has to key off.
--
-- Nullable, and no CHECK constraint on the value. The set of funnel types lives in
-- lib/funnelTypes.ts and grows as capability lands (VSL and Webinar only became buildable when the
-- video block shipped); a CHECK would mean a migration every time that list changes, for a column
-- only ever written by the admin client through a route that already validates against
-- isBuildable(). Same app-layer-enforced shape as page_copy/fb_ad_angles.
alter table public.campaigns add column if not exists funnel_type text;

-- Existing campaigns are all AI-generated kits, and what stagePages actually builds is the
-- advertorial-then-opt-in page that content rule 8 describes — that IS the bridge funnel, so this
-- is a statement of fact rather than a guess. A funnel with no type still renders a generic
-- checklist, so a wrong backfill would be misleading rather than harmless; 'bridge' is the one
-- value that is true of every row here.
update public.campaigns set funnel_type = 'bridge' where funnel_type is null;

comment on column public.campaigns.funnel_type is
  'lib/funnelTypes.ts key. Drives the editor''s required-elements checklist. Null = generic checklist.';
