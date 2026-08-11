-- Meta's Data Deletion Request Callback needs somewhere to record what it did.
--
-- The protocol is: Meta POSTs a signed_request, the app deletes that Facebook user's data and
-- answers with a status URL plus a confirmation code. The user can then follow that URL to check
-- the request. So a row per request is not bookkeeping for its own sake — it is the only thing
-- the status URL has to answer from, and it is the record that the deletion actually happened.
--
-- NOT workspace-scoped, unlike almost every other table here. meta_connections is
-- UNIQUE (workspace_id) — one Meta connection per workspace — but nothing stops the same Facebook
-- account being connected in several workspaces, so one deletion request covers all of them.
-- Filing this under a single workspace would misrepresent what was deleted. It is also not tenant
-- data: it describes an external identity's request, not anything a tenant owns.
create table public.meta_data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  -- Shown to the person by Facebook and echoed back in the status URL. Unguessable, and the only
  -- credential that page accepts — same shape as contacts.unsub_token, and for the same reason:
  -- something already displayed elsewhere must never double as the lookup key.
  confirmation_code text not null unique,
  -- Meta's app-scoped user id. Kept so a repeat request from the same person is traceable, and so
  -- support can answer "did you process mine?" without guessing.
  fb_user_id text not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  -- What was actually removed. Counts rather than ids: the ids are the very thing being deleted,
  -- and writing them here would leave a copy of the data behind in the record of its deletion.
  connections_deleted integer not null default 0,
  pages_deleted integer not null default 0,
  instagram_accounts_deleted integer not null default 0,
  secrets_deleted integer not null default 0,
  posts_redacted integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index meta_data_deletion_requests_fb_user_id_idx
  on public.meta_data_deletion_requests (fb_user_id);

-- Default-deny with no policy at all, plus the GRANT-layer lockout — the same belt-and-braces
-- treatment meta_connections gets. Both writers (the callback) and the reader (the public status
-- page) run on the service-role admin client; no tenant ever queries this table, and a tenant
-- must not be able to enumerate other people's deletion requests.
alter table public.meta_data_deletion_requests enable row level security;
revoke all on public.meta_data_deletion_requests from anon, authenticated;
grant all on public.meta_data_deletion_requests to service_role;
