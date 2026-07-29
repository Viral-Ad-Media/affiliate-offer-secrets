-- Multi-step funnels: a campaign's opt-in (bridge) page stays exactly what it is today
-- (campaigns.bridge_html/page_copy/bridge_published/embedded_image_data_url + bridge_variants
-- A/B testing, unchanged) — this table only holds the ADDITIONAL fixed-type pages
-- (Thank-you/Upsell/Order) a tenant can optionally chain after it. A funnel with zero rows here
-- behaves exactly as before this feature existed.

create table public.funnel_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  step_type text not null check (step_type in ('thank_you', 'upsell', 'order')),
  step_index integer not null check (step_index >= 1),
  page_copy jsonb,
  html text,
  embedded_image_data_url text,
  cta_action text not null default 'hoplink' check (cta_action in ('next_step', 'hoplink')),
  -- Upsell only: cross-sell to a DIFFERENT product's hoplink. Null = this campaign's own product.
  -- Re-checked at write time (must belong to the same user) in app/api/funnel-steps/[id]/route.ts.
  target_product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, step_index)
);

create index funnel_steps_campaign_id_idx on public.funnel_steps(campaign_id);

alter table public.funnel_steps enable row level security;

-- Same owner-select/admin-write shape as bridge_variants — all real writes go through the
-- ownership-checked RPCs below or the admin client (app/api/funnel-steps routes).
create policy "own funnel steps" on public.funnel_steps for select using (auth.uid() = user_id);
revoke insert, update, delete on public.funnel_steps from anon, authenticated;
grant all on public.funnel_steps to service_role;

-- ---------------------------------------------------------------------------------------------

create or replace function public.assert_owns_funnel_step(p_step_id uuid)
returns boolean
language sql
security definer set search_path = public
as $$
  select exists(
    select 1 from public.funnel_steps where id = p_step_id and user_id = auth.uid()
  );
$$;

revoke execute on function public.assert_owns_funnel_step(uuid) from public, anon;
grant execute on function public.assert_owns_funnel_step(uuid) to authenticated;

-- Advisory-locked (same idiom as bridge_variants' start_bridge_split_test/add_bridge_variant) —
-- a double-click computing the same "next index" would otherwise collide on the
-- (campaign_id, step_index) unique constraint as a raw 500.
create or replace function public.add_funnel_step(p_campaign_id uuid, p_step_type text)
returns public.funnel_steps
language plpgsql
security definer set search_path = public
as $$
declare
  v_next_index integer;
  v_row public.funnel_steps;
begin
  if p_step_type not in ('thank_you', 'upsell', 'order') then
    raise exception 'invalid step_type';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('funnel_steps:' || p_campaign_id::text, 0));

  if not exists (select 1 from public.campaigns where id = p_campaign_id and user_id = auth.uid()) then
    raise exception 'Campaign not found';
  end if;

  select coalesce(max(step_index), 0) + 1 into v_next_index
  from public.funnel_steps where campaign_id = p_campaign_id;

  insert into public.funnel_steps (user_id, campaign_id, step_type, step_index)
  values (auth.uid(), p_campaign_id, p_step_type, v_next_index)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.add_funnel_step(uuid, text) from public, anon;
grant execute on function public.add_funnel_step(uuid, text) to authenticated;

create or replace function public.move_funnel_step(p_step_id uuid, p_direction text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_index integer;
  v_neighbor_id uuid;
  v_neighbor_index integer;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction';
  end if;

  select campaign_id, step_index into v_campaign_id, v_index
  from public.funnel_steps where id = p_step_id and user_id = auth.uid();
  if v_campaign_id is null then
    raise exception 'step not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('funnel_steps:' || v_campaign_id::text, 0));

  if p_direction = 'up' then
    select id, step_index into v_neighbor_id, v_neighbor_index
    from public.funnel_steps
    where campaign_id = v_campaign_id and user_id = auth.uid() and step_index < v_index
    order by step_index desc limit 1;
  else
    select id, step_index into v_neighbor_id, v_neighbor_index
    from public.funnel_steps
    where campaign_id = v_campaign_id and user_id = auth.uid() and step_index > v_index
    order by step_index asc limit 1;
  end if;

  if v_neighbor_id is null then
    return; -- already at the edge; no-op
  end if;

  -- Three separate statements with a large sentinel offset (not -1: step_index has a >=1 CHECK,
  -- and this table's unique index isn't deferrable) so the swap never collides mid-transaction.
  update public.funnel_steps set step_index = 1000000000 + v_index, updated_at = now() where id = p_step_id;
  update public.funnel_steps set step_index = v_index, updated_at = now() where id = v_neighbor_id;
  update public.funnel_steps set step_index = v_neighbor_index, updated_at = now() where id = p_step_id;
end;
$$;

revoke execute on function public.move_funnel_step(uuid, text) from public, anon;
grant execute on function public.move_funnel_step(uuid, text) to authenticated;

create or replace function public.delete_funnel_step(p_step_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_campaign_id uuid;
begin
  select campaign_id into v_campaign_id
  from public.funnel_steps where id = p_step_id and user_id = auth.uid();
  if v_campaign_id is null then
    raise exception 'step not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('funnel_steps:' || v_campaign_id::text, 0));

  delete from public.funnel_steps where id = p_step_id and user_id = auth.uid();
end;
$$;

revoke execute on function public.delete_funnel_step(uuid) from public, anon;
grant execute on function public.delete_funnel_step(uuid) to authenticated;
