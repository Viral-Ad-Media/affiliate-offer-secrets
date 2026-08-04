-- Workspace Phase 3, step 1: look a workspace up by its slug — the first time anything in this
-- system does. Until now `workspaces.slug` was write-only data: generated at signup, collision-
-- checked by create_workspace/update_workspace, and read by exactly one query for exactly one
-- URL that 404s. Per-organization subdomains are what finally give it a job.
--
-- Membership is folded into the lookup rather than left to the caller, for two reasons:
--
--   1. It cannot be forgotten. The value this returns goes straight into `.eq("workspace_id", ws)`
--      as the app's UX scope; a version that returned an id for a workspace you don't belong to
--      would put a stranger's workspace id into every query on the page. RLS would still refuse
--      every row (is_workspace_member is the real boundary, and it is untouched here), so this is
--      not the security boundary — but "every list is silently empty" is a bad way to find out.
--
--   2. NULL for "no such workspace" and NULL for "not a member" are indistinguishable to the
--      caller, so acme.affiliateoffersecrets.com cannot be used to probe which workspaces exist.
--      Same no-oracle discipline as every public route in this codebase, applied to a hostname.
--
-- SECURITY DEFINER for the same reason as is_workspace_member (0041): policies on
-- workspace_members must not recurse through that table's own RLS. `stable`, so it can be
-- inlined and is safe to call more than once in a statement.
create or replace function public.workspace_id_for_slug(p_slug text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select w.id
    from public.workspaces w
   where w.slug = p_slug
     and public.is_workspace_member(w.id)
$$;

revoke execute on function public.workspace_id_for_slug(text) from public, anon;
grant execute on function public.workspace_id_for_slug(text) to authenticated;

-- Housekeeping surfaced by the advisors while adding the function above: 0058's trigger function
-- was executable by anon/authenticated via the default PUBLIC grant. PostgREST refuses to expose
-- trigger-returning functions as RPCs, so this was never actually callable — revoked anyway, so
-- the advisors report stays readable and the grant matches the intent.
revoke execute on function public.stamp_workspace_id() from public, anon, authenticated;
