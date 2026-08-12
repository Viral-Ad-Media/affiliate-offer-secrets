-- Remove Everflow (0091).
--
-- 0046 added it as the "one adapter reaches dozens of CPA networks" bet. It never got past
-- connect-only — no discovery, no offer import — so the app carried a connector, a Vault-backed
-- table and two network enum values for a feature nobody could finish a workflow with.
--
-- THIS DROPS A TABLE, which is a departure from the precedent set by youtube_connections,
-- mail_connections and profiles.nickname (all left in place, unread). Those were kept for a
-- reason that does not apply here: youtube_posts is one of the six tables audit_events UNIONs, so
-- dropping it would have meant rewriting a view for no user-visible gain, and mail_connections
-- still describes a Gmail integration whose history was worth keeping. everflow_connections is in
-- no view, is joined by nothing, and holds only a pointer into Vault — an empty table whose only
-- purpose was a feature that no longer exists.
--
-- Measured on the live database immediately before writing this, which is what makes the drop
-- safe rather than merely tidy:
--   everflow_connections                                    0 rows
--   network_connections where network = 'everflow'          0 rows
--   products            where network = 'everflow'          0 rows
-- So no tenant loses a connection, no Vault secret is orphaned (there are none to orphan — the
-- api_key_secret_id column is the only thing that pointed at one), and tightening both CHECK
-- constraints cannot fail on existing data. Re-check those three counts before applying this
-- anywhere else; a non-empty everflow_connections would need its Vault secrets deleted through
-- delete_oauth_secret FIRST, because dropping the table strands them with nothing left pointing
-- at them.

-- The workspace-scoped reader from 0072. The original no-arg version from 0046 was replaced then,
-- not overloaded, so this signature is the only one that exists — confirmed against pg_proc.
drop function if exists public.get_everflow_connection_status(uuid);

-- The 0058 stamp_workspace_id trigger and 0059's NOT NULL go with the table.
drop table if exists public.everflow_connections;

-- Back to the two networks that actually work end to end. products.network is what
-- buildHoplink() branches on (lib/engine/renderPages.ts); leaving 'everflow' legal would keep a
-- value that no branch handles, which renders as a ClickBank-shaped link for a network that is
-- not ClickBank.
alter table public.network_connections
  drop constraint if exists network_connections_network_check;
alter table public.network_connections
  add constraint network_connections_network_check
  check (network in ('clickbank', 'digistore24'));

alter table public.products
  drop constraint if exists products_network_check;
alter table public.products
  add constraint products_network_check
  check (network in ('clickbank', 'digistore24'));
