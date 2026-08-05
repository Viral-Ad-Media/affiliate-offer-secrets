-- The tour is per-PERSON, unlike the setup checklist which is per-workspace (0073).
-- Deliberate: "has this workspace connected a network" is a fact about the org, but "has this
-- human been shown around" is a fact about the human. A teammate joining an established
-- workspace has completed none of the tour even though every setup step is already done.
--
-- Nullable timestamp rather than a boolean so it also answers "when", which is what you want if
-- the tour ever changes and you need to know who saw which version.
alter table public.profiles
  add column if not exists tour_completed_at timestamptz;

-- profiles is SELECT-only for clients by design (a broad update policy previously allowed
-- self-granting access_granted), so these are narrow RPCs rather than a policy — same shape as
-- every other profile write in this codebase.
create or replace function public.complete_product_tour()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles set tour_completed_at = now() where id = auth.uid();
end;
$$;

revoke execute on function public.complete_product_tour() from public, anon;
grant execute on function public.complete_product_tour() to authenticated;

-- Replay: clears the caller's own flag only.
create or replace function public.restart_product_tour()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  update public.profiles set tour_completed_at = null where id = auth.uid();
end;
$$;

revoke execute on function public.restart_product_tour() from public, anon;
grant execute on function public.restart_product_tour() to authenticated;
