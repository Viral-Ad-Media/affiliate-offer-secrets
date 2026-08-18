-- Superadmin dashboard v2: money in, the trial pipeline, and a dunning retry.
--
-- The dashboard was built before billing existed. It showed credits and AI spend but nothing about
-- REVENUE, and 0104's trial_conversions is default-deny/service-role-only — so the dunning state
-- (who's about to be charged, whose card declined, who was given up on) was invisible to the one
-- person who acts on it. Same pattern as every admin function: SECURITY DEFINER, assert_superadmin
-- as the first statement, callable through the ordinary RLS-scoped client so no service-role key
-- is involved in rendering the page.

-- Money in. Paid rows only for totals; refunds counted separately rather than netted silently —
-- an operator reading "$194" wants to know if that's 2 sales or 3 sales and a refund.
create or replace function public.admin_revenue_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v jsonb;
begin
  perform public.assert_superadmin();

  select jsonb_build_object(
    'revenue_total_cents', coalesce((select sum(amount_cents) from public.payments where status = 'paid'), 0),
    'revenue_30d_cents',   coalesce((select sum(amount_cents) from public.payments
                                      where status = 'paid' and created_at > now() - interval '30 days'), 0),
    'payments_paid',       (select count(*) from public.payments where status = 'paid'),
    'payments_access',     (select count(*) from public.payments where status = 'paid' and type = 'access'),
    'payments_credits',    (select count(*) from public.payments where status = 'paid' and type = 'credits'),
    'payments_refunded',   (select count(*) from public.payments where refunded_at is not null),
    'last_payment_at',     (select max(created_at) from public.payments where status = 'paid'),
    -- Dunning at a glance: how many charges the sweep still owes, and how many it gave up on.
    'conversions_pending',   (select count(*) from public.trial_conversions where status = 'pending'),
    'conversions_abandoned', (select count(*) from public.trial_conversions where status = 'abandoned')
  ) into v;

  return v;
end;
$$;

revoke execute on function public.admin_revenue_summary() from public, anon;
grant execute on function public.admin_revenue_summary() to authenticated;

-- Everyone who hasn't paid yet, with their card and dunning state — the trial pipeline, oldest
-- deadline first, because the top row is the next charge the sweep will attempt.
create or replace function public.admin_trial_pipeline()
returns table (
  user_id uuid,
  email text,
  trial_ends_at timestamptz,
  has_card boolean,
  card_label text,
  conversion_status text,
  attempts integer,
  next_attempt_at timestamptz,
  last_error text,
  notified_ending_at timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  perform public.assert_superadmin();

  return query
  select
    p.id,
    u.email::text,
    p.trial_ends_at,
    (p.stripe_customer_id is not null),
    case when p.card_brand is not null then p.card_brand || ' ••' || p.card_last4 end,
    coalesce(tc.status, 'not_due'),
    coalesce(tc.attempts, 0),
    tc.next_attempt_at,
    tc.last_error,
    tc.notified_ending_at
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.trial_conversions tc on tc.user_id = p.id
  where not p.access_granted
  order by p.trial_ends_at asc nulls last;
end;
$$;

revoke execute on function public.admin_trial_pipeline() from public, anon;
grant execute on function public.admin_trial_pipeline() to authenticated;

-- Put a failed/abandoned trial charge back in front of the sweep.
--
-- The dunning ladder stops on purpose after MAX_CHARGE_ATTEMPTS, and 'abandoned' stays stopped —
-- but the common support arc is "my card was dead, it's fixed now, charge me". Without this the
-- only remedies were hand-editing trial_conversions in SQL or asking the person to go through
-- Checkout, which double-handles a card that is already on file.
--
-- Deliberately does NOT charge anything itself. It resets the dunning row to pending/due-now and
-- lets the sweep make the attempt — one code path creates PaymentIntents, and this stays true to
-- the same rule that keeps access grants in the webhook alone. Audited in the same transaction,
-- like every admin action.
create or replace function public.admin_retry_trial_charge(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_superadmin();

  if exists (select 1 from public.profiles where id = p_user_id and access_granted) then
    raise exception 'account already has access — nothing to charge';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'no such account';
  end if;

  insert into public.trial_conversions (user_id, status, attempts, next_attempt_at, last_error, updated_at)
  values (p_user_id, 'pending', 0, now(), null, now())
  on conflict (user_id) do update
    set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now();

  insert into public.admin_actions (actor_user_id, action, target_user_id, detail)
  values (auth.uid(), 'retry_trial_charge', p_user_id, jsonb_build_object('reason', p_reason));
end;
$$;

revoke execute on function public.admin_retry_trial_charge(uuid, text) from public, anon;
grant execute on function public.admin_retry_trial_charge(uuid, text) to authenticated;
