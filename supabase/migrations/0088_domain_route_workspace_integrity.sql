-- A caller who belonged to two workspaces could pass a domain from one and a campaign from the
-- other: the old RPC authorized each independently, then stamped the route with the domain's
-- workspace. Custom-domain serving treats that mapping as its tenant boundary, so the relationship
-- itself must prove all three rows belong to one workspace.

-- There is no safe owner to infer for an already-mismatched public mapping. Remove it so it stops
-- serving immediately; valid same-workspace routes are untouched.
delete from public.custom_domain_routes route
using public.custom_domains domain, public.campaigns campaign
where domain.id = route.domain_id
  and campaign.id = route.campaign_id
  and (
    route.workspace_id <> domain.workspace_id
    or route.workspace_id <> campaign.workspace_id
    or domain.workspace_id <> campaign.workspace_id
  );

-- Composite foreign keys make the invariant structural for every future writer, including
-- service_role and migrations—not merely a convention inside add_domain_route().
create unique index if not exists custom_domains_id_workspace_key
  on public.custom_domains (id, workspace_id);
create unique index if not exists campaigns_id_workspace_key
  on public.campaigns (id, workspace_id);

alter table public.custom_domain_routes
  drop constraint if exists custom_domain_routes_domain_workspace_fkey;
alter table public.custom_domain_routes
  add constraint custom_domain_routes_domain_workspace_fkey
  foreign key (domain_id, workspace_id)
  references public.custom_domains(id, workspace_id)
  on delete cascade;

alter table public.custom_domain_routes
  drop constraint if exists custom_domain_routes_campaign_workspace_fkey;
alter table public.custom_domain_routes
  add constraint custom_domain_routes_campaign_workspace_fkey
  foreign key (campaign_id, workspace_id)
  references public.campaigns(id, workspace_id)
  on delete cascade;

create or replace function public.add_domain_route(
  p_domain_id uuid,
  p_path text,
  p_campaign_id uuid,
  p_destination text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_new_id uuid;
  v_workspace_id uuid;
  v_path text := coalesce(p_path, '');
begin
  select domain.workspace_id into v_workspace_id
  from public.custom_domains domain
  where domain.id = p_domain_id
    and public.is_workspace_member(domain.workspace_id);

  if v_workspace_id is null then
    raise exception 'Domain or campaign not found for this workspace';
  end if;

  if not exists (
    select 1
    from public.campaigns campaign
    where campaign.id = p_campaign_id
      and campaign.workspace_id = v_workspace_id
  ) then
    raise exception 'Domain or campaign not found for this workspace';
  end if;

  if p_destination not in ('presell', 'bridge') then
    raise exception 'Invalid destination';
  end if;
  if length(v_path) > 200 or v_path !~ '^[a-z0-9_/-]*$' then
    raise exception 'Invalid domain path';
  end if;

  insert into public.custom_domain_routes (
    domain_id, user_id, workspace_id, campaign_id, destination, path
  ) values (
    p_domain_id, auth.uid(), v_workspace_id, p_campaign_id, p_destination, v_path
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke execute on function public.add_domain_route(uuid, text, uuid, text) from public, anon;
grant execute on function public.add_domain_route(uuid, text, uuid, text) to authenticated;
