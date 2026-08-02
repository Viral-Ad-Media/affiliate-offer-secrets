-- Workspace Phase 2, STEP B (database half): make it structurally impossible to insert a
-- workspace-scoped row without a workspace.
--
-- The plan flagged one failure mode above all others: the engine worker runs as `service_role`
-- and bypasses RLS, so a single forgotten `workspace_id` on an insert creates a row that succeeds
-- and is then invisible to everyone, with nothing raised. The same hazard applies to 15 RPCs that
-- insert, 73 app-side inserts, and the Stripe webhook. Auditing ~90 call sites and hoping none
-- was missed is not a security model.
--
-- So the default is moved into the database. A BEFORE INSERT trigger fills workspace_id when the
-- caller didn't, deriving it the same way the Step-A backfill did. Explicit values always win —
-- the trigger only ever fills a NULL — so app code that DOES pass workspace_id (which all of it
-- will) is unaffected, and this is a safety net rather than the mechanism.
--
-- Two resolution paths, matching the two kinds of caller:
--   * a signed-in user  -> current_workspace_id(), i.e. the workspace they're actually acting in
--                          (correct for a member working inside someone else's workspace)
--   * service_role/no session -> the owning workspace of the row's own user_id, which is exactly
--                          what the backfill used, so old and new rows land consistently.

create or replace function public.stamp_workspace_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  -- Explicit wins, always. This is a backstop, not an override.
  if new.workspace_id is not null then
    return new;
  end if;

  -- Acting as a signed-in user: use the workspace they're currently in. Guarded by
  -- is_workspace_member inside current_workspace_id(), so this can't point at a stranger's.
  if auth.uid() is not null then
    v_ws := public.current_workspace_id();
  end if;

  -- No session (service_role: the engine worker, webhooks, public routes) — or the caller has no
  -- resolvable active workspace. Fall back to the row owner's own workspace.
  if v_ws is null and new.user_id is not null then
    select m.workspace_id into v_ws
      from public.workspace_members m
     where m.user_id = new.user_id
     order by (m.role = 'owner') desc, m.created_at
     limit 1;
  end if;

  new.workspace_id := v_ws;
  return new;
end;
$$;

-- Same explicit table list as 0057, same reason: reviewable in the diff, applied uniformly in a
-- loop so no single table can end up with different behaviour.
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
    execute format('drop trigger if exists stamp_workspace_id on public.%I', t);
    execute format(
      'create trigger stamp_workspace_id before insert on public.%I
         for each row execute function public.stamp_workspace_id()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Ownership checks become membership checks.
--
-- These are the functions the write paths call before touching a resource ("do you own this
-- campaign?"). Left alone, an invited member would be refused access to their own workspace's
-- campaigns — the exact thing this phase exists to enable. Each keeps its name, signature and
-- fail-closed behaviour; only the predicate widens from "you are the owner" to "you are in the
-- workspace that owns it", which after Step A is a strictly larger but still tenant-bounded set.
-- ---------------------------------------------------------------------------------------------
create or replace function public.assert_owns_campaign(p_campaign_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.campaigns c
     where c.id = p_campaign_id
       and (c.user_id = auth.uid() or public.is_workspace_member(c.workspace_id))
  ) then
    raise exception 'Campaign not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_bridge_variant(p_variant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Still excludes control rows: editing the control goes through the campaign's own page-copy
  -- route, which writes the campaigns row correctly (see 0022).
  if not exists (
    select 1 from public.bridge_variants v
     where v.id = p_variant_id
       and not v.is_control
       and (v.user_id = auth.uid() or public.is_workspace_member(v.workspace_id))
  ) then
    raise exception 'Variant not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_funnel_step(p_step_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.funnel_steps s
     where s.id = p_step_id
       and (s.user_id = auth.uid() or public.is_workspace_member(s.workspace_id))
  ) then
    raise exception 'Funnel step not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_meta_page(p_page_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.meta_pages p
     where p.page_id = p_page_id
       and (p.user_id = auth.uid() or public.is_workspace_member(p.workspace_id))
  ) then
    raise exception 'Page not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_ig_account(p_ig_user_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.meta_instagram_accounts a
     where a.ig_user_id = p_ig_user_id
       and (a.user_id = auth.uid() or public.is_workspace_member(a.workspace_id))
  ) then
    raise exception 'Instagram account not found for this account';
  end if;
  return true;
end;
$$;

create or replace function public.assert_owns_meta_ad_account(p_ad_account_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.meta_ad_accounts a
     where a.ad_account_id = p_ad_account_id
       and (a.user_id = auth.uid() or public.is_workspace_member(a.workspace_id))
  ) then
    raise exception 'Ad account not found for this account';
  end if;
  return true;
end;
$$;
