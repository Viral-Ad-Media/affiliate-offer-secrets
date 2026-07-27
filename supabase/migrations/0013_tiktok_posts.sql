-- Audit trail for real TikTok video posts, same shape as meta_posts/instagram_posts.
create table public.tiktok_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  tiktok_publish_id text not null,
  caption text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.tiktok_posts enable row level security;
create policy "own tiktok posts" on public.tiktok_posts for select using (auth.uid() = user_id);
revoke insert, update, delete on public.tiktok_posts from anon, authenticated;
grant all on public.tiktok_posts to service_role;
