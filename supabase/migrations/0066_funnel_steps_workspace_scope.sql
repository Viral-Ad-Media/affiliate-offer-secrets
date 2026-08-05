-- Funnel-step RPCs still authorized by `user_id = auth.uid()`, which predates workspaces.
--
-- 0023 wrote these when a tenant was a person. The workspace migration updated
-- assert_owns_funnel_step (it already accepts is_workspace_member) but missed these three, so a
-- teammate cannot add, move or delete a step on a campaign another member created — the campaign
-- is visible to them, the buttons are there, and the RPC raises "Campaign not found".
--
-- move_funnel_step carries a second, quieter bug: its NEIGHBOUR lookup is also filtered by
-- auth.uid(). In a funnel whose steps were created by two different members, "move up" would skip
-- past the other member's step and swap with the one beyond it — reordering the funnel wrongly
-- rather than failing. Nothing would report an error.
--
-- The fix throughout is the campaign's workspace, not the caller's. A step belongs to its
-- campaign's workspace as a matter of fact; resolving it any other way (for example from
-- current_workspace_id(), which is what the stamp_workspace_id trigger falls back to) makes the
-- row's home depend on which workspace the caller happened to be looking at.
--
-- user_id stays on the row as created-by attribution, exactly as it does everywhere else since
-- 0058 — it is simply no longer the authorization check.

create or replace function public.add_funnel_step(p_campaign_id uuid, p_step_type text)
returns public.funnel_steps
language plpgsql
security definer set search_path = public
as $$
declare
  v_ws uuid;
  v_next_index integer;
  v_row public.funnel_steps;
begin
  if p_step_type not in ('thank_you', 'upsell', 'order') then
    raise exception 'invalid step_type';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('funnel_steps:' || p_campaign_id::text, 0));

  select workspace_id into v_ws from public.campaigns where id = p_campaign_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'Campaign not found';
  end if;

  select coalesce(max(step_index), 0) + 1 into v_next_index
  from public.funnel_steps where campaign_id = p_campaign_id;

  -- workspace_id set explicitly rather than left to the stamp_workspace_id trigger: the trigger
  -- falls back to the CALLER's active workspace, which for someone in two workspaces could file
  -- the step somewhere other than where its own campaign lives.
  insert into public.funnel_steps (user_id, workspace_id, campaign_id, step_type, step_index)
  values (auth.uid(), v_ws, p_campaign_id, p_step_type, v_next_index)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.move_funnel_step(p_step_id uuid, p_direction text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_ws uuid;
  v_index integer;
  v_neighbor_id uuid;
  v_neighbor_index integer;
begin
  if p_direction not in ('up', 'down') then
    raise exception 'invalid direction';
  end if;

  select campaign_id, workspace_id, step_index into v_campaign_id, v_ws, v_index
  from public.funnel_steps where id = p_step_id;
  if v_campaign_id is null or not public.is_workspace_member(v_ws) then
    raise exception 'step not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('funnel_steps:' || v_campaign_id::text, 0));

  -- Neighbour scoped by campaign only. Filtering it by creator (as this did) means "up" jumps
  -- over a teammate's step instead of swapping with it.
  if p_direction = 'up' then
    select id, step_index into v_neighbor_id, v_neighbor_index
    from public.funnel_steps
    where campaign_id = v_campaign_id and step_index < v_index
    order by step_index desc limit 1;
  else
    select id, step_index into v_neighbor_id, v_neighbor_index
    from public.funnel_steps
    where campaign_id = v_campaign_id and step_index > v_index
    order by step_index asc limit 1;
  end if;

  if v_neighbor_id is null then
    return; -- already at the end; not an error
  end if;

  -- Three-way swap through a parked index, because (campaign_id, step_index) is unique and a
  -- direct swap would collide mid-statement.
  update public.funnel_steps set step_index = 1000000000 + v_index, updated_at = now() where id = p_step_id;
  update public.funnel_steps set step_index = v_index, updated_at = now() where id = v_neighbor_id;
  update public.funnel_steps set step_index = v_neighbor_index, updated_at = now() where id = p_step_id;
end;
$$;

create or replace function public.delete_funnel_step(p_step_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_ws uuid;
begin
  select campaign_id, workspace_id into v_campaign_id, v_ws
  from public.funnel_steps where id = p_step_id;
  if v_campaign_id is null or not public.is_workspace_member(v_ws) then
    raise exception 'step not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('funnel_steps:' || v_campaign_id::text, 0));

  delete from public.funnel_steps where id = p_step_id;
end;
$$;

-- Grants are unchanged from 0023 (authenticated only); restated because create or replace does
-- not reset them and an explicit statement is cheaper to verify than an assumption.
revoke execute on function public.add_funnel_step(uuid, text) from public, anon;
revoke execute on function public.move_funnel_step(uuid, text) from public, anon;
revoke execute on function public.delete_funnel_step(uuid) from public, anon;
grant execute on function public.add_funnel_step(uuid, text) to authenticated;
grant execute on function public.move_funnel_step(uuid, text) to authenticated;
grant execute on function public.delete_funnel_step(uuid) to authenticated;
