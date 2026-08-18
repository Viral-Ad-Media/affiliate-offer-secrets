-- Arbitrary funnel-step reorder in one call, for the map's drag-and-drop.
--
-- move_funnel_step swaps ADJACENT steps, which is the right primitive for arrow buttons and the
-- wrong one for a drag: landing a step three positions away would mean three round trips, three
-- advisory locks, and three re-renders, with the intermediate states visible to a concurrent
-- reader. This takes the full desired order and rewrites the chain once, under the same
-- 'funnel_steps:{campaign}' advisory lock every other mutation of this table takes.
--
-- The caller supplies the COMPLETE chain, and that is verified, not trusted: every id must belong
-- to this campaign, all to the same variant chain (0092 gave variants their own step chains), and
-- the set must cover the chain exactly — a stale list (a teammate added a step since the map
-- loaded) is refused with a reload message rather than silently dropping their step to the end.
--
-- Membership check matches move_funnel_step post-0066: resolve the campaign's workspace and check
-- is_workspace_member, never auth.uid() = user_id.
create or replace function public.reorder_funnel_steps(p_campaign_id uuid, p_step_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_len integer;
  v_variant uuid;
  v_variant_count integer;
begin
  select workspace_id into v_ws from public.campaigns where id = p_campaign_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'campaign not found';
  end if;

  v_len := coalesce(array_length(p_step_ids, 1), 0);
  if v_len = 0 then
    raise exception 'no steps supplied';
  end if;
  if (select count(distinct x) from unnest(p_step_ids) x) <> v_len then
    raise exception 'duplicate step in the order';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('funnel_steps:' || p_campaign_id::text, 0));

  -- Every id must be a real step of this campaign.
  if exists (
    select 1 from unnest(p_step_ids) x
    left join public.funnel_steps fs on fs.id = x and fs.campaign_id = p_campaign_id
    where fs.id is null
  ) then
    raise exception 'step not found';
  end if;

  -- One chain only. bridge_variant_id null (the control chain) and each variant's own chain are
  -- separate orderings, and mixing them here would interleave two funnels' pages.
  select count(distinct coalesce(fs.bridge_variant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    into v_variant_count
  from public.funnel_steps fs where fs.id = any(p_step_ids);
  if v_variant_count <> 1 then
    raise exception 'steps belong to different variants';
  end if;
  select fs.bridge_variant_id into v_variant
  from public.funnel_steps fs where fs.id = p_step_ids[1];

  -- The set must be the WHOLE chain. Refusing a stale list beats silently shoving a teammate's
  -- freshly added step to an index the caller never saw.
  if (select count(*) from public.funnel_steps
       where campaign_id = p_campaign_id and bridge_variant_id is not distinct from v_variant)
     <> v_len then
    raise exception 'step list is out of date — reload the funnel and try again';
  end if;

  -- Two-phase rewrite: the unique index (campaign_id, bridge_variant_id, step_index) is not
  -- deferrable, so indexes hop through a sentinel range first — the same trick move_funnel_step
  -- uses for its swap, generalized.
  update public.funnel_steps fs
     set step_index = 1000000000 + t.ord::integer, updated_at = now()
    from unnest(p_step_ids) with ordinality as t(id, ord)
   where fs.id = t.id;

  update public.funnel_steps fs
     set step_index = t.ord::integer, updated_at = now()
    from unnest(p_step_ids) with ordinality as t(id, ord)
   where fs.id = t.id;
end;
$$;

revoke execute on function public.reorder_funnel_steps(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_funnel_steps(uuid, uuid[]) to authenticated;
