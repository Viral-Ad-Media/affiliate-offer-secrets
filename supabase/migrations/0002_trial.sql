-- 30-day free trial, gated by a self-service RPC instead of open column writes.
--
-- The original "update own profile" policy allowed any signed-in user to PATCH their own
-- profiles row directly via the REST API, including access_granted — letting them grant
-- themselves paid access without paying. Replaced with no direct client writes to profiles;
-- access_granted still only comes from the Stripe webhook, and trial_ends_at only comes from
-- this RPC, which is self-limiting (one trial per user, only if access hasn't been paid for).

alter table public.profiles add column trial_ends_at timestamptz;

drop policy "update own profile" on public.profiles;

create function public.start_trial()
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  result public.profiles;
begin
  update public.profiles
  set trial_ends_at = now() + interval '30 days',
      updated_at = now()
  where id = auth.uid()
    and access_granted = false
    and trial_ends_at is null
  returning * into result;

  if result is null then
    raise exception 'Trial not available';
  end if;

  return result;
end;
$$;

revoke execute on function public.start_trial() from public, anon;
grant execute on function public.start_trial() to authenticated;
