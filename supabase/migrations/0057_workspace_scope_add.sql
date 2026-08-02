-- Workspace Phase 2, STEP A — additive only. After this migration the existing application keeps
-- working completely unchanged: every policy below gains a workspace leg but KEEPS its
-- `auth.uid() = user_id` leg, so nothing that works today stops working. Step B moves the app onto
-- workspace_id; step C (0058) drops the user_id leg and makes workspace_id NOT NULL.
--
-- Splitting it this way is the whole point: the dangerous window in a migration like this is the
-- one where deployed code and RLS disagree about what a row belongs to. A permissive OR removes
-- that window entirely — both answers are correct until we deliberately narrow it.
--
-- Scope decisions (confirmed): the workspace owns campaigns, contacts, funnels, blog, broadcast,
-- domains, connectors, jobs, credits and payments. Deliberately NOT moved, because they describe a
-- person rather than an organization: `notifications` ("your kit is ready" is addressed to
-- someone), `referral_codes` / `rewards_ledger` / `referrals` (a referral link is a person's, and
-- redeeming still tops up the workspace's shared credit pool), and `usage_ledger` (so per-member
-- spend stays attributable). `profiles` is identity and never moves.

-- ---------------------------------------------------------------------------------------------
-- 1. Every user needs a workspace before anything can be backfilled into one.
--
-- 0041 backfilled the two users who existed when it ran, but nothing creates a workspace at
-- signup — so the three accounts that signed up on 2026-08-01 have none. Left alone, step C's
-- NOT NULL would fail on their rows, or worse, their data would end up unreachable. Same slug
-- algorithm as 0041's own backfill, deliberately, so the two cohorts are indistinguishable.
-- ---------------------------------------------------------------------------------------------
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

-- ...and every FUTURE signup needs one too, or this gap reopens the moment someone registers.
-- handle_new_user already runs SECURITY DEFINER on the auth.users insert; it just never knew
-- about workspaces. Wrapped so a slug collision or any other workspace problem can never block
-- account creation itself — a user with a profile and no workspace is recoverable (the loop above
-- is idempotent and can be re-run); a failed signup is not.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_base text;
  v_slug text;
  v_n integer := 0;
  v_ws uuid;
begin
  insert into public.profiles (id) values (new.id);

  begin
    v_base := left(coalesce(nullif(public.slugify_workspace(split_part(new.email, '@', 1)), ''), 'workspace'), 32);
    v_slug := v_base;
    while exists (select 1 from public.workspaces where slug = v_slug)
       or exists (select 1 from public.reserved_workspace_slugs where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n::text;
    end loop;

    insert into public.workspaces (name, slug)
    values (split_part(new.email, '@', 1) || '''s workspace', v_slug)
    returning id into v_ws;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws, new.id, 'owner');
  exception when others then
    raise warning 'handle_new_user: could not create workspace for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. active_workspace_id — which workspace the caller is currently looking at.
--
-- This is the UX scope, NOT the security boundary: RLS decides whether a row is visible at all
-- (membership), this decides which of your workspaces the UI is showing. Exactly the same split
-- the app already has, where RLS says auth.uid() = user_id AND queries redundantly filter by it.
--
-- When per-organization subdomains land, they become another way to resolve this value and
-- nothing about RLS has to change — that is the main reason the two layers are kept separate.
-- ---------------------------------------------------------------------------------------------
alter table public.profiles
  add column if not exists active_workspace_id uuid references public.workspaces(id) on delete set null;

update public.profiles p
   set active_workspace_id = m.workspace_id
  from public.workspace_members m
 where m.user_id = p.id and m.role = 'owner' and p.active_workspace_id is null;

-- Falls back to any membership, so a member who owns nothing still lands somewhere real.
create or replace function public.current_workspace_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.active_workspace_id from public.profiles p
      where p.id = auth.uid()
        and public.is_workspace_member(p.active_workspace_id)),
    (select m.workspace_id from public.workspace_members m
      where m.user_id = auth.uid()
      order by (m.role = 'owner') desc, m.created_at
      limit 1)
  );
$$;

revoke execute on function public.current_workspace_id() from public, anon;
grant execute on function public.current_workspace_id() to authenticated;

-- Switching workspaces is a write to profiles, which has no client update policy by design
-- (0002_trial.sql). Narrow RPC, same shape as update_profile: it can only ever set this one
-- column, and only to a workspace the caller actually belongs to.
create or replace function public.set_active_workspace(p_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_member(p_workspace_id) then
    raise exception 'not a member of that workspace';
  end if;

  update public.profiles
     set active_workspace_id = p_workspace_id, updated_at = now()
   where id = auth.uid();
end;
$$;

revoke execute on function public.set_active_workspace(uuid) from public, anon;
grant execute on function public.set_active_workspace(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. workspace_id on every workspace-scoped table, backfilled from each row's current owner.
--
-- The table list is explicit rather than derived at runtime so it is reviewable in the diff, but
-- the DDL is generated in a loop so no single table can accidentally get different treatment —
-- the failure mode of 38 hand-written ALTERs is the one that's subtly wrong on table 24.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'ad_launches', 'blog_categories', 'blog_posts', 'blog_settings', 'bridge_variants',
    'broadcast_enrollment_steps', 'broadcast_enrollments', 'broadcast_sends',
    'broadcast_sequence_contacts', 'broadcast_sequences', 'broadcast_steps',
    'campaign_creatives', 'campaigns', 'contact_tag_links', 'contact_tags', 'contacts',
    'credits_ledger', 'custom_domain_routes', 'custom_domains', 'everflow_connections',
    'funnel_steps', 'instagram_posts', 'jobs', 'mail_connections', 'mail_provider_connections',
    'mail_sends', 'meta_ad_accounts', 'meta_connections', 'meta_instagram_accounts',
    'meta_pages', 'meta_posts', 'network_connections', 'payments', 'products',
    'tiktok_connections', 'tiktok_posts', 'youtube_connections', 'youtube_posts'
  ];
begin
  foreach t in array tables loop
    -- Nullable for now; 0058 makes it NOT NULL once the app is stamping it.
    execute format(
      'alter table public.%I add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade',
      t);

    -- Every workspace-scoped read filters on this, so it wants an index from day one rather than
    -- after someone notices a sequential scan in production.
    execute format(
      'create index if not exists %I on public.%I (workspace_id)',
      t || '_workspace_id_idx', t);

    -- Backfill: a row belongs to the workspace its current owner owns. Every user has exactly one
    -- owned workspace at this point (section 1 guaranteed it), so this is unambiguous.
    execute format($f$
      update public.%I x
         set workspace_id = m.workspace_id
        from public.workspace_members m
       where m.user_id = x.user_id and m.role = 'owner' and x.workspace_id is null
    $f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Policies: add the workspace leg, keep the user leg.
--
-- Driven off pg_policies so the set is exactly the policies that currently read
-- `(auth.uid() = user_id)` — no more, no less — and the four on person-scoped tables are skipped
-- explicitly by name. Each policy is recreated with its original name, command and permissiveness.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
  v_using text;
  v_check text;
  v_cmd text;
begin
  for r in
    select tablename, policyname, cmd, with_check
    from pg_policies
    where schemaname = 'public'
      and qual = '(auth.uid() = user_id)'
      -- These four stay person-scoped by decision; leaving them alone is the point.
      and tablename not in ('notifications', 'referral_codes', 'rewards_ledger', 'usage_ledger')
  loop
    v_using := '(auth.uid() = user_id or public.is_workspace_member(workspace_id))';
    v_cmd := case r.cmd when 'ALL' then 'all' when 'SELECT' then 'select'
                        when 'INSERT' then 'insert' when 'UPDATE' then 'update'
                        when 'DELETE' then 'delete' end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    if r.with_check is not null then
      -- INSERT/UPDATE side. A client writing a row must still claim it for itself or for a
      -- workspace it belongs to — it can never stamp someone else's workspace_id on a row.
      v_check := '(auth.uid() = user_id or public.is_workspace_member(workspace_id))';
      execute format('create policy %I on public.%I for %s using (%s) with check (%s)',
                     r.policyname, r.tablename, v_cmd, v_using, v_check);
    else
      execute format('create policy %I on public.%I for %s using (%s)',
                     r.policyname, r.tablename, v_cmd, v_using);
    end if;
  end loop;
end $$;
