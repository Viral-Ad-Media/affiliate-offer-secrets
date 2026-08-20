-- A REAL daily budget control for AI generation, replacing the framing of the five scattered
-- "nominal 100/day count" backstops (which stay as runaway guards). Generation jobs already charge
-- credits at queue time (0063, JOB_CREDIT_COST: images 2, videos 10), so the credit BALANCE is the
-- absolute ceiling; this adds an operator-set daily RATE ceiling so a runaway (cf. the Aug 18-19
-- incident) can't drain a whole balance in one day.
--
-- OFF by default: NULL = no cap, byte-identical to today. The operator opts in — deliberate, because
-- the solo-testing user explicitly does not want a surprise ceiling. Enforced in lib/generationBudget.ts.

alter table public.workspaces
  add column if not exists daily_generation_credit_cap integer;

comment on column public.workspaces.daily_generation_credit_cap is
  'Max credits spendable on AI generation per rolling 24h. NULL = unlimited. Set via set_workspace_generation_budget; enforced in the generation routes via lib/generationBudget.ts.';

-- Net credits spent on generation jobs in the last 24h for a workspace. Charges are negative deltas
-- and refunds positive, so -sum(delta) is the NET spend — a job that failed and refunded counts 0,
-- which is correct (the operator wasn't really charged for it). service_role-only: the generation
-- routes call it through the admin client after resolving the workspace from the session.
create or replace function public.workspace_generation_spend_today(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(-sum(cl.delta), 0)::integer
  from public.credits_ledger cl
  join public.jobs j on j.id = cl.job_id
  where cl.workspace_id = p_workspace_id
    and cl.created_at >= now() - interval '24 hours'
    and j.type in (
      'generate_ad_image', 'generate_creative_image', 'generate_blog_image',
      'generate_video', 'generate_creative_video'
    );
$$;

revoke execute on function public.workspace_generation_spend_today(uuid) from public, anon, authenticated;
grant execute on function public.workspace_generation_spend_today(uuid) to service_role;

-- Setter — same shape as set_workspace_generation_models (0093): SECURITY DEFINER, active workspace,
-- membership-checked, touches only this one column. `workspaces` stays SELECT-only for clients; do
-- not add a broad update policy. A negative cap is meaningless; clamp NULL/<0 to "unset".
create or replace function public.set_workspace_generation_budget(p_cap integer default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ws uuid;
begin
  v_ws := current_workspace_id();
  if v_ws is null then
    raise exception 'No active workspace';
  end if;
  if not is_workspace_member(v_ws) then
    raise exception 'Not a member of this workspace';
  end if;

  update public.workspaces
     set daily_generation_credit_cap = case when p_cap is null or p_cap < 0 then null else least(p_cap, 1000000) end,
         updated_at = now()
   where id = v_ws;
end;
$$;

revoke execute on function public.set_workspace_generation_budget(integer) from public, anon;
grant execute on function public.set_workspace_generation_budget(integer) to authenticated;
