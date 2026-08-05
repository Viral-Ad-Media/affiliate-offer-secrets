-- Setup checklist: only the dismissal is stored.
--
-- Every STEP is derived from real data at render time (does a network connection exist, are there
-- products, is a kit ready, is a funnel published) rather than from per-step flags. A checklist
-- computed from reality cannot go stale or disagree with the app: delete your last campaign and
-- the step un-ticks itself, which a stored boolean would get wrong forever. It also means no
-- write path to keep in sync — nothing has to remember to mark a step done.
--
-- Workspace-level, not per-user: connecting an affiliate network or publishing a funnel is
-- something the workspace does once, and a teammate joining an established workspace shouldn't be
-- handed a checklist someone else already completed.
alter table public.workspaces
  add column if not exists setup_dismissed_at timestamptz;

create or replace function public.dismiss_workspace_setup(p_workspace_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  v_ws := public.resolve_workspace_arg(p_workspace_id);
  if v_ws is null then return; end if;
  update public.workspaces set setup_dismissed_at = now() where id = v_ws;
end;
$$;

revoke execute on function public.dismiss_workspace_setup(uuid) from public, anon;
grant execute on function public.dismiss_workspace_setup(uuid) to authenticated;
