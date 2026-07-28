-- Captured leads from a bridge page's opt-in form (see app/api/public/leads/route.ts and
-- lib/engine/renderPages.ts's renderBridgeHtml()). This is the first table in this codebase that
-- stores a third party's PII (a tenant's own site visitor, not the tenant's own data), written by
-- this app's first-ever anonymous, unauthenticated endpoint.

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  first_name text,
  email text not null,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index contacts_user_id_idx on public.contacts(user_id);
create index contacts_campaign_created_idx on public.contacts(campaign_id, created_at);

-- Soft de-dupe: collapses accidental double-submits (double-click, back-button resubmit) for the
-- same person on the same bridge page without the insert erroring. Plain (campaign_id, email)
-- column pair, not lower(email) or a partial WHERE — both are conflict-target shapes supabase-js's
-- .upsert({onConflict}) can't express (PostgREST only accepts a plain column-name list, matched
-- via a real, non-partial constraint). No WHERE clause is needed anyway: standard SQL uniqueness
-- never treats NULL as equal to NULL, so rows that survive a campaign delete (campaign_id set
-- null) already coexist freely under a plain unique index, without an explicit predicate.
-- Case-insensitive de-dupe is achieved by normalizing email to lowercase in application code
-- (app/api/public/leads/route.ts) before every insert, not via a functional index.
create unique index contacts_campaign_email_idx
  on public.contacts (campaign_id, email);

alter table public.contacts enable row level security;

-- Same RLS shape as meta_posts/instagram_posts/etc — plain owner-select, no client write policy at
-- all. The trust model differs (this PII describes a third party, not an action the tenant took),
-- but that doesn't change the RLS story: the only legitimate writer is the public leads endpoint,
-- running on the admin client (bypasses RLS regardless of what policy exists here) from a caller
-- with no auth.uid() at all — never an authenticated tenant's own browser session. What actually
-- protects this table is the endpoint's own campaign_id + status='ready' scoping, which derives
-- user_id strictly from the campaign row — there is no client-suppliable tenant field anywhere in
-- this schema, and there must never be one added later.
create policy "own contacts" on public.contacts for select using (auth.uid() = user_id);
revoke insert, update, delete on public.contacts from anon, authenticated;
grant all on public.contacts to service_role;
