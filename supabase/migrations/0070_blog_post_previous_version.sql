-- One-step undo for a blog post, so "Regenerate" is safe to press.
--
-- A single snapshot, not a revision history. The snapshot exists to make an AI rewrite
-- reversible, and one step covers that completely; a full history is a different feature with its
-- own list UI, retention policy and storage cost. Consequence stated plainly in the UI:
-- regenerating twice loses the original.
alter table public.blog_posts
  add column if not exists previous_version jsonb,
  add column if not exists previous_saved_at timestamptz;
