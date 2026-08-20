-- Retargeting ad angles: a distinct asset from the cold-traffic fb_ad_angles, written for WARM
-- audiences — people who already visited the offer and did NOT buy. Different job: acknowledge the
-- prior visit, handle the top objection, add reciprocity/urgency ONLY where the sales page supports
-- it. Same jsonb shape as fb_ad_angles ({headline, primary_text, description, cta}), so the same
-- per-angle card renders both.
--
-- Seeded FROM the campaign's existing cold angles (which were already generated from the sales page,
-- so every claim stays traceable — content rule 1) rather than a fresh sales-page fetch. NULL until
-- generated; unread and unchanged for every existing campaign.

alter table public.campaigns
  add column if not exists retargeting_angles jsonb;

comment on column public.campaigns.retargeting_angles is
  'Warm-audience retargeting ad angles (0121), same shape as fb_ad_angles. NULL until generated via /api/campaigns/[id]/retargeting-angles.';
