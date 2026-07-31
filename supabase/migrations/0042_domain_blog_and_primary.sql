-- Applied via the Supabase MCP on 2026-07-31 (see also 0043).
-- Two per-tenant domain choices that until now could only be set with raw SQL.
--
-- serves_blog already existed (0033) and is already honored by app/d/[[...path]]/route.ts, but
-- nothing in the app could set it. It also had no uniqueness: two domains both serving the same
-- blog means two URLs for every post, which is a duplicate-content problem for the tenant, not
-- just a UI oddity. Enforced as one-per-tenant here, matching how the settings UI presents it.
create unique index if not exists custom_domains_one_blog_idx
  on public.custom_domains (user_id) where serves_blog;

-- The primary domain is the one the app treats as this tenant's public home: the origin shown for
-- funnel/blog links and the default canonical when a page isn't reached through a domain of its
-- own. Purely a display/canonical choice — serving stays host-based, so marking a domain primary
-- never changes what any URL actually resolves to.
alter table public.custom_domains
  add column if not exists is_primary boolean not null default false;

create unique index if not exists custom_domains_one_primary_idx
  on public.custom_domains (user_id) where is_primary;

-- Both flags are meaningless on a domain that isn't actually serving traffic yet, and a domain can
-- fall back to 'error' after verification (the reverify sweep). Rather than a CHECK that would
-- make that status transition fail mid-statement, the setter route requires status='verified' and
-- this trigger clears the flags if a domain ever leaves that state.
create or replace function public.clear_domain_flags_when_unverified()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status is distinct from 'verified' then
    new.serves_blog := false;
    new.is_primary := false;
  end if;
  return new;
end;
$$;

drop trigger if exists custom_domains_clear_flags on public.custom_domains;
create trigger custom_domains_clear_flags
  before insert or update of status on public.custom_domains
  for each row execute function public.clear_domain_flags_when_unverified();
