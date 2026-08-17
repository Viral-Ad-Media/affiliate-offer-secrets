-- Per-item TikTok scripts, so each one can own a generated video the way an ad angle does.
-- Applied 2026-08-17.
--
-- campaign_creatives is keyed on (campaign_id, source, item_index, kind) — it needs an INDEX to
-- attach a creative to. tiktok_md is one markdown blob, so there was nothing to index and no way to
-- say "the video for script 2". Structuring the scripts is the whole unlock; the creative machinery
-- is otherwise source-agnostic.
--
-- Same shape fb_ad_angles and social_posts took, with the legacy flat string left in place and
-- unread for old rows rather than parsed. That precedent matters here specifically: email_md is the
-- asset whose blob had to be reverse-engineered later, and it emitted two different heading shapes
-- across rows. Structured from now on avoids repeating it.
alter table public.campaigns
  add column if not exists tiktok_scripts jsonb;

comment on column public.campaigns.tiktok_scripts is
  'Generated TikTok scripts: [{ hook, script }]. Legacy rows keep the flat tiktok_md instead.';

-- The third creative source. A CHECK has to be replaced wholesale to widen it. Kept in step with
-- CreativeSource (lib/shared.ts) and KNOWN_SOURCES in the generate route — all three list the same
-- values, and missing one shows up as a Generate button that 400s without saying which layer said no.
alter table public.campaign_creatives
  drop constraint if exists campaign_creatives_source_check;
alter table public.campaign_creatives
  add constraint campaign_creatives_source_check
  check (source in ('fb_ad_angle', 'social_post', 'tiktok_script'));
