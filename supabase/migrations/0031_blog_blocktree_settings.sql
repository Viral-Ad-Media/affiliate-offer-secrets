-- Blog posts move onto the same PageBlockTree model the funnel editor uses (pageKind "blog" —
-- see lib/engine/validatePageBlockTree.ts): page_copy holds the validated tree, html the
-- write-time render (same page_copy/bridge_html relationship campaigns have). content_md stays
-- as the legacy source for pre-block-tree posts and is no longer written by the editor.
alter table public.blog_posts
  add column page_copy jsonb,
  add column html text;

-- Per-tenant blog settings shown on public post pages (/b/{postId}): blog name (title-tag
-- suffix) and author byline. One row per user; same owner-select/admin-write RLS shape as every
-- domain table since 0009.
create table public.blog_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blog_title text,
  author_name text,
  updated_at timestamptz not null default now()
);

alter table public.blog_settings enable row level security;
create policy "own blog settings" on public.blog_settings for select using (auth.uid() = user_id);
revoke insert, update, delete on public.blog_settings from anon, authenticated;
grant all on public.blog_settings to service_role;
