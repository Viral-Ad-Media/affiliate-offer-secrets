-- Sending SMS: a per-workspace provider connection, consent recorded separately from the number,
-- and an audit trail. Applied 2026-08-17.

-- A PHONE NUMBER IS NOT CONSENT TO TEXT IT. Three separate facts, and conflating them is the
-- compliance failure that gets a sending number shut off:
--   phone            we have a number
--   sms_consent_at   they explicitly agreed to receive texts (TCPA prior express written consent)
--   sms_opted_out_at they told us to stop, which overrides consent permanently
-- Deliberately NOT reusing unsubscribed_at: email and SMS consent are legally distinct, and a
-- contact who unsubscribed from email may still be a valid SMS recipient, and vice versa.
alter table public.contacts
  add column if not exists phone text,
  add column if not exists sms_consent_at timestamptz,
  add column if not exists sms_opted_out_at timestamptz;

create index if not exists contacts_ws_phone_idx on public.contacts (workspace_id, phone) where phone is not null;

-- The auth token is a live bearer credential, so it lives in Vault behind a secret id and this
-- table gets the meta_connections treatment: RLS on with NO policies (default deny) PLUS an
-- explicit revoke, so a future permissive policy still can't expose it. Reads go through the
-- sanitized get_sms_connection_status() RPC.
create table if not exists public.sms_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'twilio' check (provider in ('twilio')),
  account_sid text not null,
  auth_token_secret_id uuid not null,
  from_number text not null,
  status text not null default 'active' check (status in ('active', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);
alter table public.sms_connections enable row level security;
revoke all on public.sms_connections from anon, authenticated;

-- Audit trail. Owner-select like meta_posts/mail_sends; only the service-role sender writes.
-- contact_id is on-delete-set-null: that a message was sent is a real record that should outlive
-- the contact, the same call contacts.campaign_id and broadcast_sends already make.
create table if not exists public.sms_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  to_number text not null,
  body text not null,
  segments int not null default 1,
  status text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  provider_sid text,
  error_message text,
  created_at timestamptz not null default now()
);
alter table public.sms_sends enable row level security;
drop policy if exists "members read sms sends" on public.sms_sends;
create policy "members read sms sends" on public.sms_sends
  for select using (is_workspace_member(workspace_id));
revoke insert, update, delete on public.sms_sends from anon, authenticated;
create index if not exists sms_sends_ws_created_idx on public.sms_sends (workspace_id, created_at desc);

create or replace function public.get_sms_connection_status(p_workspace_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ws uuid; v jsonb;
begin
  v_ws := coalesce(p_workspace_id, current_workspace_id());
  if v_ws is null or not is_workspace_member(v_ws) then
    return jsonb_build_object('connected', false);
  end if;
  select jsonb_build_object('connected', true, 'provider', c.provider, 'from_number', c.from_number,
                            'account_sid', c.account_sid, 'status', c.status, 'error_message', c.error_message)
    into v from public.sms_connections c where c.workspace_id = v_ws;
  return coalesce(v, jsonb_build_object('connected', false));
end; $$;
revoke all on function public.get_sms_connection_status(uuid) from public, anon;
grant execute on function public.get_sms_connection_status(uuid) to authenticated;
