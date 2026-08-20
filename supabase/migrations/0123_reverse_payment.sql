-- Refund / chargeback reversal. The webhook already auto-refunds ORPHANED checkouts, but there was
-- no handling for an operator-issued refund (charge.refunded) or a customer dispute
-- (charge.dispute.created) — so money went back while the customer kept access and credits. This
-- function is the reversal, called from those two new webhook branches.
--
-- Policy (stated in the review, revisit if desired):
--   access purchase  -> revoke profiles.access_granted (trial, if still live, is untouched)
--   credits purchase -> claw back that pack's credits via a negative ledger entry; the balance may
--                       go negative, which is correct — they were refunded, so they owe those back.
-- Any refund is treated as a FULL reversal (partial refunds are not expected on these fixed-price
-- products). Idempotent on payments.refunded_at, so a duplicate/dispute-then-refund reverses once.
--
-- The claw-back entry cannot set payment_id (credits_ledger_one_delivery_per_payment makes it unique
-- per payment, already used by the original grant), so it references the payment in `reason`.

create or replace function public.reverse_stripe_payment(p_payment_intent_id text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pay public.payments;
  v_clawed integer := 0;
begin
  -- Newest matching, not-yet-reversed payment for this intent. NULL id => unknown or already done.
  select * into v_pay
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
    and refunded_at is null
    and status in ('completed', 'pending')
  order by created_at desc
  limit 1;

  if v_pay.id is null then
    return jsonb_build_object('status', 'no_op');
  end if;

  if v_pay.type = 'access' then
    update public.profiles set access_granted = false where id = v_pay.user_id;
  elsif v_pay.type = 'credits' and coalesce(v_pay.credit_units, 0) > 0 and v_pay.workspace_id is not null then
    insert into public.credits_ledger (user_id, workspace_id, delta, reason)
    values (
      v_pay.user_id, v_pay.workspace_id, -v_pay.credit_units,
      left('refund/dispute claw-back (' || coalesce(p_reason, '') || ') pi=' || p_payment_intent_id, 200)
    );
    v_clawed := v_pay.credit_units;
  end if;

  update public.payments
    set refunded_at = now(),
        refund_reason = left(coalesce(p_reason, ''), 200),
        status = 'refunded'
    where id = v_pay.id;

  return jsonb_build_object(
    'status', 'reversed',
    'type', v_pay.type,
    'user_id', v_pay.user_id,
    'workspace_id', v_pay.workspace_id,
    'credits_clawed', v_clawed
  );
end;
$$;

revoke execute on function public.reverse_stripe_payment(text, text) from public, anon, authenticated;
grant execute on function public.reverse_stripe_payment(text, text) to service_role;
