-- Table of contents on blog post pages.
--
-- Off by default, and thresholded: a post with two headings gets a contents box longer than the
-- scroll it saves, which is worse than no box. Built from each post's own headings at render time,
-- so there's nothing to maintain per post and it can't fall out of sync with the body.
alter table public.blog_settings
  add column if not exists toc_enabled boolean not null default false,
  add column if not exists toc_title text,
  add column if not exists toc_min_headings integer not null default 3
    check (toc_min_headings between 2 and 10);
