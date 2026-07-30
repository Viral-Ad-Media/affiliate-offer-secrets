-- Blog manager: tenant-owned posts (seeded from campaigns.blog_md or written from scratch) with
-- user-created categories, published at a public per-post URL (/b/{postId} — the post UUID is the
-- access control, same convention as /p/{campaignId}). campaigns.blog_md itself stays untouched —
-- importing copies the markdown into a blog_posts row the tenant then owns/edits independently.
create table public.blog_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Where the content was imported from, if anywhere — history only, set null on campaign delete
  -- (a published post must outlive its source campaign, same reasoning as meta_posts.campaign_id).
  campaign_id uuid references public.campaigns(id) on delete set null,
  category_id uuid references public.blog_categories(id) on delete set null,
  title text not null,
  content_md text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index blog_posts_user_id_idx on public.blog_posts(user_id);
create index blog_categories_user_id_idx on public.blog_categories(user_id);

alter table public.blog_categories enable row level security;
alter table public.blog_posts enable row level security;

-- Owner-select, writes via API routes on the admin client only (server-side validation is the
-- write boundary — post content is publicly served markdown, see app/b/[postId]/route.ts's
-- render-time escaping). Same shape as every domain table since 0009.
create policy "own blog categories" on public.blog_categories for select using (auth.uid() = user_id);
create policy "own blog posts" on public.blog_posts for select using (auth.uid() = user_id);
revoke insert, update, delete on public.blog_categories, public.blog_posts from anon, authenticated;
grant all on public.blog_categories, public.blog_posts to service_role;
