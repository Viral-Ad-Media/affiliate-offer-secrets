import type Stripe from "stripe";
import type { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { ACCESS_FEE_CENTS } from "@/lib/pricing";
import { notify } from "@/lib/notifications";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Converting a finished trial into paid access.
 *
 * The trial used to simply lapse — hasAppAccess() stopped returning true and the card captured at
 * signup was never used. This is the other half.
 *
 * Three things this deliberately does NOT do:
 *
 *  1. **It never charges early.** The attempt happens on or after `trial_ends_at`. Charging even a
 *     day sooner would make a "30-day trial" a 29-day one, which is the kind of detail that turns
 *     into a chargeback rather than a support ticket.
 *  2. **It never writes `access_granted`.** It creates a PaymentIntent and stops. Stripe's
 *     `payment_intent.succeeded` webhook calls `fulfill_trial_charge`, which grants access and
 *     writes the `payments` row in one transaction. So "the Stripe webhook is the only thing that
 *     grants access" still holds exactly as it did — this adds a second way to START a payment, not
 *     a second way to finish one.
 *  3. **It never revokes access.** It doesn't need to: `hasAppAccess()` is
 *     `access_granted OR trial_ends_at > now()`, so a trial that ends without a successful charge
 *     lapses on its own and `app/(app)/layout.tsx` redirects to /billing. A failed charge therefore
 *     needs no compensating write, which is what makes the dunning ladder below safe to retry.
 */

/** Days before `trial_ends_at` to warn that the card will be charged. */
export const TRIAL_WARNING_DAYS = 3;

/**
 * When to try again after a decline, in days from the previous attempt.
 *
 * Front-loaded then spaced: most declines are a temporary hold or an expired card, and the first
 * retry catches those. Access has already lapsed by the time any of these run, so the ladder is
 * about giving someone a real chance to fix a card — not about squeezing a payment out. Four
 * attempts across a week, then it stops and stays stopped.
 */
export const RETRY_SCHEDULE_DAYS = [1, 3, 5] as const;
export const MAX_CHARGE_ATTEMPTS = RETRY_SCHEDULE_DAYS.length + 1;

export type SweepResult = {
  warned: number;
  charged: number;
  failed: number;
  abandoned: number;
  skipped: { userId: string; reason: string }[];
};

type ProfileRow = {
  id: string;
  trial_ends_at: string | null;
  access_granted: boolean;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
};

function cardLabel(p: ProfileRow): string {
  if (!p.card_brand || !p.card_last4) return "your saved card";
  return `your ${p.card_brand} ending ${p.card_last4}`;
}

const PRICE = `$${(ACCESS_FEE_CENTS / 100).toFixed(2)}`;

/**
 * The payment method to charge.
 *
 * Prefers the id stored at signup, but falls back to whatever cards the Customer actually has —
 * because a card can be removed or replaced at Stripe without this app hearing about it, and the
 * stored id would then be a stale pointer that fails with a confusing error rather than a decline.
 * Returns null when there is genuinely nothing to charge, which is a skip, not a failure.
 */
async function resolvePaymentMethod(stripe: Stripe, profile: ProfileRow): Promise<string | null> {
  if (profile.stripe_payment_method_id) {
    try {
      const pm = await stripe.paymentMethods.retrieve(profile.stripe_payment_method_id);
      if (pm && !("deleted" in pm)) return pm.id;
    } catch {
      // Detached or unknown — fall through to the customer's real list rather than failing here.
    }
  }
  if (!profile.stripe_customer_id) return null;
  try {
    const list = await stripe.paymentMethods.list({
      customer: profile.stripe_customer_id,
      type: "card",
      limit: 1,
    });
    return list.data[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Schedule the next attempt, or give up. Never throws — the sweep must continue to the next user. */
async function recordFailure(
  admin: AdminClient,
  profile: ProfileRow,
  attempts: number,
  message: string
): Promise<"failed" | "abandoned"> {
  const nextDelay = RETRY_SCHEDULE_DAYS[attempts - 1];
  const giveUp = attempts >= MAX_CHARGE_ATTEMPTS || nextDelay === undefined;
  const nextAt = giveUp ? null : new Date(Date.now() + nextDelay * 86400_000).toISOString();

  await admin
    .from("trial_conversions")
    .update({
      status: giveUp ? "abandoned" : "pending",
      attempts,
      next_attempt_at: nextAt,
      last_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", profile.id);

  await notify(admin, profile.id, {
    kind: "billing_failed",
    title: giveUp ? "We couldn't charge your card" : "Payment failed — we'll try again",
    body: giveUp
      ? `${PRICE} on ${cardLabel(profile)} was declined. Update your payment method to restore access.`
      : `${PRICE} on ${cardLabel(profile)} was declined. We'll retry in ${nextDelay} day${
          nextDelay === 1 ? "" : "s"
        } — update your card to fix it sooner.`,
    href: "/settings/billing",
  });

  return giveUp ? "abandoned" : "failed";
}

/**
 * One pass: warn trials ending soon, then charge the ones that have ended.
 *
 * Everything is per-user and best-effort. One person's dead Stripe customer must never stop the
 * sweep reaching the next person's perfectly chargeable card, so every failure is caught, recorded
 * and counted rather than thrown.
 */
export async function runTrialConversionSweep(admin: AdminClient): Promise<SweepResult> {
  const stripe = getStripe();
  const now = Date.now();
  const result: SweepResult = { warned: 0, charged: 0, failed: 0, abandoned: 0, skipped: [] };

  const SELECT =
    "id, trial_ends_at, access_granted, stripe_customer_id, stripe_payment_method_id, card_brand, card_last4";

  // ---- 1. Warn ------------------------------------------------------------------------------
  // Everyone whose trial ends within the window and who hasn't already been told. Sent once,
  // guarded by notified_ending_at rather than by "did we already run today" — a sweep that runs
  // twice must not mail twice.
  const warnBefore = new Date(now + TRIAL_WARNING_DAYS * 86400_000).toISOString();
  const { data: ending } = await admin
    .from("profiles")
    .select(SELECT)
    .eq("access_granted", false)
    .not("trial_ends_at", "is", null)
    .gt("trial_ends_at", new Date(now).toISOString())
    .lte("trial_ends_at", warnBefore);

  for (const profile of (ending ?? []) as ProfileRow[]) {
    const { data: existing } = await admin
      .from("trial_conversions")
      .select("notified_ending_at")
      .eq("user_id", profile.id)
      .maybeSingle();
    if (existing?.notified_ending_at) continue;

    const hasCard = !!profile.stripe_customer_id;
    await notify(admin, profile.id, {
      kind: "trial_ending",
      title: "Your trial ends soon",
      // Different message when there is no card, because the outcome is different: one is "you'll
      // be charged", the other is "you'll lose access". Saying "we'll charge your card" to someone
      // who never saved one is how a person finds out they're locked out by being locked out.
      body: hasCard
        ? `We'll charge ${PRICE} to ${cardLabel(profile)} when it ends, and your access continues.`
        : `Add a payment method to keep your access — ${PRICE}, one time.`,
      href: "/settings/billing",
    });

    // Deliberately does NOT seed next_attempt_at from trial_ends_at. That coupling was a real bug
    // caught in testing: the warning wrote the trial's end date, and if the trial then moved (a
    // superadmin extending it, say) the charge loop sat waiting on a date that no longer meant
    // anything. next_attempt_at is a RETRY gate and nothing else — see the charge loop.
    await admin.from("trial_conversions").upsert(
      {
        user_id: profile.id,
        notified_ending_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    result.warned++;
  }

  // ---- 2. Charge ----------------------------------------------------------------------------
  const { data: expired } = await admin
    .from("profiles")
    .select(SELECT)
    .eq("access_granted", false)
    .not("trial_ends_at", "is", null)
    .lte("trial_ends_at", new Date(now).toISOString());

  for (const profile of (expired ?? []) as ProfileRow[]) {
    const { data: row } = await admin
      .from("trial_conversions")
      .select("status, attempts, next_attempt_at")
      .eq("user_id", profile.id)
      .maybeSingle();

    if (row?.status === "succeeded" || row?.status === "abandoned") continue;

    const priorAttempts = row?.attempts ?? 0;
    // `next_attempt_at` gates RETRIES only. Before the first attempt the gate is the profile query
    // above (`trial_ends_at <= now`), which is the honest one — a charge may not happen before the
    // trial is genuinely over, and that condition can't go stale the way a copied date can. Once an
    // attempt has been made, this is what stops an hourly sweep charging hourly.
    if (priorAttempts > 0 && row?.next_attempt_at && new Date(row.next_attempt_at).getTime() > now) {
      continue;
    }

    const attempts = priorAttempts + 1;

    // Claim the attempt BEFORE talking to Stripe. Two overlapping sweeps would otherwise both read
    // attempts=0 and both charge — and unlike a job, a duplicate here takes real money. The
    // conditional update is the claim: zero rows affected means someone else already has it.
    const claim = await admin
      .from("trial_conversions")
      .upsert(
        {
          user_id: profile.id,
          status: "pending",
          attempts,
          next_attempt_at: new Date(now + 3600_000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select("user_id");
    if (claim.error || !claim.data?.length) {
      result.skipped.push({ userId: profile.id, reason: "could not claim the attempt" });
      continue;
    }

    const paymentMethod = await resolvePaymentMethod(stripe, profile);
    if (!profile.stripe_customer_id || !paymentMethod) {
      // No card is not a failure to retry — nothing will change without the person acting. Recorded
      // as abandoned so the sweep stops looking at them, and the billing page still offers checkout.
      await admin
        .from("trial_conversions")
        .update({
          status: "abandoned",
          next_attempt_at: null,
          last_error: "no saved payment method",
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", profile.id);
      await notify(admin, profile.id, {
        kind: "billing_failed",
        title: "Your trial has ended",
        body: `Add a payment method to restore access — ${PRICE}, one time.`,
        href: "/settings/billing",
      });
      result.abandoned++;
      continue;
    }

    try {
      const intent = await stripe.paymentIntents.create(
        {
          amount: ACCESS_FEE_CENTS,
          currency: "usd",
          customer: profile.stripe_customer_id,
          payment_method: paymentMethod,
          // off_session + confirm is what makes this a charge rather than a checkout. Stripe will
          // decline with `authentication_required` where the card needs 3DS, which the catch below
          // turns into the same dunning path as any other decline — the person is not at their
          // keyboard, so there is nothing to prompt.
          off_session: true,
          confirm: true,
          description: "Affiliate Offer Secrets — account access",
          metadata: { user_id: profile.id, type: "access", source: "trial-conversion" },
        },
        // Keyed on the user AND the attempt: a retried sweep re-uses the same key and Stripe returns
        // the SAME PaymentIntent instead of charging twice, while a genuine later attempt gets a new
        // one. This is the second layer under the claim above, and the one that actually holds.
        { idempotencyKey: `trial-conversion:${profile.id}:${attempts}` }
      );

      if (intent.status === "succeeded") {
        // Access is NOT granted here — payment_intent.succeeded does it, through the webhook. The
        // row is left `pending` until then on purpose: if the webhook never arrives, the sweep
        // retries and Stripe's idempotency returns this same intent, which the webhook path can
        // still fulfil. Marking it succeeded here would strand the person unfulfilled and silent.
        await admin
          .from("trial_conversions")
          .update({
            last_payment_intent_id: intent.id,
            last_error: null,
            next_attempt_at: new Date(now + 3600_000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", profile.id);
        result.charged++;
      } else {
        const outcome = await recordFailure(
          admin,
          profile,
          attempts,
          `payment intent status: ${intent.status}`
        );
        result[outcome === "abandoned" ? "abandoned" : "failed"]++;
      }
    } catch (err: any) {
      const message = err?.raw?.message ?? err?.message ?? "charge failed";
      const outcome = await recordFailure(admin, profile, attempts, message);
      result[outcome === "abandoned" ? "abandoned" : "failed"]++;
    }
  }

  return result;
}
