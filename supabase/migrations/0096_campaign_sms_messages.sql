-- The kit's SMS sequence: [{ body }], one row per message, in send order.
--
-- jsonb rather than a child table, matching fb_ad_angles and social_posts: generated copy belonging
-- to one campaign, rewritten wholesale on every rebuild, never queried across campaigns.
--
-- Structured from the start rather than a markdown blob like email_md, because that blob is the one
-- asset whose shape had to be REVERSE-ENGINEERED later (lib/broadcast/fromCampaign.ts's
-- parseEmailMd handles two different heading formats the model emits). No reason to repeat that.
--
-- No CHECK on length: MAX_SMS_BODY is a segment-cost rule that changes if we ever support unicode
-- or long-code sending, and lib/sms.ts already clamps on the way in.
alter table public.campaigns
  add column if not exists sms_messages jsonb;

comment on column public.campaigns.sms_messages is
  'Generated SMS sequence: [{ body }]. The STOP opt-out is NOT stored here — it is code-owned in lib/sms.ts and appended at compose time.';
