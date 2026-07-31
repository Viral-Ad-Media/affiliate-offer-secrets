-- In-app notifications.
--
-- Scoped to events a tenant would actually act on, deliberately NOT an activity firehose: the
-- Audit trail already lists every post/send, and Contacts already lists every lead. Notifying on
-- those would bury the things that need a human — a job that terminally failed, a kit that's
-- ready to promote, a domain that stopped resolving. High-volume events (each captured lead) are
-- intentionally excluded; revisit only with a grouping/digest design, not by adding the kind.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'job_failed', 'campaign_ready', 'referral_rewarded', 'domain_error', 'mail_sender_error'
  )),
  title text not null,
  body text,
  -- Where clicking the notification goes. An in-app path only, never an absolute URL: these
  -- render as real links, and allowing arbitrary hrefs would turn any future writer into an
  -- open-redirect / phishing vector. Enforced here rather than trusted per call site.
  href text check (href is null or href ~ '^/[A-Za-z0-9/_.:-]*$'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Serves both the badge count (unread) and the panel list (newest first) off one index.
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

-- Owner-select only, same shape as every audit-trail-ish table since 0006. Writes come from the
-- worker / server routes via the admin client, or from reward_referral() in-database — never from
-- a tenant's own browser session, so there is no client insert policy. Marking read is the one
-- thing a client legitimately does, and it goes through the narrow RPC below rather than a
-- general UPDATE policy (which would also let a client rewrite title/href/kind).
create policy "own notifications" on public.notifications
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.notifications from anon, authenticated;
grant all on public.notifications to service_role;

-- Mark read. NULL p_ids = "mark everything read" (the panel's Mark all read action); otherwise
-- just the listed ids. Always scoped to auth.uid(), so a forged id from another tenant matches
-- nothing rather than erroring — same silent-no-op shape as the other ownership-scoped RPCs.
-- Already-read rows are skipped so read_at keeps its original timestamp.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  update public.notifications
     set read_at = now()
   where user_id = auth.uid()
     and read_at is null
     and (p_ids is null or id = any(p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- Referral payouts notify in-database, since reward_referral() is where that event actually
-- happens (called by the Stripe webhook) and it already runs as service_role.
create or replace function public.reward_referral(p_referred_user_id uuid, p_points integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_referral public.referrals%rowtype;
begin
  update public.referrals
     set status = 'rewarded', reward_points = p_points, rewarded_at = now()
   where referred_user_id = p_referred_user_id
     and status = 'pending'
  returning * into v_referral;

  if v_referral.id is null then
    return false;
  end if;

  insert into public.rewards_ledger (user_id, delta, reason, referral_id)
  values (v_referral.referrer_user_id, p_points, 'referral: paid signup', v_referral.id);

  insert into public.notifications (user_id, kind, title, body, href)
  values (
    v_referral.referrer_user_id,
    'referral_rewarded',
    'You earned ' || p_points || ' reward points',
    'Someone you referred upgraded. Points are redeemable for ad credits.',
    '/rewards'
  );

  return true;
end;
$$;

revoke execute on function public.reward_referral(uuid, integer) from public, anon, authenticated;
grant execute on function public.reward_referral(uuid, integer) to service_role;
