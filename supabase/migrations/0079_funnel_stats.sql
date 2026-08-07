-- Applied 2026-08-07. Per-funnel counts aggregated in Postgres instead of in the page.
--
-- /funnels was fetching every contact (capped at 1000), every bridge_variant and every funnel_step
-- row for the workspace, then grouping them into Maps in JS to render three numbers per row — the
-- same fetch-all-to-count shape 0049/0050 already replaced for /audit and the Marketplace tiles.
-- The .limit(1000) made it worse than slow: past a thousand leads the counts silently went WRONG.
--
-- security_invoker = true, same as audit_events/product_stats: each source table's RLS still
-- applies, so this exposes nothing a caller couldn't already read, and it keeps
-- "security definer view" off the advisors report.
--
-- Verified after applying: identical counts to the old grouping across all 14 campaigns, 1.06 ms.
create or replace view public.funnel_stats
with (security_invoker = true) as
select
  c.id as campaign_id,
  c.workspace_id,
  (select count(*) from public.contacts ct        where ct.campaign_id = c.id) as leads,
  (select count(*) from public.bridge_variants bv where bv.campaign_id = c.id) as variants,
  (select count(*) from public.funnel_steps fs    where fs.campaign_id = c.id) as steps
from public.campaigns c;

comment on view public.funnel_stats is
  'Per-campaign lead/variant/step counts for the Funnels list. security_invoker, so each source table''s RLS applies.';
