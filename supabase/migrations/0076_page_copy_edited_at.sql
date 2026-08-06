-- Applied 2026-08-06. When a human last edited a funnel page's copy, so "Regenerate kit" can name
-- the date instead of silently replacing work.
--
-- Advisory ONLY, never the safety mechanism. Rows edited before this column existed are null and
-- indistinguishable from never-edited, so the regenerate dialog keeps the funnel page unticked by
-- DEFAULT whatever this says. A false negative costs an accurate message, not somebody's page.
alter table public.campaigns add column if not exists page_copy_edited_at timestamptz;
alter table public.bridge_variants add column if not exists page_copy_edited_at timestamptz;

comment on column public.campaigns.page_copy_edited_at is
  'Last human edit to page_copy. Advisory only — the regenerate dialog defaults to not touching the funnel page whatever this holds.';
