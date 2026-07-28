-- Phase I: structured ad angles / social posts + per-item image/video creative generation.
-- fb_ads_md/social_md were flat markdown strings with no per-item addressability (3 angles / 5
-- captions as prose inside one string each). New builds populate these structured arrays instead
-- and stop writing fb_ads_md/social_md; old rows keep their legacy flat text, unread by the new
-- UI — same precedent as profiles.nickname/campaigns.presell_html/campaigns.landing_md. No CHECK
-- on array shape/length here, matching page_copy's existing precedent — enforced by the LLM's
-- JSON Schema (minItems/maxItems) and defensive app-code validation, not the DB layer.
alter table public.campaigns
  add column fb_ad_angles jsonb,   -- array of {headline, primary_text, description, cta}, exactly 3
  add column social_posts jsonb;   -- array of {caption}, exactly 5

-- One row per (campaign, source item, media kind) — generalizes the single-per-campaign
-- ad_creative_image_data_url / video_path columns into an addressable per-item slot. Same
-- owner-select-only RLS + admin-client-only-write pattern as every other domain table in this app.
create table public.campaign_creatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source text not null check (source in ('fb_ad_angle', 'social_post')),
  item_index integer not null check (item_index >= 0),
  kind text not null check (kind in ('image', 'video')),
  status text not null default 'none' check (status in ('none', 'generating', 'ready', 'failed')),
  image_data_url text,
  video_path text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, source, item_index, kind)
);

create index campaign_creatives_campaign_id_idx on public.campaign_creatives(campaign_id);

alter table public.campaign_creatives enable row level security;
create policy "own campaign creatives" on public.campaign_creatives for select using (auth.uid() = user_id);
revoke insert, update, delete on public.campaign_creatives from anon, authenticated;
grant all on public.campaign_creatives to service_role;

-- Atomic per-row generation claim in one round trip — PostgREST's .upsert({onConflict}) can't
-- express a conditional WHERE on the UPDATE arm of an upsert (same limitation already documented
-- for the contacts de-dupe index in 0017_contacts.sql), so this replaces what would otherwise be
-- a per-row analogue of generate-video/route.ts's UPDATE...WHERE...RETURNING concurrency claim.
-- Returns the claimed row's id, or NULL if it was already 'generating' (the WHERE clause on the
-- DO UPDATE means neither insert nor update branch fires, so RETURNING yields nothing — not an
-- error, just "someone else already claimed this").
create or replace function public.claim_campaign_creative(
  p_campaign_id uuid, p_source text, p_item_index integer, p_kind text
) returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.campaigns where id = p_campaign_id and user_id = auth.uid()) then
    raise exception 'Campaign not found for this account';
  end if;

  insert into public.campaign_creatives (user_id, campaign_id, source, item_index, kind, status)
  values (auth.uid(), p_campaign_id, p_source, p_item_index, p_kind, 'generating')
  on conflict (campaign_id, source, item_index, kind)
  do update set status = 'generating', error = null, updated_at = now()
  where campaign_creatives.status <> 'generating'
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.claim_campaign_creative(uuid, text, integer, text) from public, anon;
grant execute on function public.claim_campaign_creative(uuid, text, integer, text) to authenticated;
