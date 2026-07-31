-- Tags for contacts. Until now a lead's only grouping was the campaign that captured it, which is
-- fixed at capture time — tags are the tenant's own axis (interest, source, funnel stage) and one
-- contact can carry several.
--
-- Same owner-select / no-client-write shape as blog_categories and every domain table since 0009:
-- all writes go through API routes on the admin client, which is where validation lives.
create table if not exists public.contact_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

-- One tag per name per tenant, case-insensitively — "VIP" and "vip" are the same tag to a person,
-- so they should be the same row.
create unique index if not exists contact_tags_user_name_idx
  on public.contact_tags (user_id, lower(trim(name)));
create index if not exists contact_tags_user_id_idx on public.contact_tags (user_id);

create table if not exists public.contact_tag_links (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tag_id uuid not null references public.contact_tags(id) on delete cascade,
  -- Denormalised so the owner-select policy is a plain column check, matching how every other
  -- join-ish table here (broadcast_sequence_contacts) does it.
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);
create index if not exists contact_tag_links_tag_idx on public.contact_tag_links (tag_id);
create index if not exists contact_tag_links_user_idx on public.contact_tag_links (user_id);

alter table public.contact_tags enable row level security;
alter table public.contact_tag_links enable row level security;

create policy "own contact tags" on public.contact_tags for select using (auth.uid() = user_id);
create policy "own contact tag links" on public.contact_tag_links for select using (auth.uid() = user_id);

revoke insert, update, delete on public.contact_tags from anon, authenticated;
revoke insert, update, delete on public.contact_tag_links from anon, authenticated;
grant all on public.contact_tags to service_role;
grant all on public.contact_tag_links to service_role;
