-- Applied via the Supabase MCP on 2026-07-31.
-- Permalink structure for post URLs, per tenant. Applies to the path AFTER the blog root, so it
-- works the same on the app domain (/b/{blogSlug}/…) and on a connected domain (where the blog is
-- the site root). The blog root itself stays /b/{blogSlug} on the app domain — that prefix is a
-- real Next.js route segment, not a per-tenant string, and moving it would collide with the
-- authenticated /blog manager.
--
-- No backfill needed: 'post' is exactly today's behaviour. Changing the style doesn't break
-- existing links either — the serving routes resolve a post by its final slug segment and 301 any
-- non-canonical path to the current structure.
alter table public.blog_settings
  add column if not exists permalink_style text not null default 'post'
    check (permalink_style in ('post', 'date-post', 'category-post'));

-- Shown on the blog index when that category's filter is active. Same free-text treatment as
-- blog_settings.description; length is capped in the API route, not here, matching how every
-- other user-authored string in this schema is handled.
alter table public.blog_categories
  add column if not exists description text;
