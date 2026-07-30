-- Per-funnel analytics/tracking integrations: {ga4_id, gtm_id, clarity_id, meta_pixel_id},
-- injected into every publicly-served funnel page (opt-in, variants, steps) at render time.
-- These IDs are public by nature (they ship in page source on every site that uses them), so no
-- Vault treatment — what they DO need is strict per-provider format validation
-- (lib/engine/tracking.ts) at save time AND again at render time, since they're interpolated
-- into inline <script> text served raw to unauthenticated visitors. No CHECK constraint — same
-- 100%-app-layer-enforced shape as page_copy/fb_ad_angles/tracking's other jsonb siblings.
alter table public.campaigns add column tracking jsonb;
