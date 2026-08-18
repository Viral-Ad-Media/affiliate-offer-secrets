-- One auto-created sequence per campaign PER CHANNEL.
--
-- 0094's index was (workspace_id, source_campaign_id), written when email was the only channel a
-- kit could produce a drip for. A kit now generates SMS messages too (0096), and turning those
-- into a draft SMS sequence collides with the email sequence already holding the campaign's slot —
-- so the second channel could never be auto-created at all. Channel joins the key; the WHERE
-- clause keeps hand-made sequences (source_campaign_id null) entirely outside the constraint,
-- exactly as before.
drop index if exists broadcast_sequences_one_per_source_campaign;
create unique index broadcast_sequences_one_per_source_campaign
  on public.broadcast_sequences (workspace_id, source_campaign_id, channel)
  where source_campaign_id is not null;
