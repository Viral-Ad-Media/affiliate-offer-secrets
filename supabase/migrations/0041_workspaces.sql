-- Workspaces (teams) — PHASE 1 of the multi-tenancy migration: the workspace entity, membership,
-- roles, invitations, and the public slug. It deliberately does NOT yet move any tenant data onto
-- workspace_id or touch existing RLS — that's phase 2, and doing both at once would mean a single
-- unreviewable change to the security model of 41 tables (144 auth.uid() clauses, 129 app
-- queries). After this migration the app still behaves exactly as before; nothing reads these
-- tables yet except the new Settings → Team UI and onboarding.
--
-- Model: a workspace owns the data (confirmed decision — shared credits, shared access fee,
-- shared connected accounts). Every existing user gets a personal workspace, backfilled below, so
-- phase 2 has a workspace_id to point every existing row at.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- Public identifier, used for preview URLs (/w/{slug}/... today, {slug}.yourdomain later — the
  -- stored value is identical for both, so the subdomain upgrade is routing-only, no data change).
  -- Charset is deliberately narrower than the name: it appears in URLs and, eventually, in a DNS
  -- label, which forbids underscores and leading/trailing hyphens.
  slug text not null unique
    check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Reserved slugs would otherwise collide with real routes (/w/api/... or an eventual
-- api.yourdomain) or let someone impersonate the product itself.
create table public.reserved_workspace_slugs (slug text primary key);
insert into public.reserved_workspace_slugs (slug) values
  ('www'), ('api'), ('app'), ('admin'), ('mail'), ('smtp'), ('ftp'), ('cdn'), ('static'),
  ('assets'), ('blog'), ('help'), ('support'), ('status'), ('docs'), ('dashboard'), ('login'),
  ('signup'), ('billing'), ('settings'), ('affiliate'), ('affiliatestudio'), ('studio'),
  ('test'), ('staging'), ('dev'), ('preview'), ('w'), ('p'), ('b'), ('d'), ('r');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- owner: billing + delete workspace. admin: invite/remove, manage connections.
  -- member: create/edit campaigns, funnels, blog, emails — but NOT spend credits on ad launches
  -- (that check lives with reserve_ad_credits in phase 2, where spending actually happens).
  role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

-- Exactly one owner per workspace. Transferring ownership therefore has to demote the old owner
-- in the same transaction — enforced by transfer_workspace_ownership() rather than left to
-- callers to remember.
create unique index workspace_members_single_owner_idx
  on public.workspace_members (workspace_id) where role = 'owner';

create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'member')),
  -- Unguessable acceptance token, separate from the row id: the id shows up in admin listings,
  -- and anything that has ever been rendered to another member must not also be the bearer
  -- credential that joins the workspace. Same reasoning as contacts.unsub_token in 0021.
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index workspace_invitations_workspace_idx on public.workspace_invitations (workspace_id);
-- One live invite per address per workspace; re-inviting replaces rather than piles up.
create unique index workspace_invitations_pending_idx
  on public.workspace_invitations (workspace_id, lower(email)) where accepted_at is null;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.reserved_workspace_slugs enable row level security;

-- Membership lookup used by every policy below. SECURITY DEFINER so the policies don't recurse
-- through workspace_members' own RLS — the classic infinite-recursion trap when a table's policy
-- queries that same table. STABLE so the planner calls it once per statement, not per row.
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.workspace_role(p_workspace_id uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select role from public.workspace_members
  where workspace_id = p_workspace_id and user_id = auth.uid();
$$;

revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.workspace_role(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.workspace_role(uuid) to authenticated;

create policy "members read workspace" on public.workspaces
  for select using (public.is_workspace_member(id));
create policy "members read membership" on public.workspace_members
  for select using (public.is_workspace_member(workspace_id));
-- Invitations carry an email address; only admins/owners should see who's been invited.
create policy "admins read invitations" on public.workspace_invitations
  for select using (public.workspace_role(workspace_id) in ('owner', 'admin'));

-- Every write goes through the RPCs below — a client can't insert itself into a workspace, change
-- its own role, or mint an invitation directly.
revoke insert, update, delete on public.workspaces from anon, authenticated;
revoke insert, update, delete on public.workspace_members from anon, authenticated;
revoke insert, update, delete on public.workspace_invitations from anon, authenticated;
revoke all on public.reserved_workspace_slugs from anon, authenticated;
grant all on public.workspaces, public.workspace_members, public.workspace_invitations,
  public.reserved_workspace_slugs to service_role;

-- unaccent isn't enabled on this project and enabling an extension for one call isn't worth it;
-- this covers the Latin-1 range that actually shows up in names.
create or replace function public.unaccent_placeholder(p_text text)
returns text
language sql
immutable
as $$
  select translate(
    coalesce(p_text, ''),
    'àáâãäåèéêëìíîïòóôõöùúûüçñýÿÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑÝ',
    'aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY'
  );
$$;

-- Slug generation: lowercase, strip accents, non-alphanumerics to hyphens, collapse, trim.
create or replace function public.slugify_workspace(p_name text)
returns text
language sql
immutable
as $$
  select btrim(
           regexp_replace(
             regexp_replace(lower(unaccent_placeholder(p_name)), '[^a-z0-9]+', '-', 'g'),
             '(^-+|-+$)', '', 'g'
           ),
           '-'
         );
$$;

-- Creates a workspace with the caller as owner, resolving slug collisions by suffixing. Returns
-- the new row so the caller can redirect straight to it.
create or replace function public.create_workspace(p_name text, p_slug text default null)
returns public.workspaces
language plpgsql
security definer set search_path = public
as $$
declare
  v_base text;
  v_slug text;
  v_try integer := 0;
  v_ws public.workspaces;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Workspace name is required';
  end if;

  v_base := public.slugify_workspace(coalesce(nullif(btrim(p_slug), ''), p_name));
  -- A name of only punctuation/emoji slugifies to nothing; fall back rather than fail.
  if v_base = '' then
    v_base := 'workspace';
  end if;
  v_base := left(v_base, 32);
  v_slug := v_base;

  -- Suffix until free. Reserved names and taken slugs are handled by the same loop.
  loop
    exit when not exists (select 1 from public.workspaces where slug = v_slug)
          and not exists (select 1 from public.reserved_workspace_slugs where slug = v_slug)
          and v_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$';
    v_try := v_try + 1;
    if v_try > 50 then
      raise exception 'Could not allocate a workspace URL';
    end if;
    v_slug := left(v_base, 32) || '-' || v_try::text;
  end loop;

  insert into public.workspaces (name, slug) values (btrim(p_name), v_slug) returning * into v_ws;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws.id, auth.uid(), 'owner');

  return v_ws;
end;
$$;

revoke execute on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;

-- Rename / re-slug. Owners and admins only; the slug is re-validated against reserved names and
-- uniqueness because changing it changes every public preview URL for that workspace.
create or replace function public.update_workspace(p_workspace_id uuid, p_name text, p_slug text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_slug text;
begin
  if public.workspace_role(p_workspace_id) not in ('owner', 'admin') then
    raise exception 'Only owners and admins can change workspace settings';
  end if;

  v_slug := public.slugify_workspace(p_slug);
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$' then
    raise exception 'Workspace URL must be 3-40 characters: letters, numbers and hyphens';
  end if;
  if exists (select 1 from public.reserved_workspace_slugs where slug = v_slug) then
    raise exception 'That workspace URL is reserved';
  end if;
  if exists (select 1 from public.workspaces where slug = v_slug and id <> p_workspace_id) then
    raise exception 'That workspace URL is already taken';
  end if;

  update public.workspaces
     set name = btrim(p_name), slug = v_slug, updated_at = now()
   where id = p_workspace_id;
end;
$$;

revoke execute on function public.update_workspace(uuid, text, text) from public, anon;
grant execute on function public.update_workspace(uuid, text, text) to authenticated;

-- Invite. Admins and owners only; can't invite an existing member, and can't mint an 'owner'
-- invitation (ownership moves only via transfer, never by invitation).
create or replace function public.invite_to_workspace(p_workspace_id uuid, p_email text, p_role text)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token uuid;
begin
  if public.workspace_role(p_workspace_id) not in ('owner', 'admin') then
    raise exception 'Only owners and admins can invite people';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if exists (
    select 1 from public.workspace_members m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = p_workspace_id and lower(u.email) = v_email
  ) then
    raise exception 'That person is already in this workspace';
  end if;

  -- Re-inviting replaces the pending invite (and rotates its token) rather than erroring.
  delete from public.workspace_invitations
   where workspace_id = p_workspace_id and lower(email) = v_email and accepted_at is null;

  insert into public.workspace_invitations (workspace_id, email, role, invited_by)
  values (p_workspace_id, v_email, p_role, auth.uid())
  returning token into v_token;

  return v_token;
end;
$$;

revoke execute on function public.invite_to_workspace(uuid, text, text) from public, anon;
grant execute on function public.invite_to_workspace(uuid, text, text) to authenticated;

-- Accept by token. Deliberately does NOT require the invited address to match the signed-in one:
-- people routinely sign up with a different address than the one they were invited at, and the
-- token is the actual credential. It DOES enforce expiry and single use.
create or replace function public.accept_workspace_invitation(p_token uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_inv public.workspace_invitations;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into v_inv from public.workspace_invitations
   where token = p_token and accepted_at is null and expires_at > now()
   for update;

  if v_inv.id is null then
    raise exception 'This invitation is invalid or has expired';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_inv.workspace_id, auth.uid(), v_inv.role)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations set accepted_at = now() where id = v_inv.id;
  return v_inv.workspace_id;
end;
$$;

revoke execute on function public.accept_workspace_invitation(uuid) from public, anon;
grant execute on function public.accept_workspace_invitation(uuid) to authenticated;

create or replace function public.revoke_workspace_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.workspace_invitations where id = p_invitation_id;
  if v_ws is null then
    return; -- already gone; nothing to do
  end if;
  if public.workspace_role(v_ws) not in ('owner', 'admin') then
    raise exception 'Only owners and admins can revoke invitations';
  end if;
  delete from public.workspace_invitations where id = p_invitation_id;
end;
$$;

revoke execute on function public.revoke_workspace_invitation(uuid) from public, anon;
grant execute on function public.revoke_workspace_invitation(uuid) to authenticated;

-- Role changes and removals. The owner row is untouchable here: demoting or removing the last
-- owner would orphan the workspace's billing, so ownership only moves via transfer below.
create or replace function public.set_workspace_member_role(
  p_workspace_id uuid, p_user_id uuid, p_role text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if public.workspace_role(p_workspace_id) not in ('owner', 'admin') then
    raise exception 'Only owners and admins can change roles';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member';
  end if;
  if (select role from public.workspace_members
       where workspace_id = p_workspace_id and user_id = p_user_id) = 'owner' then
    raise exception 'Transfer ownership before changing the owner''s role';
  end if;

  update public.workspace_members set role = p_role
   where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

revoke execute on function public.set_workspace_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_workspace_member_role(uuid, uuid, text) to authenticated;

-- Remove a member, or leave yourself. Owners can't be removed and can't leave — they must
-- transfer first, otherwise a workspace ends up with billing nobody controls.
create or replace function public.remove_workspace_member(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller text := public.workspace_role(p_workspace_id);
  v_target text;
begin
  select role into v_target from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_user_id;
  if v_target is null then
    return;
  end if;
  if v_target = 'owner' then
    raise exception 'Transfer ownership before removing the owner';
  end if;
  -- Anyone may remove themselves; removing someone else needs owner/admin.
  if p_user_id <> auth.uid() and v_caller not in ('owner', 'admin') then
    raise exception 'Only owners and admins can remove people';
  end if;

  delete from public.workspace_members
   where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

revoke execute on function public.remove_workspace_member(uuid, uuid) from public, anon;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;

-- Atomic ownership transfer — demote-then-promote in one statement pair inside one transaction,
-- because the single-owner partial unique index makes any other ordering fail.
create or replace function public.transfer_workspace_ownership(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if public.workspace_role(p_workspace_id) <> 'owner' then
    raise exception 'Only the owner can transfer ownership';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_user_id
  ) then
    raise exception 'That person is not in this workspace';
  end if;

  -- Demote first: the partial unique index permits only one 'owner' row at a time.
  update public.workspace_members set role = 'admin'
   where workspace_id = p_workspace_id and user_id = auth.uid();
  update public.workspace_members set role = 'owner'
   where workspace_id = p_workspace_id and user_id = p_user_id;
end;
$$;

revoke execute on function public.transfer_workspace_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_workspace_ownership(uuid, uuid) to authenticated;

-- Everything the Team settings page needs in one call: the workspace, its members (with profile
-- details), pending invitations, and the caller's own role. Invitation emails are only included
-- for owners/admins, matching the RLS policy above.
create or replace function public.get_workspace_overview(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_role text := public.workspace_role(p_workspace_id);
begin
  if v_role is null then
    raise exception 'Workspace not found';
  end if;

  return jsonb_build_object(
    'workspace', (
      select jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug)
      from public.workspaces w where w.id = p_workspace_id
    ),
    'my_role', v_role,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'role', m.role,
        'email', u.email,
        'first_name', p.first_name,
        'last_name', p.last_name,
        'avatar_url', p.avatar_url,
        'joined_at', m.created_at
      ) order by (m.role = 'owner') desc, m.created_at)
      from public.workspace_members m
      join auth.users u on u.id = m.user_id
      left join public.profiles p on p.id = m.user_id
      where m.workspace_id = p_workspace_id
    ), '[]'::jsonb),
    'invitations', case when v_role in ('owner', 'admin') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'role', i.role, 'expires_at', i.expires_at
      ) order by i.created_at desc)
      from public.workspace_invitations i
      where i.workspace_id = p_workspace_id and i.accepted_at is null and i.expires_at > now()
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke execute on function public.get_workspace_overview(uuid) from public, anon;
grant execute on function public.get_workspace_overview(uuid) to authenticated;

-- Backfill: one personal workspace per existing user, named from their profile, so phase 2 has a
-- workspace_id to attach every existing row to. Slug derived from the email local-part, uniquified
-- by a counter — `id::text` fragments would be ugly in a URL people are meant to share.
do $$
declare
  r record;
  v_base text;
  v_slug text;
  v_n integer;
  v_ws uuid;
begin
  for r in
    select u.id, u.email, p.first_name, p.last_name
    from auth.users u
    left join public.profiles p on p.id = u.id
    where not exists (select 1 from public.workspace_members m where m.user_id = u.id)
  loop
    v_base := left(coalesce(nullif(public.slugify_workspace(split_part(r.email, '@', 1)), ''), 'workspace'), 32);
    v_slug := v_base;
    v_n := 0;
    while exists (select 1 from public.workspaces where slug = v_slug)
       or exists (select 1 from public.reserved_workspace_slugs where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n::text;
    end loop;

    insert into public.workspaces (name, slug)
    values (
      coalesce(
        nullif(btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')), ''),
        split_part(r.email, '@', 1)
      ) || '''s workspace',
      v_slug
    )
    returning id into v_ws;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws, r.id, 'owner');
  end loop;
end $$;
