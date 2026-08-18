-- Archive, for the two remaining lists that accumulate.
--
-- Same shape as campaigns.archived_at (0102): a nullable timestamp, not a status value. Both these
-- tables already HAVE a status that means something else and must keep meaning it —
-- broadcast_sequences.status drives whether the sweep enrolls and sends, and blog_posts.status
-- drives whether the public route serves. Folding "put away" into either would make archiving a
-- sequence silently stop its sends, or archiving a post silently unpublish it. Those are separate
-- decisions and stay separate controls.
--
-- Deliberately NOT added to products: products.status already has `Dead`, and My Products opens
-- filtered to Selected/Promoting/Paused, so Dead already IS the archive. A second overlapping
-- concept would give one row two answers to "is this put away".
alter table broadcast_sequences add column if not exists archived_at timestamptz;
alter table blog_posts add column if not exists archived_at timestamptz;

comment on column broadcast_sequences.archived_at is
  'When this sequence was archived. Null = active. Hidden from the default list; never affects sending — pause is the control for that.';
comment on column blog_posts.archived_at is
  'When this post was archived. Null = active. Hidden from the default list; never affects public serving — status is the control for that.';

create index if not exists broadcast_sequences_workspace_archived_idx
  on broadcast_sequences (workspace_id, archived_at);
create index if not exists blog_posts_workspace_archived_idx
  on blog_posts (workspace_id, archived_at);
