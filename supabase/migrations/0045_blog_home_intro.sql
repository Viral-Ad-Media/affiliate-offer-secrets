-- Applied via the Supabase MCP on 2026-07-31.
-- An editable intro for the blog home. Until now the index was entirely generated — site header,
-- category chips, post grid — with nothing on it the tenant could write. This is the block tree
-- for the band between the header and the post list, stored with the same page_copy/html
-- relationship every other editable surface in this app uses (campaigns.page_copy/bridge_html,
-- blog_posts.page_copy/html): the tree is the source of truth, the html is its write-time render.
--
-- Nullable with no default: an existing blog keeps rendering exactly as it does today until
-- someone writes an intro.
alter table public.blog_settings
  add column if not exists intro_copy jsonb,
  add column if not exists intro_html text;
