-- Public blog: SEO slugs, featured images, richer author/blog identity, and custom-domain hosting.
--
-- URL model (replaces the old /b/{uuid} post links — free to change, nothing was published yet):
--   /b/{blog_slug}                 → the tenant's blog index
--   /b/{blog_slug}/{post_slug}     → a post
--   {connected domain}/            → same index, when custom_domains.serves_blog
--   {connected domain}/{post_slug} → same post
-- Old /b/{uuid} links still resolve (301 to the canonical slug URL) so anything already shared
-- keeps working.

alter table public.blog_settings
  add column slug text,
  add column description text,      -- tagline under the blog title on the index
  add column author_bio text,
  add column author_avatar_url text; -- data URL, same validated-image convention as elsewhere

-- Case-insensitive and global: the blog slug is the public handle in /b/{slug}, so it can't
-- collide across tenants. Partial so tenants who never name their blog don't collide on NULL.
create unique index blog_settings_slug_idx
  on public.blog_settings (lower(slug)) where slug is not null;

alter table public.blog_posts
  add column slug text,
  add column excerpt text,               -- index card + meta description fallback
  add column featured_image_url text,    -- data URL
  -- Mirrors campaigns.video_status: drives the AI-generation job's UI state.
  add column featured_image_status text not null default 'none'
    check (featured_image_status in ('none', 'generating', 'ready', 'failed')),
  add column featured_image_error text;

-- Post slugs only need to be unique WITHIN a blog — two tenants can both have /why-plans-fail.
create unique index blog_posts_user_slug_idx
  on public.blog_posts (user_id, lower(slug)) where slug is not null;

-- Opt-in: when true, this domain serves the owner's blog. Explicit custom_domain_routes still
-- win on any path they map (app/d/[[...path]]/route.ts checks routes first, blog second), so a
-- domain can host funnel pages at mapped paths AND the blog everywhere else.
alter table public.custom_domains
  add column serves_blog boolean not null default false;
