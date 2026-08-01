-- One row per real outbound action, across the six tables the Audit trail merges. Exists so that
-- page can run ONE ordered, counted, ranged query instead of fetching N rows from each table and
-- merging/trimming in JS — which grew without bound as a tenant posts and sends.
--
-- security_invoker = true is load-bearing: the view is queried by the signed-in user's own client,
-- so each underlying table's existing owner-select RLS policy still applies and a tenant sees only
-- their own rows. Without it the view would run as its owner and leak every tenant's activity —
-- and it's also what keeps `security definer view` off the advisors report.
--
-- user_id is exposed so callers can keep their explicit .eq("user_id", …) alongside RLS, matching
-- the style of every other list query in this app.
create or replace view public.audit_events
with (security_invoker = true) as
  select
    p.id,
    p.user_id,
    'facebook'::text as platform,
    p.created_at,
    p.campaign_id,
    p.message as summary,
    'Page ' || p.page_id as detail,
    p.fb_post_id as external_id
  from public.meta_posts p
union all
  select p.id, p.user_id, 'instagram', p.created_at, p.campaign_id, p.caption, null, null
  from public.instagram_posts p
union all
  select p.id, p.user_id, 'tiktok', p.created_at, p.campaign_id, p.caption, null, null
  from public.tiktok_posts p
union all
  select p.id, p.user_id, 'youtube', p.created_at, p.campaign_id, p.title, null, p.youtube_video_id
  from public.youtube_posts p
union all
  select p.id, p.user_id, 'mail', p.created_at, p.campaign_id, p.subject, 'to ' || p.to_address, null
  from public.mail_sends p
union all
  select
    p.id, p.user_id, 'broadcast', p.created_at, p.campaign_id, p.subject,
    'to ' || p.to_address || case when p.status = 'failed' then ' — failed' else '' end,
    null
  from public.broadcast_sends p;

-- Read-only by construction: a UNION view isn't updatable in Postgres, but be explicit rather than
-- relying on that.
revoke all on public.audit_events from anon, authenticated;
grant select on public.audit_events to authenticated;

-- Each branch of the UNION filters and sorts by (user_id, created_at); without these the planner
-- reads every row of all six tables on every page.
create index if not exists meta_posts_user_created_idx on public.meta_posts (user_id, created_at desc);
create index if not exists instagram_posts_user_created_idx on public.instagram_posts (user_id, created_at desc);
create index if not exists tiktok_posts_user_created_idx on public.tiktok_posts (user_id, created_at desc);
create index if not exists youtube_posts_user_created_idx on public.youtube_posts (user_id, created_at desc);
create index if not exists mail_sends_user_created_idx on public.mail_sends (user_id, created_at desc);
create index if not exists broadcast_sends_user_created_idx on public.broadcast_sends (user_id, created_at desc);
