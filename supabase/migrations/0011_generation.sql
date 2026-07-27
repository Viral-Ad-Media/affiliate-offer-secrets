-- Phase F: AI image (ad creatives) + video generation, real TikTok/YouTube/Reels posting.
-- No new RLS surface needed — campaigns' existing "for select using (auth.uid()=user_id)" policy
-- (tightened in 0009_page_domains.sql) already covers these new columns; all writes go through
-- createAdminClient() in the job worker, same as every other campaign field.

alter table public.campaigns
  -- Kept fully separate from embedded_image_data_url (the vendor-extracted photo used for
  -- presell/bridge pages and Instagram photo posts) — this column is ad-creative-only.
  add column ad_creative_image_data_url text,
  -- A Supabase Storage object path (e.g. "{campaignId}.mp4"), not a full URL — the
  -- campaign-videos bucket is private, so a signed URL is minted fresh at each posting call
  -- rather than stored (see lib/supabase/storage.ts).
  add column video_path text,
  add column video_status text not null default 'none' check (video_status in ('none', 'generating', 'ready', 'failed')),
  add column video_error text;
