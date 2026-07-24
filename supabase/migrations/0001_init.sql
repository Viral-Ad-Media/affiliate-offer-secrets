-- ClickBank Studio — multi-tenant schema (Phase A)
-- Ports lib/db.ts (SQLite, single-user) to Postgres with per-user Row Level Security.

create extension if not exists "pgcrypto";

-- One row per signed-up user. Created automatically by a trigger on auth.users (below).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,                          -- ClickBank affiliate nickname
  access_granted boolean not null default false,  -- one-time access fee paid
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vendor_id text not null,
  niche text not null,
  product_title text not null,
  description text,
  gravity numeric,
  initial_sale numeric,
  avg_sale numeric,
  recurring numeric,
  commission_pct numeric,
  sales_page_url text,
  affiliate_page_url text,
  hoplink text,
  score integer,
  angle_notes text,
  page_verified boolean not null default false,
  status text not null default 'New',
  assets_link text,
  date_added date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, vendor_id)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  status text not null default 'building',
  folder text,
  drive_link text,
  hoplinks_txt text,
  fb_ads_md text,
  tiktok_md text,
  landing_md text,
  presell_html text,
  bridge_html text,
  blog_md text,
  social_md text,
  email_md text,
  images_json jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only. Balance = SUM(delta) per user. Positive = top-up, negative = spend authorization.
create table public.credits_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Stripe payment audit trail + webhook idempotency guard.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_session_id text not null unique,
  type text not null check (type in ('access', 'credits')),
  amount_cents integer not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Row Level Security: every tenant-owned table is scoped to auth.uid() = user_id.
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.campaigns enable row level security;
alter table public.jobs enable row level security;
alter table public.credits_ledger enable row level security;
alter table public.payments enable row level security;

create policy "own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "own products" on public.products
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own campaigns" on public.campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own jobs" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own credits" on public.credits_ledger
  for select using (auth.uid() = user_id);

create policy "own payments" on public.payments
  for select using (auth.uid() = user_id);

-- Only the service role (used by the engine CLI and Stripe webhook) can write credits/payments/
-- profiles.access_granted directly — regular users never insert/update these themselves.
