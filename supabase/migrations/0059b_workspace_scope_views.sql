-- Both security_invoker views carried only user_id through from their underlying tables, so
-- /audit and the Marketplace tiles would have kept showing just the signed-in member's rows even
-- though the tables beneath them are workspace-scoped.
--
-- product_stats groups by workspace ALONE: grouping by (workspace, user) would emit one partial
-- tile row per member instead of one describing the workspace. audit_events keeps user_id too,
-- since "who did this" is worth displaying on an activity log.
--
-- security_invoker = true is preserved on both — it is what makes each underlying table's own RLS
-- apply to the caller, so neither view ever widens visibility (0049/0050).

drop view if exists public.audit_events;
create view public.audit_events with (security_invoker = true) as
  select p.id, p.user_id, p.workspace_id, 'facebook'::text as platform, p.created_at, p.campaign_id,
         p.message as summary, ('Page '::text || p.page_id) as detail, p.fb_post_id as external_id
    from meta_posts p
  union all
  select p.id, p.user_id, p.workspace_id, 'instagram'::text, p.created_at, p.campaign_id,
         p.caption, null::text, null::text from instagram_posts p
  union all
  select p.id, p.user_id, p.workspace_id, 'tiktok'::text, p.created_at, p.campaign_id,
         p.caption, null::text, null::text from tiktok_posts p
  union all
  select p.id, p.user_id, p.workspace_id, 'youtube'::text, p.created_at, p.campaign_id,
         p.title, null::text, p.youtube_video_id from youtube_posts p
  union all
  select s.id, s.user_id, s.workspace_id, 'mail'::text, s.created_at, s.campaign_id,
         s.subject, s.to_address, s.message_id from mail_sends s
  union all
  select b.id, b.user_id, b.workspace_id, 'broadcast'::text, b.created_at, b.campaign_id,
         b.subject, b.to_address, b.message_id from broadcast_sends b;

drop view if exists public.product_stats;
create view public.product_stats with (security_invoker = true) as
  select workspace_id,
         count(*)::integer as total,
         count(*) filter (where status = 'Promoting')::integer as promoting,
         count(*) filter (where status = 'Selected')::integer as selected,
         (coalesce(avg(gravity) filter (where gravity is not null), 0::numeric))::double precision
           as avg_gravity
    from products
   group by workspace_id;
