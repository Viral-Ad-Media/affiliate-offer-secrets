-- products.status has always been free text, which was harmless while only the engine wrote it
-- ("New" on discovery, "Promoting" when a kit finishes). The status picker makes it a client-driven
-- value, and products' RLS is `for all` (a tenant can PATCH their own row directly through
-- PostgREST) — so the API route's validation is a UX nicety, not the boundary. This constraint is.
--
-- Safe to add unconditionally: verified before applying that only 'New' and 'Promoting' exist.
alter table public.products
  add constraint products_status_check
  check (status in ('New', 'Selected', 'Promoting', 'Paused', 'Dead'));
