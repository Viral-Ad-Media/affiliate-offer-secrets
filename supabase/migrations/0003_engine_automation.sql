-- Automated job processing: replaces the manual "human runs /run-engine" step with a
-- Postgres-triggered worker (instant on insert) plus a pg_cron backstop (drives forward
-- multi-stage jobs, reclaims anything that died mid-stage). See CLAUDE.md.

alter table public.jobs
  add column stage integer not null default 0,
  add column stage_data jsonb not null default '{}'::jsonb,
  add column locked_at timestamptz,
  add column attempts integer not null default 0;

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Atomic claim, safe against the webhook and cron backstop firing concurrently.
create or replace function public.claim_job(stale_after interval default '90 seconds')
returns public.jobs
language plpgsql
security definer set search_path = public
as $$
declare
  claimed public.jobs;
begin
  select * into claimed
  from public.jobs
  where (status = 'pending')
     or (status = 'running' and locked_at < now() - stale_after)
  order by created_at
  for update skip locked
  limit 1;

  if claimed.id is null then
    return null;
  end if;

  update public.jobs
  set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

revoke execute on function public.claim_job(interval) from public, anon, authenticated;
grant execute on function public.claim_job(interval) to service_role;

-- Fires the worker instantly on insert. The URL/secret are stored in Supabase Vault
-- (set once via execute_sql, never committed to a migration or git — see CLAUDE.md).
create or replace function public.notify_job_inserted()
returns trigger
language plpgsql
security definer set search_path = public, vault
as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'engine_webhook_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'engine_webhook_secret')
    ),
    body := jsonb_build_object('job_id', new.id, 'trigger', 'webhook')
  );
  return new;
end;
$$;

create trigger on_job_inserted
  after insert on public.jobs
  for each row when (new.status = 'pending')
  execute procedure public.notify_job_inserted();

-- Trigger execution doesn't need RPC grants — revoke direct callability via
-- /rest/v1/rpc/notify_job_inserted (same pattern as handle_new_user in 0001_init.sql).
revoke execute on function public.notify_job_inserted() from public, anon, authenticated;

-- Backstop, every minute, Postgres-side (not gated by any Vercel plan's cron-frequency limit).
select cron.schedule(
  'engine-drain-backstop',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'engine_webhook_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-engine-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'engine_webhook_secret')
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $$
);
