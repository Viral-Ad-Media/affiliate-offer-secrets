-- Insert a funnel step BETWEEN two existing ones, not only at the end.
--
-- This is the blocker for the ClickFunnels-style funnel map: CF's defining interaction is clicking
-- the connector circle between two nodes, which needs a position. `add_funnel_step` only ever did
-- `max(step_index) + 1`, so the UI could offer "add here" and then silently append somewhere else.
--
-- BACKWARD COMPATIBLE BY DEFAULT. `p_after_index` defaults to NULL = append, so today's two-arg
-- call sites (app/api/funnel-steps/route.ts) keep their exact behaviour with no edit. The old
-- 2-arg function is REPLACED rather than left beside a new 3-arg one: keeping both would make
-- every existing 2-arg call ambiguous to Postgres's resolver, which matches it against the old
-- signature exactly AND the new one via its default — the same trap `create_broadcast_sequence`
-- hit in 0035, resolved the same way.
--
-- THE SHIFT USES A SENTINEL OFFSET, NOT A NAIVE +1. `funnel_steps` has a `step_index >= 1` CHECK
-- and a NON-DEFERRABLE unique index on (campaign_id, step_index), so renumbering in place collides
-- with itself mid-statement the moment two rows swap through the same value. `move_funnel_step`
-- already solved this with a large offset; this reuses the identical idiom rather than inventing a
-- second one. Both run under the same advisory lock key, so an insert and a move serialise.
create or replace function public.add_funnel_step(
  p_campaign_id uuid,
  p_step_type text,
  p_after_index integer default null
) returns public.funnel_steps
language plpgsql
security definer set search_path = public
as $$
declare
  v_ws uuid;
  v_max integer;
  v_target integer;
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

  select coalesce(max(step_index), 0) into v_max
  from public.funnel_steps where campaign_id = p_campaign_id;

  if p_after_index is null or p_after_index >= v_max then
    -- Append. Also the answer for "after the last step", which is the same position.
    v_target := v_max + 1;
  else
    -- Insert after p_after_index (0 = before the first step, i.e. straight after the opt-in page).
    v_target := greatest(p_after_index, 0) + 1;

    -- Two passes through the sentinel range: everything at or after the target is parked far above
    -- the real range, then brought back down one higher. Neither pass can collide with a live row.
    update public.funnel_steps
       set step_index = 1000000000 + step_index
     where campaign_id = p_campaign_id and step_index >= v_target;

    update public.funnel_steps
       set step_index = step_index - 1000000000 + 1
     where campaign_id = p_campaign_id and step_index >= 1000000000;
  end if;

  insert into public.funnel_steps (user_id, workspace_id, campaign_id, step_type, step_index)
  values (auth.uid(), v_ws, p_campaign_id, p_step_type, v_target)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.add_funnel_step(uuid, text, integer) from public, anon;
grant execute on function public.add_funnel_step(uuid, text, integer) to authenticated;
