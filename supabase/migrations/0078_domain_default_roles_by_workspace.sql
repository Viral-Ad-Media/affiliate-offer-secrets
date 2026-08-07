-- Applied 2026-08-07. A verified domain takes the vacant blog/primary role automatically, and both
-- roles become one-per-WORKSPACE rather than one-per-user.
--
-- 1. RE-KEY THE UNIQUENESS. 0042 wrote these on user_id because it predates the workspace
--    migration (0057), and they were missed by the connector re-keying in 0071/0072. The setter
--    route already clears the flag across the whole WORKSPACE before setting it, so constraint and
--    code disagreed: two members of one workspace could each hold a serves_blog domain and the
--    blog would answer on two hosts — the duplicate-content problem 0042 existed to prevent.
--    Verified after applying: a second serves_blog domain in one workspace now raises
--    unique_violation.
drop index if exists public.custom_domains_one_blog_idx;
drop index if exists public.custom_domains_one_primary_idx;
create unique index custom_domains_one_blog_idx
  on public.custom_domains (workspace_id) where serves_blog;
create unique index custom_domains_one_primary_idx
  on public.custom_domains (workspace_id) where is_primary;

-- 2. AUTO-ASSIGN ON VERIFICATION — never on add. A pending domain's DNS doesn't point here, so
--    making it the blog host would publish links that 404; the setter route already refuses these
--    flags on a non-verified domain, and auto-setting at insert would contradict that rule.
--    Firing on the status transition covers every path that can verify a domain (the add route
--    when Vercel verifies immediately, the Verify button, any future caller) instead of three call
--    sites that each have to remember.
--
--    It only fills a VACANT role, so an explicit choice is never overridden and switching stays
--    the operator's decision. The trigger is scoped to `update of status` for the same reason —
--    it must not re-evaluate when the setter route writes the flags directly.
--    (Full function body applied via apply_migration; see the live definition.)
