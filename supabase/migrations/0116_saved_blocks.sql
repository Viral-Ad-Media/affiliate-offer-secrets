-- A workspace's library of reusable page blocks: save a section (a footer, a testimonial row, a
-- CTA band) once and drop it into any funnel or post. Editor-internal data — never served to
-- public traffic — so it uses plain workspace-member RLS with direct client writes, the
-- network_connections precedent, NOT the Vault/admin-only shape reserved for secrets or
-- publicly-rendered HTML.
--
-- `block` is the raw block subtree as jsonb. It is NOT validated at store time and does not need
-- to be: nothing renders it directly. It only reaches paid traffic after being inserted into a
-- page and that whole page passing validatePageBlockTree on save — the same boundary every other
-- block edit crosses. So the worst a malformed saved block can do is fail to insert cleanly, which
-- is the tenant's own page and the tenant's own problem.
create table public.saved_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  block jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.saved_blocks enable row level security;

-- Members of the workspace read and write its library. Same everyday-internal-data policy as
-- network_connections: the anti-abuse concern that makes other tables admin-only (public serving,
-- Stripe money, live tokens) doesn't apply here.
create policy saved_blocks_all on public.saved_blocks
  for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Newest first, scoped by workspace — the only query the palette runs.
create index saved_blocks_workspace_created_idx on public.saved_blocks (workspace_id, created_at desc);

-- Stamp workspace_id from the signed-in caller's active workspace, so a direct browser insert
-- doesn't have to pass it (and can't file a row under the wrong workspace). Same trigger 38 other
-- tenant tables use; an explicit value still wins, per stamp_workspace_id's own logic.
create trigger saved_blocks_stamp_workspace
  before insert on public.saved_blocks
  for each row execute function public.stamp_workspace_id();
