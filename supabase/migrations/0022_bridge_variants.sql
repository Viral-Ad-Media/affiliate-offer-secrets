-- Bridge page A/B / split testing. A "variant" is a row here; the control (today's
-- campaigns.bridge_html/page_copy/embedded_image_data_url) is represented by a row too (for
-- uniform weight/stats/pause handling and a single consistent contacts.bridge_variant_id FK
-- shape) but its own content columns stay permanently NULL — the control's real content always
-- lives on campaigns, never duplicated, never a second copy that can drift.

create table public.bridge_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  label text not null,
  is_control boolean not null default false,
  weight integer not null default 50 check (weight between 1 and 100),
  status text not null default 'active' check (status in ('active', 'paused')),
  bridge_html text,
  page_copy jsonb,
  embedded_image_data_url text,
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Design-review fix #1: structurally impossible for a control row to ever hold real content —
  -- defense-in-depth alongside the ownership-check/UI layers that already prevent it.
  constraint bridge_variants_control_no_content check (
    (is_control and bridge_html is null and page_copy is null and embedded_image_data_url is null)
    or (not is_control)
  )
);

create index bridge_variants_campaign_id_idx on public.bridge_variants(campaign_id);
create unique index bridge_variants_one_control_idx on public.bridge_variants(campaign_id) where is_control;

alter table public.bridge_variants enable row level security;

-- Same owner-select/admin-write shape as every domain table since 0006_meta_connections.sql — all
-- real writes go through the ownership-checked RPCs below or the admin client.
create policy "own bridge variants" on public.bridge_variants for select using (auth.uid() = user_id);
revoke insert, update, delete on public.bridge_variants from anon, authenticated;
grant all on public.bridge_variants to service_role;

alter table public.contacts
  add column bridge_variant_id uuid references public.bridge_variants(id) on delete set null;

-- ---------------------------------------------------------------------------------------------

create or replace function public.assert_owns_bridge_variant(p_variant_id uuid)
returns boolean
language sql
security definer set search_path = public
as $$
  select exists(
    select 1 from public.bridge_variants
    where id = p_variant_id and user_id = auth.uid() and not is_control
  );
$$;

revoke execute on function public.assert_owns_bridge_variant(uuid) from public, anon;
grant execute on function public.assert_owns_bridge_variant(uuid) to authenticated;

-- Design-review fix #2: advisory-locked (same idiom as reserve_ad_credits, Phase C) so a
-- double-click can't race two concurrent "start" calls into colliding on
-- bridge_variants_one_control_idx as a raw 500 instead of the idempotent no-op the UI expects.
create or replace function public.start_bridge_split_test(p_campaign_id uuid)
returns setof public.bridge_variants
language plpgsql
security definer set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('bridge_variants:' || p_campaign_id::text, 0));

  if not exists (
    select 1 from public.campaigns
    where id = p_campaign_id and user_id = auth.uid() and status = 'ready' and bridge_html is not null
  ) then
    raise exception 'Campaign not found or not ready to split test';
  end if;

  if exists (select 1 from public.bridge_variants where campaign_id = p_campaign_id) then
    return query select * from public.bridge_variants where campaign_id = p_campaign_id order by created_at;
    return;
  end if;

  insert into public.bridge_variants (user_id, campaign_id, label, is_control, weight)
  values (auth.uid(), p_campaign_id, 'Control', true, 50);

  insert into public.bridge_variants (user_id, campaign_id, label, is_control, weight, bridge_html, page_copy, embedded_image_data_url)
  select auth.uid(), p_campaign_id, 'B', false, 50, c.bridge_html, c.page_copy, c.embedded_image_data_url
  from public.campaigns c
  where c.id = p_campaign_id;

  return query select * from public.bridge_variants where campaign_id = p_campaign_id order by created_at;
end;
$$;

revoke execute on function public.start_bridge_split_test(uuid) from public, anon;
grant execute on function public.start_bridge_split_test(uuid) to authenticated;

-- Design-review fix #3: same advisory lock, taken before the row-count/label read and the cap
-- check, so two concurrent "Add variant" clicks can't both compute the same next label or both
-- squeeze past the 5-row cap.
create or replace function public.add_bridge_variant(p_campaign_id uuid)
returns public.bridge_variants
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
  v_label text;
  v_row public.bridge_variants;
begin
  perform pg_advisory_xact_lock(hashtextextended('bridge_variants:' || p_campaign_id::text, 0));

  if not exists (select 1 from public.campaigns where id = p_campaign_id and user_id = auth.uid()) then
    raise exception 'Campaign not found';
  end if;

  select count(*) into v_count from public.bridge_variants where campaign_id = p_campaign_id;
  if v_count = 0 then
    raise exception 'Start a split test first';
  end if;
  -- Nominal UI-sanity cap, not a real budget/security control — same "nominal, not real" framing
  -- as this codebase's other soft caps (e.g. MAX_CREATIVE_IMAGE_GENERATIONS_PER_DAY).
  if v_count >= 5 then
    raise exception 'Maximum of 5 variants per campaign';
  end if;

  v_label := chr(ascii('A') + v_count);

  insert into public.bridge_variants (user_id, campaign_id, label, is_control, weight, bridge_html, page_copy, embedded_image_data_url)
  select auth.uid(), p_campaign_id, v_label, false, 50, c.bridge_html, c.page_copy, c.embedded_image_data_url
  from public.campaigns c
  where c.id = p_campaign_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.add_bridge_variant(uuid) from public, anon;
grant execute on function public.add_bridge_variant(uuid) to authenticated;

create or replace function public.update_bridge_variant_weight(p_variant_id uuid, p_weight integer)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_weight < 1 or p_weight > 100 then
    raise exception 'weight must be between 1 and 100';
  end if;

  update public.bridge_variants
  set weight = p_weight, updated_at = now()
  where id = p_variant_id and user_id = auth.uid();

  if not found then
    raise exception 'variant not found';
  end if;
end;
$$;

revoke execute on function public.update_bridge_variant_weight(uuid, integer) from public, anon;
grant execute on function public.update_bridge_variant_weight(uuid, integer) to authenticated;

create or replace function public.pause_bridge_variant(p_variant_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.bridge_variants
  set status = 'paused', updated_at = now()
  where id = p_variant_id and user_id = auth.uid();

  if not found then
    raise exception 'variant not found';
  end if;
end;
$$;

revoke execute on function public.pause_bridge_variant(uuid) from public, anon;
grant execute on function public.pause_bridge_variant(uuid) to authenticated;

create or replace function public.resume_bridge_variant(p_variant_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.bridge_variants
  set status = 'active', updated_at = now()
  where id = p_variant_id and user_id = auth.uid();

  if not found then
    raise exception 'variant not found';
  end if;
end;
$$;

revoke execute on function public.resume_bridge_variant(uuid) from public, anon;
grant execute on function public.resume_bridge_variant(uuid) to authenticated;

create or replace function public.delete_bridge_variant(p_variant_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.bridge_variants where id = p_variant_id and user_id = auth.uid() and is_control
  ) then
    raise exception 'Cannot delete the control variant directly — end the split test instead';
  end if;

  delete from public.bridge_variants where id = p_variant_id and user_id = auth.uid();

  if not found then
    raise exception 'variant not found';
  end if;
end;
$$;

revoke execute on function public.delete_bridge_variant(uuid) from public, anon;
grant execute on function public.delete_bridge_variant(uuid) to authenticated;

create or replace function public.end_bridge_split_test(p_campaign_id uuid, p_promote_variant_id uuid default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_winner public.bridge_variants;
begin
  if not exists (select 1 from public.campaigns where id = p_campaign_id and user_id = auth.uid()) then
    raise exception 'Campaign not found';
  end if;

  if p_promote_variant_id is not null then
    select * into v_winner
    from public.bridge_variants
    where id = p_promote_variant_id
      and campaign_id = p_campaign_id
      and user_id = auth.uid()
      and not is_control;

    if not found then
      raise exception 'variant not found';
    end if;

    update public.campaigns
    set bridge_html = v_winner.bridge_html,
        page_copy = v_winner.page_copy,
        embedded_image_data_url = v_winner.embedded_image_data_url
    where id = p_campaign_id;
  end if;

  delete from public.bridge_variants where campaign_id = p_campaign_id and user_id = auth.uid();
end;
$$;

revoke execute on function public.end_bridge_split_test(uuid, uuid) from public, anon;
grant execute on function public.end_bridge_split_test(uuid, uuid) to authenticated;

-- service_role-only: called from the admin client in lib/publicPage.ts on every public bridge-page
-- view. A single atomic increment avoids a read-modify-write race under concurrent traffic that a
-- plain .update({views: n+1}) from the app would have.
create or replace function public.increment_bridge_variant_views(p_variant_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.bridge_variants set views = views + 1 where id = p_variant_id;
$$;

revoke execute on function public.increment_bridge_variant_views(uuid) from public, anon, authenticated;
grant execute on function public.increment_bridge_variant_views(uuid) to service_role;
