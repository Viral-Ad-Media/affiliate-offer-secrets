-- Client-facing manual product add — the first way a Digistore24 (or any non-ClickBank-discovery)
-- product ever enters `products`, since automated discovery only exists for ClickBank today (see
-- lib/engine/discover.ts). Wraps the existing service-role-only upsert_product()
-- (0004_atomic_product_upsert.sql) rather than duplicating its merge logic, but — critically —
-- hardcodes p_user_id from the calling session (auth.uid()), never from client input, so this can
-- safely be granted to `authenticated` without becoming a cross-tenant write primitive the way a
-- bare grant on upsert_product() itself would be (that function trusts its p_user_id argument
-- completely, which is fine when only the service-role worker can call it).
create function public.add_manual_product(p_meta jsonb)
returns public.products
language plpgsql
security definer set search_path = public
as $$
begin
  return public.upsert_product(auth.uid(), p_meta);
end;
$$;

revoke execute on function public.add_manual_product(jsonb) from public, anon;
grant execute on function public.add_manual_product(jsonb) to authenticated;
