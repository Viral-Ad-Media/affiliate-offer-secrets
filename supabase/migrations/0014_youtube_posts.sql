-- Audit trail for real YouTube uploads, same shape as meta_posts/instagram_posts/tiktok_posts.
create table public.youtube_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  youtube_video_id text not null,
  title text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

alter table public.youtube_posts enable row level security;
create policy "own youtube posts" on public.youtube_posts for select using (auth.uid() = user_id);
revoke insert, update, delete on public.youtube_posts from anon, authenticated;
grant all on public.youtube_posts to service_role;
