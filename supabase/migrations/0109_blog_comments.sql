-- Comments and review ratings on public blog posts.
--
-- This creates the app's SECOND anonymous, unauthenticated public write after /api/public/leads,
-- and it inherits that route's entire trust model deliberately: the post UUID plus server-side
-- validation is the boundary, per-post rate caps silently drop the excess with a 200, and the
-- reader-facing route never confirms whether a post exists. Like `contacts`, this table holds a
-- THIRD PARTY's PII (a commenter's name, optionally their email) — the tenant's visitor, not the
-- tenant.
--
-- EVERY comment starts 'pending' and only 'approved' rows ever render publicly. A machine-written
-- affiliate blog with an open comment box is a spam magnet; moderation-first is not optional
-- hygiene here, it is what makes an anonymous write surface acceptable at all.
create table if not exists public.blog_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  post_id uuid not null references public.blog_posts(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 1 and 80),
  -- Optional, never rendered publicly — collected so the tenant can reply, and covered by
  -- erase-by-address expectations like every other third-party address held here.
  author_email text,
  body text not null check (char_length(body) between 2 and 2000),
  -- The "review" half: an optional 1-5 star rating alongside the text. Null = a plain comment.
  rating integer check (rating between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'approved', 'spam')),
  created_at timestamptz not null default now()
);

-- Owner-select for the moderation UI; NO client write path of any kind. The only writer of new
-- rows is /api/public/comments on the admin client (an anonymous caller has no auth.uid() at
-- all), and moderation writes go through the authenticated /api/blog/comments route, which
-- re-resolves ownership before touching anything — the contacts/meta_posts shape exactly.
alter table public.blog_comments enable row level security;
create policy blog_comments_owner_select on public.blog_comments
  for select using (public.is_workspace_member(workspace_id));
revoke insert, update, delete on public.blog_comments from anon, authenticated;

-- The public post page reads approved-by-post on every view; the moderation queue reads
-- pending-by-workspace.
create index if not exists blog_comments_post_status_idx
  on public.blog_comments (post_id, status, created_at desc);
create index if not exists blog_comments_workspace_status_idx
  on public.blog_comments (workspace_id, status, created_at desc);

-- Per-blog controls, edited in Blog settings. Both default ON: the feature was asked for, and
-- moderation-first means enabling it exposes a form, never unreviewed content. Ratings are
-- separately togglable because a star average is a claim about the product a plain comment box
-- never makes, and some operators will want words without numbers.
alter table public.blog_settings
  add column if not exists comments_enabled boolean not null default true,
  add column if not exists ratings_enabled boolean not null default true;

comment on column public.blog_settings.comments_enabled is
  'Render the comment form and approved comments on public posts. Moderation-first: pending comments never render.';
comment on column public.blog_settings.ratings_enabled is
  'Offer the 1-5 star rating on the comment form and show the approved average.';
