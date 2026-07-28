-- Widen ad_launches from one-per-campaign to one-per-angle-per-campaign, and add video-creative
-- support. Reconfirmed immediately before applying: ad_launches has 0 rows and the existing
-- constraint is exactly ad_launches_campaign_id_key UNIQUE (campaign_id) — safe to drop/replace.

alter table public.ad_launches drop constraint ad_launches_campaign_id_key;

alter table public.ad_launches
  add column angle_index integer not null default 0,
  add column creative_kind text not null default 'image' check (creative_kind in ('image', 'video')),
  add column meta_video_id text;

alter table public.ad_launches alter column angle_index drop default;

alter table public.ad_launches
  add constraint ad_launches_campaign_id_angle_index_key unique (campaign_id, angle_index);
