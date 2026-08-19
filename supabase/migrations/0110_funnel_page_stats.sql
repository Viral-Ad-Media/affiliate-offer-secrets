-- Per-page traffic counters for the funnel map: views and outbound link clicks, one row per
-- (campaign, page). page_key is 'optin' for the entry page or the funnel_steps row's uuid — the
-- step's ID, never its step_index, for the same reason branch targets store ids (0023's
-- move_funnel_step swaps index values between rows, so an index-keyed stat would silently start
-- describing a different page after any reorder).
--
-- Counters, not dated event rows, on purpose: the map needs totals, storage stays bounded at
-- (pages x campaigns) rows no matter how much traffic arrives, and there is no PII to erase.
-- The cost of that shape: no time series, and no rate-capping by recency the way
-- /api/public/leads counts recent contacts rows. Spam can inflate a number but can never grow
-- the table.
--
-- Opt-ins deliberately have NO counter here — contacts rows are the exact record of captured
-- leads, and a second tally would drift from the real one the first time a lead is erased.
create table public.funnel_page_stats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  page_key text not null check (page_key ~ '^[a-z0-9-]{1,40}$'),
  views bigint not null default 0,
  clicks bigint not null default 0,
  updated_at timestamptz not null default now(),
  unique (campaign_id, page_key)
);

alter table public.funnel_page_stats enable row level security;

-- Members read their workspace's stats (the funnel page queries this from the browser client,
-- the CreativeItemCard pattern). No client write path of any kind: increments come from public,
-- unauthenticated traffic and must go through the service-role RPC below, which derives
-- workspace_id from the campaign row rather than trusting any caller.
create policy funnel_page_stats_select on public.funnel_page_stats
  for select using (public.is_workspace_member(workspace_id));

revoke insert, update, delete on public.funnel_page_stats from anon, authenticated;

-- Atomic increment, the increment_bridge_variant_views shape — supabase-js cannot express
-- `set views = views + 1` through PostgREST. A campaign id that matches nothing is a silent
-- no-op: the callers are public routes serving real traffic, and stats must never make one throw.
create or replace function public.increment_funnel_page_stat(
  p_campaign_id uuid,
  p_page_key text,
  p_metric text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  if p_metric not in ('view', 'click') then
    raise exception 'unknown metric %', p_metric;
  end if;
  if p_page_key !~ '^[a-z0-9-]{1,40}$' then
    raise exception 'invalid page key';
  end if;
  select workspace_id into v_ws from public.campaigns where id = p_campaign_id;
  if v_ws is null then
    return;
  end if;
  insert into public.funnel_page_stats (workspace_id, campaign_id, page_key, views, clicks)
  values (
    v_ws,
    p_campaign_id,
    p_page_key,
    case when p_metric = 'view' then 1 else 0 end,
    case when p_metric = 'click' then 1 else 0 end
  )
  on conflict (campaign_id, page_key) do update
    set views = public.funnel_page_stats.views + case when p_metric = 'view' then 1 else 0 end,
        clicks = public.funnel_page_stats.clicks + case when p_metric = 'click' then 1 else 0 end,
        updated_at = now();
end;
$$;

revoke all on function public.increment_funnel_page_stat(uuid, text, text) from public, anon, authenticated;
grant execute on function public.increment_funnel_page_stat(uuid, text, text) to service_role;
