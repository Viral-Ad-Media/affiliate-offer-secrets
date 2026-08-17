-- Track a marketplace product's gravity WITHOUT adding it to your own products.
--
-- Adding a product is a commitment — it shows up in My Products and is what you build kits from.
-- Watching is the cheaper thing you want first: "is this climbing, or was that one good week?".
-- Keeping them separate stops My Products filling with maybes, the same problem the status filter
-- fixed from the other direction.
create table if not exists public.marketplace_watchlist (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  network text not null default 'clickbank',
  vendor_id text not null,
  -- Gravity WHEN STARRED, so a card can say what has happened since you noticed it. Stored rather
  -- than derived from history so the answer survives that table's pruning, and because it is the
  -- number the operator actually saw at the time.
  gravity_at_add numeric,
  created_at timestamptz not null default now(),
  unique (workspace_id, network, vendor_id)
);

alter table public.marketplace_watchlist enable row level security;

-- Plain workspace-member policy with direct client writes, deliberately NOT the admin-client/RPC
-- shape most domain tables use. Those exist because the write has an external side effect (a
-- domain, a Vault secret) or serves raw HTML to ad traffic. Starring a public marketplace product
-- has neither — the network_connections case: tenant data, no side effect, no secret.
drop policy if exists "members manage watchlist" on public.marketplace_watchlist;
create policy "members manage watchlist" on public.marketplace_watchlist
  for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create index if not exists marketplace_watchlist_ws_idx on public.marketplace_watchlist (workspace_id);

-- The client inserts only (network, vendor_id, gravity_at_add) — it has no business knowing the
-- workspace or user id, and asking the browser to send them would make the scope caller-supplied
-- on a table whose whole policy is workspace membership.
--
-- workspace_id is filled by the SAME stamp_workspace_id() trigger 0058 attached to the other 38
-- tenant tables. That migration ENUMERATED its targets, so a table created afterwards does not get
-- it automatically — exactly the trap here: without this the insert fails a NOT NULL constraint,
-- and the failure would only appear the first time someone clicked the star. Caught by probing the
-- insert as a real authenticated user before shipping, not by reading the schema.
create trigger stamp_workspace_id
  before insert on public.marketplace_watchlist
  for each row execute function public.stamp_workspace_id();

-- Created-by attribution. A default rather than a trigger because auth.uid() is exactly right for
-- the only caller: this table is written from the browser under the member's own session.
alter table public.marketplace_watchlist
  alter column user_id set default auth.uid();
