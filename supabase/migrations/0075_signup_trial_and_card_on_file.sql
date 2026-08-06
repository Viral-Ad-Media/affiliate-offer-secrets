-- Applied 2026-08-06. Every signup gets the 30-day trial as a DATABASE fact, and profiles gains
-- the card-on-file echo columns. See CLAUDE.md "Two-step signup" for the full reasoning.
--
-- start_trial() still exists and is still correct, but it was only ever invoked by a button on the
-- billing page — so "everyone gets a trial" depended on someone finding and pressing it. Setting it
-- in handle_new_user means an abandoned signup, a crash between step 1 and step 2, or any future
-- signup path all land on the same answer. start_trial() becomes a no-op for new accounts (its
-- `trial_ends_at is null` guard stops matching); it stays for pre-existing rows that never started.
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists card_saved_at timestamptz;

comment on column public.profiles.stripe_customer_id is
  'Stripe Customer id. Written only by the billing webhook via the admin client.';
comment on column public.profiles.card_last4 is
  'Display-only last four digits echoed back by Stripe. Not a credential.';

-- handle_new_user() is recreated with the trial insert; body otherwise byte-identical, including
-- the three-key metadata allowlist that is the security model here. trial_ends_at is a literal
-- interval and is never read from raw_user_meta_data, so a hostile signup payload can't extend it.
-- (Full body applied via apply_migration; see the live function definition.)
