-- Stripe Checkout is a workspace-scoped financial boundary. The old webhook inserted its
-- idempotency row first, then granted access/credits in separate unchecked statements. Any crash
-- between those writes made every retry short-circuit forever. It also omitted workspace_id and
-- let the generic service-role stamp trigger choose an arbitrary owned membership.

-- Preserve the original checkout target even after that workspace is deleted. `workspace_id` is
-- the live FK used by tenant reads; `target_workspace_id` is an immutable billing snapshot.
alter table public.payments
  add column if not exists target_workspace_id uuid,
  add column if not exists credit_units integer,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists currency text,
  add column if not exists refund_reason text,
  add column if not exists refunded_at timestamptz,
  add column if not exists fulfillment_version text,
  add column if not exists fulfilled_at timestamptz;

update public.payments
set target_workspace_id = workspace_id
where target_workspace_id is null;

update public.payments
set credit_units = case amount_cents
  when 5000 then 50
  when 10000 then 100
  when 25000 then 250
  else null
end
where type = 'credits' and credit_units is null;

alter table public.payments
  drop constraint if exists payments_credit_units_check;
alter table public.payments
  add constraint payments_credit_units_check
  check (credit_units is null or credit_units > 0);

-- Completed-payment records are the durable idempotency marker. Cascading them with an operational
-- workspace makes a later Stripe replay look like a brand-new, unfulfilled payment. Keep the row
-- and null only its live tenant link.
drop trigger if exists stamp_workspace_id on public.payments;
alter table public.payments alter column workspace_id drop not null;
alter table public.payments drop constraint if exists payments_workspace_id_fkey;
alter table public.payments
  add constraint payments_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete set null;

create unique index if not exists payments_stripe_payment_intent_key
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- Link credit delivery directly to its payment instead of relying on a human-readable reason.
-- This makes fulfillment provably once-only inside the same transaction as the payment row.
alter table public.credits_ledger
  add column if not exists payment_id uuid references public.payments(id) on delete restrict;

-- Recover the link for historical Stripe top-ups where the old webhook did finish both writes.
-- Choose one row defensively if an operator ever created duplicate legacy reasons.
update public.credits_ledger ledger
set payment_id = payment.id
from public.payments payment
where payment.type = 'credits'
  and ledger.id = (
    select candidate.id
    from public.credits_ledger candidate
    where candidate.reason = 'stripe:' || payment.stripe_session_id
      and candidate.delta > 0
    order by candidate.created_at, candidate.id
    limit 1
  )
  and ledger.payment_id is null;

create unique index if not exists credits_ledger_one_delivery_per_payment
  on public.credits_ledger (payment_id)
  where payment_id is not null;

-- Mark historical rows only where the old side effect is observable. The remaining ambiguous
-- `completed` markers are reconciled transactionally on their next Stripe replay below.
update public.payments payment
set fulfillment_version = 'legacy-verified',
    fulfilled_at = coalesce(payment.fulfilled_at, payment.created_at)
where payment.status = 'completed'
  and payment.type = 'credits'
  and payment.fulfillment_version is null
  and exists (
    select 1 from public.credits_ledger ledger where ledger.payment_id = payment.id
  );

update public.payments payment
set fulfillment_version = 'legacy-observed',
    fulfilled_at = coalesce(payment.fulfilled_at, payment.created_at)
from public.profiles profile
where payment.status = 'completed'
  and payment.type = 'access'
  and payment.fulfillment_version is null
  and profile.id = payment.user_id
  and profile.access_granted;

-- The sole fulfillment boundary. The signed checkout metadata supplies the original workspace;
-- membership is deliberately NOT re-authorized here because a later transfer/removal must still
-- fund that exact UUID. Missing users/workspaces become refund_pending and never fall back to a
-- different membership. Payment + entitlement/credit either all commit or all roll back.
create or replace function public.fulfill_stripe_checkout(
  p_stripe_session_id text,
  p_stripe_payment_intent_id text,
  p_user_id uuid,
  p_workspace_id uuid,
  p_type text,
  p_amount_cents integer,
  p_currency text,
  p_credit_units integer default null,
  p_workspace_is_signed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.payments%rowtype;
  v_payment_id uuid;
  v_workspace_id uuid;
  v_profile_id uuid;
begin
  if coalesce(btrim(p_stripe_session_id), '') = '' then
    raise exception 'Stripe session is required';
  end if;
  if coalesce(btrim(p_stripe_payment_intent_id), '') = '' then
    raise exception 'Stripe payment intent is required';
  end if;
  if p_user_id is null then
    raise exception 'Checkout user is required';
  end if;
  if p_type not in ('access', 'credits') then
    raise exception 'Unsupported checkout type';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Checkout amount must be positive';
  end if;
  if lower(coalesce(p_currency, '')) <> 'usd' then
    raise exception 'Unsupported checkout currency';
  end if;
  if p_type = 'credits' and (p_credit_units is null or p_credit_units <= 0) then
    raise exception 'Credit quantity must be positive';
  end if;
  if p_type = 'access' and coalesce(p_credit_units, 0) <> 0 then
    raise exception 'Access checkout cannot deliver credits';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('stripe-checkout:' || p_stripe_session_id, 0)
  );

  select * into v_existing
  from public.payments
  where stripe_session_id = p_stripe_session_id
  for update;

  if found then
    if v_existing.user_id <> p_user_id
       or v_existing.type <> p_type
       or v_existing.amount_cents <> p_amount_cents
       -- A legacy replay can have no signed workspace metadata. The already-durable payment row
       -- is authoritative in that case; a supplied target must still match exactly.
       or (p_workspace_id is not null
           and v_existing.target_workspace_id is distinct from p_workspace_id)
       or (v_existing.credit_units is not null
           and v_existing.credit_units is distinct from p_credit_units)
       or (v_existing.stripe_payment_intent_id is not null
           and v_existing.stripe_payment_intent_id <> p_stripe_payment_intent_id)
       or (v_existing.currency is not null and lower(v_existing.currency) <> lower(p_currency)) then
      raise exception 'Stripe session metadata does not match its existing payment';
    end if;

    update public.payments
       set credit_units = coalesce(credit_units, p_credit_units),
           stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_stripe_payment_intent_id),
           currency = coalesce(currency, lower(p_currency))
     where id = v_existing.id;

    return jsonb_build_object(
      'payment_id', v_existing.id,
      'status', v_existing.status,
      'deduped', true
    );
  end if;

  -- KEY SHARE locks serialize fulfillment with workspace/account deletion without blocking normal
  -- edits. No membership predicate here: the target was authorized when Checkout was created.
  if p_workspace_id is not null then
    select id into v_workspace_id
    from public.workspaces
    where id = p_workspace_id
    for key share;
  end if;

  select id into v_profile_id
  from public.profiles
  where id = p_user_id
  for key share;

  if v_workspace_id is null or v_profile_id is null then
    insert into public.payments (
      user_id, workspace_id, target_workspace_id, stripe_session_id,
      stripe_payment_intent_id, type, amount_cents, credit_units, currency,
      status, refund_reason
    ) values (
      p_user_id, null, p_workspace_id, p_stripe_session_id,
      p_stripe_payment_intent_id, p_type, p_amount_cents, p_credit_units, lower(p_currency),
      'refund_pending',
      case
        when v_profile_id is null then 'checkout account no longer exists'
        when p_workspace_id is null then 'checkout has no unambiguous workspace target'
        else 'checkout workspace no longer exists'
      end
    ) returning id into v_payment_id;

    return jsonb_build_object(
      'payment_id', v_payment_id,
      'status', 'refund_pending',
      'deduped', false
    );
  end if;

  insert into public.payments (
    user_id, workspace_id, target_workspace_id, stripe_session_id,
    stripe_payment_intent_id, type, amount_cents, credit_units, currency, status
  ) values (
    p_user_id, v_workspace_id, p_workspace_id, p_stripe_session_id,
    p_stripe_payment_intent_id, p_type, p_amount_cents, p_credit_units, lower(p_currency),
    'completed'
  ) returning id into v_payment_id;

  if p_type = 'access' then
    update public.profiles
       set access_granted = true, updated_at = now()
     where id = p_user_id;
    if not found then
      raise exception 'Checkout account disappeared during fulfillment';
    end if;
  else
    insert into public.credits_ledger (
      user_id, workspace_id, delta, reason, payment_id
    ) values (
      p_user_id, v_workspace_id, p_credit_units,
      'stripe:' || p_stripe_session_id, v_payment_id
    );
  end if;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'status', 'completed',
    'deduped', false
  );
end;
$$;

revoke execute on function public.fulfill_stripe_checkout(
  text, text, uuid, uuid, text, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.fulfill_stripe_checkout(
  text, text, uuid, uuid, text, integer, text, integer
) to service_role;

-- Stripe refunds happen outside Postgres. This idempotent second half lets a retry repeat Stripe's
-- idempotency-keyed call and then finish the durable state transition if the first process died.
create or replace function public.mark_stripe_checkout_refunded(
  p_stripe_session_id text,
  p_stripe_payment_intent_id text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_payment public.payments%rowtype;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('stripe-checkout:' || p_stripe_session_id, 0)
  );

  select * into v_payment
  from public.payments
  where stripe_session_id = p_stripe_session_id
  for update;

  if not found
     or v_payment.stripe_payment_intent_id <> p_stripe_payment_intent_id then
    raise exception 'Refund payment not found';
  end if;
  if v_payment.status = 'refunded' then
    return false;
  end if;
  if v_payment.status <> 'refund_pending' then
    raise exception 'Payment is not awaiting a refund';
  end if;

  update public.payments
     set status = 'refunded', refunded_at = now()
   where id = v_payment.id;
  return true;
end;
$$;

revoke execute on function public.mark_stripe_checkout_refunded(text, text)
  from public, anon, authenticated;
grant execute on function public.mark_stripe_checkout_refunded(text, text) to service_role;
