-- Workspace Phase 2, STEP C — narrow the transition opened in 0057.
--
-- 1. NOT NULL on all 38 workspace_id columns. This is what converts the failure mode the whole
--    phase was designed around — a service_role insert that forgets workspace_id, producing a row
--    that succeeds and is then invisible to everyone — into an immediate constraint violation.
--    0058's trigger already makes that near-impossible; this makes it impossible.
-- 2. Drop the transitional `auth.uid() = user_id` leg. Until now both were accepted so deployed
--    code and RLS could never disagree. With the app reading and writing by workspace, the user
--    leg is what would still limit a member to only their OWN rows inside a shared workspace.
--
-- user_id STAYS on every table as created-by attribution — non-destructive, still useful, and
-- consistent with this codebase leaving deprecated columns in place rather than dropping them.
--
-- WITH CHECK is evaluated after BEFORE INSERT triggers, so 0058's stamp has already filled
-- workspace_id by the time the narrowed policy runs: a client insert that omits it still passes,
-- and one naming someone else's workspace still fails. Verified live, not assumed.

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
    execute format('alter table public.%I alter column workspace_id set not null', t);
  end loop;
end $$;

do $$
declare
  r record;
  v_cmd text;
begin
  for r in
    select tablename, policyname, cmd, with_check
    from pg_policies
    where schemaname = 'public'
      and qual = '((auth.uid() = user_id) OR is_workspace_member(workspace_id))'
  loop
    v_cmd := case r.cmd when 'ALL' then 'all' when 'SELECT' then 'select'
                        when 'INSERT' then 'insert' when 'UPDATE' then 'update'
                        when 'DELETE' then 'delete' end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    if r.with_check is not null then
      execute format(
        'create policy %I on public.%I for %s using (public.is_workspace_member(workspace_id))
           with check (public.is_workspace_member(workspace_id))',
        r.policyname, r.tablename, v_cmd);
    else
      execute format(
        'create policy %I on public.%I for %s using (public.is_workspace_member(workspace_id))',
        r.policyname, r.tablename, v_cmd);
    end if;
  end loop;
end $$;
