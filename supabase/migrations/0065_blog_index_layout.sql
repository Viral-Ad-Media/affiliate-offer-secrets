-- How the blog home lists its posts: grid or list, and how big the page is.
--
-- Columns and rows together decide the page size, not just the look: a 3x4 grid shows 12 posts
-- per page, a list of 8 shows 8. Making these two settings instead of three keeps the pager and
-- the visible layout from disagreeing, which is what a separate "posts per page" field would
-- eventually do.
--
-- The bounds are CHECK constraints rather than app-only validation because these numbers reach a
-- CSS grid-template-columns value on a public page; the API clamps too, but the DB is what makes
-- "columns is 1-4" true regardless of which write path runs.
alter table public.blog_settings
  add column if not exists index_layout text not null default 'grid'
    check (index_layout in ('grid', 'list')),
  add column if not exists index_columns integer not null default 3
    check (index_columns between 1 and 4),
  add column if not exists index_rows integer not null default 4
    check (index_rows between 1 and 12);

-- No RLS change: blog_settings is still owner-select with writes via the admin client only
-- (0031), and these columns are covered by the existing policy.
