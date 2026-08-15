-- Cloudinary asset ledger.
--
-- Images moved off inline base64 data: URIs and onto hosted URLs. The URL itself is stored in the
-- EXISTING image columns (campaigns.embedded_image_data_url, blog_posts.featured_image_url, the
-- block-tree page_copy blobs, …) — they are all `text` and a URL fits, so all eleven render sites
-- keep working with no schema churn and both shapes stay valid indefinitely.
--
-- What those columns cannot answer is "what does this workspace own in Cloudinary", and that is the
-- one question account deletion has to answer. Hence one ledger rather than eight new *_public_id
-- columns: app/api/account/delete/route.ts already sweeps Vault secrets, Storage objects and Vercel
-- domains, and its comment says a newly-added store shows up as a missing entry there rather than a
-- silent leak. This is that entry.
--
-- Deliberately NOT derived by parsing public_ids back out of URLs: the delivery URL embeds the
-- public id together with a version and any transformation, and reconstructing it by string surgery
-- is exactly the kind of fragile inference that fails quietly on the one asset shaped differently.

create table if not exists public.cloudinary_assets (
  -- Cloudinary's own identifier, and the argument its destroy endpoint takes. Natural primary key:
  -- one row per remote asset, and a re-upload of the same public_id is the same asset.
  public_id   text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Created-by attribution, matching every other tenant table since 0057. NOT the scope.
  user_id     uuid not null references auth.users(id) on delete cascade,
  secure_url  text not null,
  bytes       integer not null default 0,
  created_at  timestamptz not null default now()
);

-- The deletion sweep's access path, and the only query this table exists to serve.
create index if not exists cloudinary_assets_workspace_idx
  on public.cloudinary_assets (workspace_id);

alter table public.cloudinary_assets enable row level security;

-- Owner-select, no client write path — the shape every domain table has had since 0009. The only
-- legitimate writer is a server route on the admin client, immediately after a successful upload;
-- a client that could insert here could make the deletion sweep destroy assets it does not own.
drop policy if exists "cloudinary_assets_select_own" on public.cloudinary_assets;
create policy "cloudinary_assets_select_own"
  on public.cloudinary_assets for select
  using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.cloudinary_assets from anon, authenticated;

-- Stamp workspace_id when a service-role caller omits it, same safety net 0058 applies to every
-- other tenant table: the engine bypasses RLS, and one forgotten workspace_id would otherwise
-- create a row that succeeds and is then invisible to everyone.
drop trigger if exists stamp_workspace_id_cloudinary_assets on public.cloudinary_assets;
create trigger stamp_workspace_id_cloudinary_assets
  before insert on public.cloudinary_assets
  for each row execute function public.stamp_workspace_id();
