-- A workspace-level library of the custom fields a form can collect — ClickFunnels' "Contact
-- Attributes" model, replacing per-page invented keys.
--
-- THE PROBLEM THIS SOLVES. `contacts.extra_fields` is keyed by whatever `fieldKey` happened to be
-- on the page at submit time, and `extractLeadFormFields` reads the page's CURRENT tree to decide
-- which keys are legitimate. That is the right security posture for an anonymous endpoint and does
-- not change here. But it means renaming a field's key strands every value collected under the old
-- one, with nothing anywhere recording that the old key ever existed — the data is still in the
-- jsonb, unreachable and unexplained. A registry makes the key the stable thing and the LABEL the
-- editable thing, which is the actual fix.
--
-- DELIBERATELY NOT a widening of /api/public/leads. The page tree stays the allowlist for what a
-- submission may contain; the registry only decides what the editor offers and how a stored key is
-- labelled when read back. A registry-as-allowlist would let anyone holding a campaign UUID post
-- any of the workspace's field keys, which is exactly the spam-key vector 0025's design closed.
--
-- Same owner-select / no-client-write shape as contact_tags, blog_categories and every domain
-- table since 0009: all writes go through API routes on the admin client, where validation lives.
create table if not exists public.contact_attributes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Created-by attribution, not a scope — see the workspaces section of CLAUDE.md.
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The stored key. Lowercase-only, deliberately NARROWER than ClickFunnels' "letters, numbers,
  -- dashes and underscores": it has to satisfy FIELD_KEY_RE (/^[a-z0-9_-]{1,60}$/) in
  -- validatePageBlockTree.ts, because a registry entry no page could actually reference would be a
  -- trap rather than a feature. It is also the CSV column header and the jsonb key, so it never
  -- changes once created — the label is what people edit.
  key text not null check (key ~ '^[a-z0-9_-]{1,60}$'),
  label text not null check (char_length(trim(label)) between 1 and 120),
  field_type text not null check (
    field_type in ('text','email','tel','number','url','textarea','checkbox','radio','select')
  ),
  -- radio/select only; ignored (and dropped by the route) for every other type.
  options jsonb,
  description text check (description is null or char_length(description) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One entry per key per workspace. Not case-insensitive like contact_tags' name index, because the
-- CHECK above already forbids uppercase — there is no "VIP vs vip" ambiguity to collapse.
create unique index if not exists contact_attributes_workspace_key_idx
  on public.contact_attributes (workspace_id, key);
create index if not exists contact_attributes_workspace_idx on public.contact_attributes (workspace_id);

alter table public.contact_attributes enable row level security;

create policy "own contact attributes" on public.contact_attributes
  for select using (is_workspace_member(workspace_id));

revoke insert, update, delete on public.contact_attributes from anon, authenticated;
grant all on public.contact_attributes to service_role;

-- `first_name` and `email` are rendered by the lead-capture form itself and can't be removed, so a
-- registry entry for either would produce a duplicate input that silently overwrites the real one
-- on submit. Refused at the database, not only in the route, because this table is directly
-- readable through PostgREST and the constraint is the only thing a future writer can't skip.
alter table public.contact_attributes
  add constraint contact_attributes_key_not_builtin
  check (key not in ('first_name', 'email'));
