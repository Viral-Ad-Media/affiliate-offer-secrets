-- Domain-route RPCs were still authorized by `user_id = auth.uid()`, written in 0009 when a tenant
-- was a person. `custom_domains` and `custom_domain_routes` have been workspace-scoped since 0057.
--
-- Exactly the bug 0066 fixed for add/move/delete_funnel_step, in exactly the same way: a teammate
-- could see a workspace's domain and its "Add path" form, and got "domain not found or not owned by
-- caller" — or, worse, remove_domain_route deleted ZERO rows and returned success, so the mapping
-- reappeared on reload with no error anywhere. A silent no-op reads as "nothing happens".

create or replace function public.add_domain_route(
  p_domain_id uuid,
  p_path text,
  p_campaign_id uuid,
  p_destination text
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  new_id uuid;
  v_workspace_id uuid;
begin
  -- Membership, not ownership. Also captures the DOMAIN's workspace, which the insert below stamps
  -- explicitly rather than leaving to stamp_workspace_id() — that trigger's fallback is the
  -- CALLER's active workspace, so someone in two workspaces could file a route somewhere other
  -- than where its own domain lives (same trap CLAUDE.md documents for add_funnel_step).
  select d.workspace_id into v_workspace_id
    from public.custom_domains d
   where d.id = p_domain_id
     and public.is_workspace_member(d.workspace_id);

  if v_workspace_id is null then
    raise exception 'domain not found for this account';
  end if;

  -- Unchanged: this is the load-bearing check that stops a tenant mapping their own verified
  -- domain's path at ANOTHER tenant's campaign and re-serving it under a host they control.
  if not public.assert_owns_campaign(p_campaign_id) then
    raise exception 'campaign not found for this account';
  end if;

  if p_destination not in ('presell', 'bridge') then
    raise exception 'invalid destination';
  end if;

  insert into public.custom_domain_routes (domain_id, user_id, workspace_id, campaign_id, destination, path)
  values (p_domain_id, auth.uid(), v_workspace_id, p_campaign_id, p_destination, coalesce(p_path, ''))
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.remove_domain_route(p_route_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  delete from public.custom_domain_routes r
   where r.id = p_route_id
     and public.is_workspace_member(r.workspace_id);
end;
$$;

revoke execute on function public.add_domain_route(uuid, text, uuid, text) from public, anon;
grant execute on function public.add_domain_route(uuid, text, uuid, text) to authenticated;
revoke execute on function public.remove_domain_route(uuid) from public, anon;
grant execute on function public.remove_domain_route(uuid) to authenticated;
