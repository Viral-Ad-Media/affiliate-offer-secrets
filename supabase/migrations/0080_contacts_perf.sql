-- Contacts: make the list's real access pattern indexable, and count tag membership in Postgres.
--
-- Two problems, both of the "fine at 1 row, wrong shape at 50,000" kind that this codebase has now
-- hit three times (the Contacts .limit(1000), the Funnels fetch-all-to-count, this).

-- 1. The leads list is ALWAYS `where workspace_id = $1 order by created_at desc` + a page range.
--    contacts_workspace_id_idx covers only the equality, so Postgres has to read every one of that
--    workspace's leads and sort them to answer page 1 — the cost grows with the whole table while
--    the page stays 50 rows. A composite index in the sort's own direction makes it an index scan
--    with no sort node at any size.
--    contacts_campaign_created_idx (0017) does NOT help here: its leading column is campaign_id,
--    and this query never filters on one.
create index if not exists contacts_workspace_created_idx
  on public.contacts (workspace_id, created_at desc);

-- 2. /contacts/tags fetched EVERY contact_tag_links row for the workspace and counted them into a
--    Map in JS. Past PostgREST's default 1000-row ceiling those counts would have been silently
--    WRONG, not merely slow — the same failure the Funnels page had, and worth fixing before a
--    tenant with real lead volume tags anything in bulk.
--
--    security_invoker, matching audit_events (0049) / product_stats (0050) / funnel_stats (0079):
--    each source table's own RLS still applies, so a caller sees only their own workspaces' tags,
--    and it keeps "security definer view" off the advisors report.
create or replace view public.contact_tag_counts
with (security_invoker = true) as
select
  t.id            as tag_id,
  t.workspace_id,
  (select count(*) from public.contact_tag_links l where l.tag_id = t.id) as contact_count
from public.contact_tags t;

comment on view public.contact_tag_counts is
  'Per-tag lead counts. Aggregated in Postgres so the tags page never fetches link rows to count them.';
