-- Per-item SEO overrides for the two publicly-served page kinds a tenant authors: blog posts
-- (/b/{postId}) and funnel pages (opt-in via campaigns, plus each funnel step). All optional —
-- empty falls back to the derived defaults (post/product title, first-paragraph excerpt).
-- seo_index is an explicit noindex switch; funnel pages already send noindex unconditionally, so
-- there it only ever tightens, never loosens.
alter table public.blog_posts
  add column seo_title text,
  add column seo_description text,
  add column seo_index boolean not null default true;

alter table public.campaigns
  add column seo_title text,
  add column seo_description text;

alter table public.funnel_steps
  add column seo_title text,
  add column seo_description text;
