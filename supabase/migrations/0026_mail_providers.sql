-- Mail provider connections beyond Gmail: Resend / SendGrid / Mailgun (native APIs) + generic
-- SMTP. One row per (user, provider); each row's single credential (API key, or SMTP password)
-- lives in Vault via the existing generic store/get/delete_oauth_secret RPCs
-- (0010_connectors.sql) — same per-row Vault pattern as every OAuth connector. Exactly one
-- sender is active per account at a time (profiles.active_mail_provider, default 'gmail' so
-- nothing changes for existing users); every send — one-off SendEmail and Broadcast sequences —
-- routes through the active one (lib/mail/send.ts).

create table public.mail_provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('resend', 'sendgrid', 'mailgun', 'smtp')),
  -- The one credential per provider (API key, or the SMTP password) — a Vault secret id, never
  -- plaintext. Non-secret transport config lives in plain columns below.
  secret_id uuid not null,
  smtp_host text,
  smtp_port integer check (smtp_port between 1 and 65535),
  smtp_username text,
  smtp_secure boolean,
  mailgun_domain text,
  mailgun_region text check (mailgun_region in ('us', 'eu')),
  from_address text not null,
  from_name text,
  status text not null default 'connected' check (status in ('connected', 'error')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- Bearer-credential table: default-deny RLS (no policies at all) + explicit GRANT-layer lockout,
-- same belt-and-suspenders shape as meta_connections/tiktok_connections/mail_connections. Reads
-- for the UI go through the sanitized RPC below, never the table.
alter table public.mail_provider_connections enable row level security;
revoke all on public.mail_provider_connections from anon, authenticated;
grant all on public.mail_provider_connections to service_role;

-- Exactly one active sender per account. Default 'gmail' preserves existing behavior for every
-- current user (their connected Gmail keeps sending; users with nothing connected see the same
-- "connect first" gating as before). No general profiles update policy exists (deliberate, see
-- 0002_trial.sql) — changes go through set_active_mail_provider() below.
alter table public.profiles add column active_mail_provider text not null default 'gmail'
  check (active_mail_provider in ('gmail', 'resend', 'sendgrid', 'mailgun', 'smtp'));

-- Which provider actually performed each send — null on legacy rows (all Gmail).
alter table public.mail_sends add column provider text;
alter table public.broadcast_sends add column provider text;

-- Sanitized connection list for the Connections page — no secret ids, ever.
create or replace function public.get_mail_provider_connections()
returns jsonb
language sql
security definer set search_path = public
as $$
  select jsonb_build_object(
    'active_provider', (select active_mail_provider from public.profiles where id = auth.uid()),
    'providers', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'provider', c.provider,
          'from_address', c.from_address,
          'from_name', c.from_name,
          'status', c.status,
          'error', c.error,
          'smtp_host', c.smtp_host,
          'mailgun_domain', c.mailgun_domain
        ) order by c.provider)
        from public.mail_provider_connections c
        where c.user_id = auth.uid()
      ),
      '[]'::jsonb
    )
  );
$$;

revoke execute on function public.get_mail_provider_connections() from public, anon;
grant execute on function public.get_mail_provider_connections() to authenticated;

-- Switch the active sender. Validates the target is actually connected first — 'gmail' needs a
-- mail_connections row, anything else needs a mail_provider_connections row — so the active
-- pointer can never dangle at a provider with no credentials.
create or replace function public.set_active_mail_provider(p_provider text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_provider not in ('gmail', 'resend', 'sendgrid', 'mailgun', 'smtp') then
    raise exception 'Unknown mail provider';
  end if;

  if p_provider = 'gmail' then
    if not exists (select 1 from public.mail_connections where user_id = auth.uid()) then
      raise exception 'Gmail is not connected';
    end if;
  else
    if not exists (
      select 1 from public.mail_provider_connections
      where user_id = auth.uid() and provider = p_provider
    ) then
      raise exception 'That provider is not connected';
    end if;
  end if;

  update public.profiles set active_mail_provider = p_provider where id = auth.uid();
end;
$$;

revoke execute on function public.set_active_mail_provider(text) from public, anon;
grant execute on function public.set_active_mail_provider(text) to authenticated;

-- The one question send surfaces (SendEmail.tsx, BroadcastActivateControl.tsx) actually need
-- answered: "can this account send email right now, and via what?" — replaces their direct use
-- of the Gmail-specific get_mail_connection_status().
create or replace function public.get_active_mail_sender()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_provider text;
  v_connected boolean;
begin
  select active_mail_provider into v_provider from public.profiles where id = auth.uid();
  if v_provider is null then
    return jsonb_build_object('connected', false, 'provider', null);
  end if;

  if v_provider = 'gmail' then
    select exists (
      select 1 from public.mail_connections where user_id = auth.uid() and status = 'connected'
    ) into v_connected;
  else
    select exists (
      select 1 from public.mail_provider_connections
      where user_id = auth.uid() and provider = v_provider and status = 'connected'
    ) into v_connected;
  end if;

  return jsonb_build_object('connected', v_connected, 'provider', v_provider);
end;
$$;

revoke execute on function public.get_active_mail_sender() from public, anon;
grant execute on function public.get_active_mail_sender() to authenticated;
