-- Retire Gmail as a sending provider.
--
-- Gmail's `gmail.send` is a Google RESTRICTED scope: fine for one operator in Testing mode (100
-- test users), but a public rollout needs Google's security assessment, which can require a
-- third-party audit. That is the wrong dependency to put under a multi-tenant product's email
-- backbone when Resend/SendGrid/Mailgun/SMTP (0026) already do the same job with a per-tenant API
-- key and no review process. Gmail OAuth is removed from the app entirely; the provider path
-- becomes the only automated sender, with manual mailto/copy send as the zero-setup fallback.
--
-- `mail_connections` (the Vault-backed Gmail token table) is deliberately NOT dropped — same call
-- already made for profiles.nickname: leaving an unread legacy table costs nothing, while a
-- destructive drop is unrecoverable if this decision is revisited. Nothing reads it after this
-- migration. Its stored Vault secrets are likewise left alone rather than bulk-deleted.

-- 'gmail' leaves the enum. Existing rows pointing at it become NULL = "no sender configured",
-- which get_active_mail_sender() and lib/mail/send.ts both already treat as not-connected — the
-- same state a brand-new account is in, so the UI gating needs no new case. The column must drop
-- NOT NULL for that to be representable; the old default of 'gmail' goes with it.
-- Order matters: NOT NULL and the old CHECK both have to go BEFORE the rows are nulled, or the
-- UPDATE fails against constraints that are still in force.
alter table public.profiles alter column active_mail_provider drop default;
alter table public.profiles alter column active_mail_provider drop not null;
alter table public.profiles drop constraint if exists profiles_active_mail_provider_check;

update public.profiles set active_mail_provider = null where active_mail_provider = 'gmail';

alter table public.profiles add constraint profiles_active_mail_provider_check
  check (active_mail_provider is null
         or active_mail_provider in ('resend', 'sendgrid', 'mailgun', 'smtp'));

-- Drop the gmail branch. A null provider now means "nothing configured" rather than "fall back to
-- Gmail", so the caller gets a clean connected:false instead of a Gmail lookup that can't succeed.
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

  select exists (
    select 1 from public.mail_provider_connections
    where user_id = auth.uid() and provider = v_provider and status = 'connected'
  ) into v_connected;

  return jsonb_build_object('connected', v_connected, 'provider', v_provider);
end;
$$;

revoke execute on function public.get_active_mail_sender() from public, anon;
grant execute on function public.get_active_mail_sender() to authenticated;

-- Setting the active provider now requires a real connected provider row — 'gmail' is no longer
-- accepted, and passing null clears the active sender (used when a provider is disconnected).
create or replace function public.set_active_mail_provider(p_provider text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  if p_provider is not null then
    if p_provider not in ('resend', 'sendgrid', 'mailgun', 'smtp') then
      raise exception 'Unknown mail provider: %', p_provider;
    end if;
    if not exists (
      select 1 from public.mail_provider_connections
      where user_id = auth.uid() and provider = p_provider
    ) then
      raise exception 'Connect % before making it the active sender', p_provider;
    end if;
  end if;

  update public.profiles set active_mail_provider = p_provider, updated_at = now()
  where id = auth.uid();
end;
$$;

revoke execute on function public.set_active_mail_provider(text) from public, anon;
grant execute on function public.set_active_mail_provider(text) to authenticated;
