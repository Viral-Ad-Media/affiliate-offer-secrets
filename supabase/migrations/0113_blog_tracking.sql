-- Site-wide analytics for the public blog: the same per-funnel `tracking` jsonb shape
-- (ga4/gtm/clarity/meta pixel + the consent gate), stored once on blog_settings and injected into
-- every public post and index page at serve time. Clarity is the piece that answers "heatmaps for
-- posts" — funnels already carry it per-campaign. Validation is app-layer (validateTracking), the
-- same boundary the campaign column relies on; raw pasted snippets are never stored or rendered.
alter table public.blog_settings add column if not exists tracking jsonb;
