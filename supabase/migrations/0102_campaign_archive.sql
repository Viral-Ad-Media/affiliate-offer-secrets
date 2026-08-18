-- Archiving a funnel: out of the way, still there.
--
-- Deleting a campaign is not the reversible action people reach for when a funnel is simply
-- finished. A campaign row IS the whole kit — ad angles, TikTok scripts, the email sequence, the
-- blog source, every funnel step, the split-test variants — so "delete this funnel" destroys work
-- that has nothing to do with the funnel page. Archive is the action that matches the intent.
--
-- A nullable timestamp rather than a status enum, matching published_at's precedent on blog_posts:
-- it records WHEN, and "is it archived" is derivable from it. A second status column would have to
-- be kept in step with bridge_published, which is a different question (is it public) that stays
-- independently meaningful — an archived funnel that is still published keeps serving, and the
-- list says so rather than silently taking traffic offline.
alter table campaigns add column if not exists archived_at timestamptz;

comment on column campaigns.archived_at is
  'When this funnel was archived. Null = active. Hidden from the default funnels list; never affects public serving — unpublish is the control for that.';

-- The funnels list filters on it on every load, alongside the workspace scope it already uses.
create index if not exists campaigns_workspace_archived_idx
  on campaigns (workspace_id, archived_at);
