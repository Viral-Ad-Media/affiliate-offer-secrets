-- The kit's blog article lives on campaigns as blog_md, so its metadata belongs beside it.
--
-- These exist because blog_posts is created by finalizeBuildCampaign AFTER the content stage has
-- finished and its output is gone; without somewhere on campaigns to hold them, a generated
-- excerpt and meta description could not survive the gap between being written and the post row
-- being created. Copied onto the post by createPostFromCampaign, which is idempotent on
-- campaign_id, so a rebuild refreshes them.
--
-- Nullable with no default: null means "nothing generated", and every renderer already derives a
-- fallback from the body (postExcerpt in lib/blog.ts). So existing rows are unaffected and no
-- backfill is needed.
alter table campaigns
  add column if not exists blog_excerpt text,
  add column if not exists blog_seo_title text,
  add column if not exists blog_seo_description text;

comment on column campaigns.blog_excerpt is
  'Generated 1-2 sentence summary of blog_md. Copied to blog_posts.excerpt on build finalize.';
comment on column campaigns.blog_seo_title is
  'Generated <title>/og:title for the article. Copied to blog_posts.seo_title on build finalize.';
comment on column campaigns.blog_seo_description is
  'Generated meta description for the article. Copied to blog_posts.seo_description on finalize.';
