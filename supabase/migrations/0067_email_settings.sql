-- Sender identity for outgoing email: who replies go to, and who the sender legally is.
--
-- Kept apart from mail_provider_connections on purpose. That table is *transport* — an API key,
-- an SMTP host, a verified from-address — and it belongs with the other connections on Settings →
-- Integrations. This is *identity*, which is a marketing decision, changes independently of the
-- provider, and survives switching from SendGrid to Mailgun.
--
-- The postal address is the reason this table is more than a preferences bag. CAN-SPAM (US) and
-- CASL (CA) both require a valid physical mailing address in commercial email; the unsubscribe
-- link this codebase already treats as non-negotiable is only half of that obligation. Everything
-- here is nullable and everything degrades: an account that fills nothing in sends exactly what it
-- sends today, so this can't break existing accounts' mail on the way in.
create table public.email_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  -- Where replies land. Often a real monitored inbox while the from-address is a
  -- verified-with-the-provider sending domain that nobody reads.
  reply_to text,
  -- Shown above the address in the footer. Falls back to the workspace name at render time
  -- rather than being copied here, so renaming the workspace doesn't leave a stale signature.
  business_name text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text,
  -- One free-text line under the address — "You signed up at example.com", a phone number.
  footer_note text,
  updated_at timestamptz not null default now()
);

alter table public.email_settings enable row level security;

-- Same shape as every domain table since 0009: members read, nothing writes from a browser
-- session. The PATCH route owns writes through the admin client.
create policy "own email settings" on public.email_settings
  for select using (public.is_workspace_member(workspace_id));
revoke insert, update, delete on public.email_settings from anon, authenticated;
grant all on public.email_settings to service_role;
