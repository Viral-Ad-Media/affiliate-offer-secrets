-- Superadmin credit support must target the workspace that owns the credit pool.
--
-- The original admin_adjust_credits() accepted only a user id. Once credits became workspace-owned,
-- its workspace stamp came from auth.uid() -- the superadmin invoking the function -- while its
-- user_id attribution came from the support target. The account-level admin read then summed that
-- target user_id and made the misplaced adjustment look correct. Replace both halves with an
-- explicit workspace target and workspace-keyed aggregates.

-- Fail closed for stale clients before exposing the replacement. Keeping the old function in place
-- avoids a destructive schema change, but authenticated callers can no longer invoke it.
revoke execute on function public.admin_adjust_credits(uuid, integer, text)
  from public, anon, authenticated;

create or replace function public.admin_adjust_workspace_credits(
  p_target_user_id uuid,
  p_workspace_id uuid,
  p_delta integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_workspace_name text;
begin
  perform public.assert_superadmin();

  if p_delta is null or p_delta = 0 then
    raise exception 'delta must be non-zero';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  -- The selected account must actually belong to the selected workspace. Lock both rows so a
  -- concurrent member removal or workspace deletion cannot race the ledger insert.
  select w.name
    into v_workspace_name
    from public.workspaces w
    join public.workspace_members m
      on m.workspace_id = w.id
     and m.user_id = p_target_user_id
   where w.id = p_workspace_id
   for share of w, m;

  if not found then
    raise exception 'account is not a member of that workspace';
  end if;

  insert into public.credits_ledger (user_id, workspace_id, delta, reason)
  values (
    p_target_user_id,
    p_workspace_id,
    p_delta,
    'admin: ' || btrim(p_reason)
  );

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (
    auth.uid(),
    'adjust_credits',
    p_target_user_id,
    jsonb_build_object(
      'workspace_id', p_workspace_id,
      'workspace_name', v_workspace_name,
      'delta', p_delta,
      'reason', btrim(p_reason)
    )
  );
end;
$$;

revoke execute on function public.admin_adjust_workspace_credits(uuid, uuid, integer, text)
  from public, anon;
grant execute on function public.admin_adjust_workspace_credits(uuid, uuid, integer, text)
  to authenticated;

-- One row per account membership. Identity/access/trial remain account-scoped in admin_accounts(),
-- while every tenant-owned support number below is grouped by workspace_id. A shared workspace
-- therefore reports the same pool and content totals no matter which member's account row opened it.
create or replace function public.admin_account_workspaces()
returns table (
  user_id uuid,
  workspace_id uuid,
  workspace_name text,
  role text,
  is_active boolean,
  credits integer,
  products integer,
  campaigns integer,
  contacts integer,
  jobs_error integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
stable
as $$
begin
  perform public.assert_superadmin();

  return query
  with
  credit_totals as (
    select l.workspace_id, coalesce(sum(l.delta), 0)::integer as total
      from public.credits_ledger l
     group by l.workspace_id
  ),
  product_totals as (
    select x.workspace_id, count(*)::integer as total
      from public.products x
     group by x.workspace_id
  ),
  campaign_totals as (
    select x.workspace_id, count(*)::integer as total
      from public.campaigns x
     group by x.workspace_id
  ),
  contact_totals as (
    select x.workspace_id, count(*)::integer as total
      from public.contacts x
     group by x.workspace_id
  ),
  failed_job_totals as (
    select x.workspace_id, count(*)::integer as total
      from public.jobs x
     where x.status = 'error'
     group by x.workspace_id
  )
  select
    m.user_id,
    w.id,
    w.name,
    m.role,
    coalesce(p.active_workspace_id = w.id, false),
    coalesce(cr.total, 0),
    coalesce(pr.total, 0),
    coalesce(ca.total, 0),
    coalesce(co.total, 0),
    coalesce(jo.total, 0)
  from public.workspace_members m
  join public.workspaces w on w.id = m.workspace_id
  left join public.profiles p on p.id = m.user_id
  left join credit_totals cr on cr.workspace_id = w.id
  left join product_totals pr on pr.workspace_id = w.id
  left join campaign_totals ca on ca.workspace_id = w.id
  left join contact_totals co on co.workspace_id = w.id
  left join failed_job_totals jo on jo.workspace_id = w.id
  order by m.user_id, (p.active_workspace_id = w.id) desc nulls last,
           (m.role = 'owner') desc, w.name, w.id;
end;
$$;

revoke execute on function public.admin_account_workspaces() from public, anon;
grant execute on function public.admin_account_workspaces() to authenticated;
