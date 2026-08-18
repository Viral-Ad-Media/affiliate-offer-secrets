-- Charging the saved card when a 30-day trial ends.
--
-- Until now the trial simply LAPSED: hasAppAccess() stopped returning true, app/(app)/layout.tsx
-- redirected to /billing, and the card captured at signup was never used. Capture without charge is
-- the half of the flow that was built.
--
-- WHAT IS CHARGED: the one-time ACCESS FEE (lib/pricing.ts, $97), once. This product is not a
-- subscription — a client pays once to unlock the dashboard and then buys credits — so converting a
-- trial is a single charge, not the start of a recurring plan. Do not turn this into a subscription
-- without revisiting the whole pricing model.
--
-- WHEN: on the day the trial ENDS, never before. Charging early would quietly make a "30-day trial"
-- a 27-day one, which is the kind of thing a chargeback is written about. Access lapses on its own
-- between a failed charge and a successful retry, because hasAppAccess() already reads
-- trial_ends_at — there is no separate revocation to build, and nothing here writes access_granted
-- false.

-- The card to charge. The customer's default payment method is also set at save time, so this is a
-- fast path rather than the only source — see chargeTrialConversion, which falls back to listing
-- the customer's cards if this is null or has been detached at Stripe.
alter table public.profiles add column if not exists stripe_payment_method_id text;

comment on column public.profiles.stripe_payment_method_id is
  'Payment method saved at signup, charged when the trial ends. Display-safe id, never card data.';

-- Dunning state. A separate table rather than columns on `profiles`: profiles is the most
-- security-sensitive table in the schema (it holds access_granted and is_superadmin, and has no
-- client write path at all by design), and attempt counters are operational bookkeeping that will
-- be written on a schedule. Keeping them apart means the billing sweep never needs to touch it.
create table if not exists public.trial_conversions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'abandoned')),
  attempts integer not null default 0,
  -- When the next charge should be attempted. Null once the row reaches a terminal state.
  next_attempt_at timestamptz,
  last_error text,
  last_payment_intent_id text,
  -- Set when the "your trial ends soon" notice went out, so it is sent exactly once.
  notified_ending_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Default-deny, the credits_ledger/payments trust boundary: this describes money movement and is
-- written only by the service-role sweep. A client has no reason to read its own dunning counters —
-- the billing page shows the outcome, not the machinery.
alter table public.trial_conversions enable row level security;
revoke all on public.trial_conversions from anon, authenticated;

create index if not exists trial_conversions_due_idx
  on public.trial_conversions (next_attempt_at)
  where status = 'pending';

-- Grant access for a successful off-session trial charge.
--
-- Mirrors fulfill_stripe_checkout: the payments row and the entitlement commit TOGETHER, and a
-- replay observes the already-completed result rather than granting twice. This is the second (and
-- only other) place access_granted becomes true, and it is still reached ONLY from the Stripe
-- webhook — the sweep creates a PaymentIntent and nothing else, so "the webhook is the only thing
-- that grants access" continues to hold.
--
-- Idempotency key is the PaymentIntent id, stored in payments.stripe_session_id because that column
-- is the table's NOT NULL UNIQUE identity for "the Stripe object this payment is". Stripe ids are
-- self-describing (`pi_…` vs `cs_…`), so no prefix is needed to tell the two apart.
create or replace function public.fulfill_trial_charge(
  p_payment_intent_id text,
  p_user_id uuid,
  p_amount_cents integer,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.payments;
begin
  select * into v_existing from public.payments where stripe_session_id = p_payment_intent_id;
  if found then
    return jsonb_build_object('status', 'already_fulfilled', 'payment_id', v_existing.id);
  end if;

  insert into public.payments (
    user_id, stripe_session_id, stripe_payment_intent_id, type,
    amount_cents, currency, status, fulfillment_version, fulfilled_at
  )
  values (
    p_user_id, p_payment_intent_id, p_payment_intent_id, 'access',
    p_amount_cents, p_currency, 'paid', 'trial-conversion-v1', now()
  );

  update public.profiles set access_granted = true, updated_at = now() where id = p_user_id;

  update public.trial_conversions
     set status = 'succeeded',
         next_attempt_at = null,
         last_error = null,
         last_payment_intent_id = p_payment_intent_id,
         updated_at = now()
   where user_id = p_user_id;

  return jsonb_build_object('status', 'fulfilled');
end;
$$;

revoke all on function public.fulfill_trial_charge(text, uuid, integer, text) from public;
grant execute on function public.fulfill_trial_charge(text, uuid, integer, text) to service_role;

-- Two more notification kinds. The CHECK is an allowlist, so a new kind has to be added here or
-- notify() silently fails its insert — and notify() never throws, which would make it invisible.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'job_failed', 'campaign_ready', 'referral_rewarded', 'domain_error', 'mail_sender_error',
    'trial_ending', 'billing_failed', 'billing_succeeded'
  ));
