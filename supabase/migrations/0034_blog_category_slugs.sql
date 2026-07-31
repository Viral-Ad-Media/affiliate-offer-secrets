-- Category slugs for the public blog index's filter URLs (/b/{blog}?category={slug}).
-- Unique per blog, same shape as blog_posts.slug — two tenants can both have "reviews".
alter table public.blog_categories add column slug text;

-- Backfill from existing names using the same rules as lib/blog.ts's slugify(): lowercase,
-- non-alphanumerics collapse to single dashes, trimmed. Categories are per-user unique by name
-- already, and slugify is deterministic, so this can't produce an intra-user collision unless two
-- names differ only by punctuation — the index below would surface that as a hard failure here
-- rather than silently later, which is the right time to find out.
update public.blog_categories
set slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
where slug is null;

create unique index blog_categories_user_slug_idx
  on public.blog_categories (user_id, lower(slug)) where slug is not null;
