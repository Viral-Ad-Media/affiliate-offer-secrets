-- A static page as the blog's home.
--
-- Null (the default, every existing blog) = the post list serves at the root exactly as today.
-- Set = that POST renders at the blog root — a "page" here is an ordinary blog post with the full
-- block editor, the WordPress static-front-page model without inventing a second content type —
-- and the post list moves to the fixed child path /posts.
--
-- on delete set null: deleting the chosen page must degrade the blog back to the list, never 404
-- its root. The serving routes additionally require the post to be PUBLISHED — a draft home would
-- otherwise take the whole blog down the moment someone unpublished it to edit.
alter table public.blog_settings
  add column if not exists home_post_id uuid references public.blog_posts(id) on delete set null;

comment on column public.blog_settings.home_post_id is
  'Post served at the blog root instead of the post list. Null = list at root (default). When set, the list serves at /posts.';
