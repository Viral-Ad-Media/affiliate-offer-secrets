-- Provenance for a sequence auto-created from a campaign kit, so a rebuild refreshes the draft
-- instead of stacking a second one — the role blog_posts.campaign_id already plays for posts.
--
-- SEPARATE from the existing campaign_id column, which means AUDIENCE ("send to this campaign's
-- contacts"). An auto-created sequence sets both and they agree; a hand-made sequence can target a
-- campaign's contacts without having been generated from it, and must not be mistaken for one and
-- overwritten by the next rebuild.
alter table public.broadcast_sequences
  add column if not exists source_campaign_id uuid references public.campaigns(id) on delete set null;

comment on column public.broadcast_sequences.source_campaign_id is
  'The campaign whose kit generated this sequence. NULL for hand-made ones. Distinct from campaign_id, which is the audience scope.';

-- One auto-created sequence per campaign per workspace. Partial, so hand-made sequences (all NULL
-- here) are unaffected.
create unique index if not exists broadcast_sequences_one_per_source_campaign
  on public.broadcast_sequences (workspace_id, source_campaign_id)
  where source_campaign_id is not null;
