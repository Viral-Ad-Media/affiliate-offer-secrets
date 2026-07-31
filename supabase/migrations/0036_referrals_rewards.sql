-- Referrals + Rewards.
--
-- A tenant shares a referral link (/r/{code}); a new account that signs up through it is
-- attributed to them, and once that account actually PAYS the access fee the referrer earns
-- reward points. Points redeem 1:1 into the existing credits_ledger, so this feature adds a new
-- earning path without inventing a second spendable currency.
--
-- Trust model: a referral code is public by design (it lives in a shareable URL), so these are
-- NOT Vault-pattern tables. But every write is either an ownership-checked RPC (authenticated)
-- or service_role-only, because the anti-gaming invariants — one referrer per referred account
-- ever, no self-referral, reward paid exactly once — are only enforceable server-side. A plain
-- owner-writable policy (like network_connections has) would let a client insert its own
-- referral rows directly and mint points.

-- One code per user, minted on first visit to /referrals. Hex from gen_random_uuid, uppercased:
-- unguessable enough that codes can't be enumerated, but that is not what protects anything here
-- (a leaked code only lets someone credit the owner with a referral).
create table public.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz not null default now()
);

alter table public.referral_codes enable row level security;
create policy "own referral code" on public.referral_codes
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.referral_codes from anon, authenticated;
grant all on public.referral_codes to service_role;

-- One row per referred account. `referred_user_id unique` is the load-bearing anti-gaming
-- constraint: an account can be attributed to exactly one referrer, exactly once, forever — so
-- re-claiming under a different code later, or double-rewarding the same signup, is structurally
-- impossible rather than merely checked in app code.
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  reward_points integer not null default 0,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint referrals_no_self_referral check (referrer_user_id <> referred_user_id)
);
create index referrals_referrer_idx on public.referrals(referrer_user_id);

alter table public.referrals enable row level security;
-- Only the REFERRER reads their own rows. The referred user has no reason to see who claimed
-- them, and the table deliberately carries no email/name so the referrer never sees another
-- account's PII either — the /referrals UI shows signup date + status only.
create policy "own referrals" on public.referrals
  for select using (auth.uid() = referrer_user_id);
revoke insert, update, delete on public.referrals from anon, authenticated;
grant all on public.referrals to service_role;

-- Append-only points ledger. Balance = SUM(delta), exactly like credits_ledger.
create table public.rewards_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  referral_id uuid references public.referrals(id) on delete set null,
  created_at timestamptz not null default now()
);
create index rewards_ledger_user_idx on public.rewards_ledger(user_id);

alter table public.rewards_ledger enable row level security;
create policy "own rewards" on public.rewards_ledger
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.rewards_ledger from anon, authenticated;
grant all on public.rewards_ledger to service_role;

-- Mint-or-return this user's code. Idempotent; the retry loop handles the (vanishingly rare)
-- hex collision rather than surfacing a raw unique violation to the UI.
create or replace function public.get_or_create_referral_code()
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text;
  v_try integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select code into v_code from public.referral_codes where user_id = auth.uid();
  if v_code is not null then
    return v_code;
  end if;

  while v_try < 5 loop
    v_try := v_try + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.referral_codes (user_id, code) values (auth.uid(), v_code);
      return v_code;
    exception
      when unique_violation then
        -- Could be a code collision (retry) or a concurrent call for this same user (done).
        select code into v_code from public.referral_codes where user_id = auth.uid();
        if v_code is not null then
          return v_code;
        end if;
    end;
  end loop;

  raise exception 'Could not allocate a referral code';
end;
$$;

revoke execute on function public.get_or_create_referral_code() from public, anon;
grant execute on function public.get_or_create_referral_code() to authenticated;

-- Attribute the CALLER's own account to the owner of p_code. Returns a status string rather than
-- raising, because every rejection here is an ordinary outcome the UI silently absorbs (a
-- referral link clicked by an existing user, a self-referral, a stale cookie) — not an error
-- worth surfacing to someone who just signed up.
--
-- The 7-day window stops an established account from retroactively attributing itself to a
-- friend's code much later; new signups (the only case the feature is for) are always inside it.
create or replace function public.claim_referral(p_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_referrer uuid;
  v_created timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select user_id into v_referrer from public.referral_codes where code = upper(p_code);
  if v_referrer is null then
    return 'invalid_code';
  end if;
  if v_referrer = auth.uid() then
    return 'self_referral';
  end if;

  select created_at into v_created from public.profiles where id = auth.uid();
  if v_created is null or v_created < now() - interval '7 days' then
    return 'expired';
  end if;

  begin
    insert into public.referrals (referrer_user_id, referred_user_id, code)
    values (v_referrer, auth.uid(), upper(p_code));
  exception
    when unique_violation then
      return 'already_referred';
  end;

  return 'ok';
end;
$$;

revoke execute on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

-- Pay out a referral. service_role only — called from the Stripe webhook once the REFERRED
-- account's access-fee payment lands, which is what makes a referral worth paying for and what
-- makes it ungameable (signing up costs the referrer's friend real money).
--
-- Idempotent by construction: the `status = 'pending'` predicate means a replayed webhook
-- updates zero rows, and the ledger insert is guarded on that same update having happened.
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

  return true;
end;
$$;

revoke execute on function public.reward_referral(uuid, integer) from public, anon, authenticated;
grant execute on function public.reward_referral(uuid, integer) to service_role;

-- Convert reward points into spendable ad credits, 1:1.
--
-- Same advisory-lock-then-check-then-insert shape as reserve_ad_credits(): a plain
-- SELECT SUM -> IF -> INSERT is NOT safe against two concurrent calls under READ COMMITTED (both
-- read the same balance before either commits, both pass). The lock key is namespaced 'rewards:'
-- so it never contends with the 'credits:' lock reserve_ad_credits takes.
create or replace function public.redeem_rewards(p_points integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_points is null or p_points <= 0 then
    raise exception 'Redeem amount must be positive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rewards:' || auth.uid()::text, 0));

  select coalesce(sum(delta), 0) into v_balance
    from public.rewards_ledger where user_id = auth.uid();
  if v_balance < p_points then
    return false;
  end if;

  insert into public.rewards_ledger (user_id, delta, reason)
  values (auth.uid(), -p_points, 'redeemed for ad credits');

  insert into public.credits_ledger (user_id, delta, reason)
  values (auth.uid(), p_points, 'rewards redemption');

  return true;
end;
$$;

revoke execute on function public.redeem_rewards(integer) from public, anon;
grant execute on function public.redeem_rewards(integer) to authenticated;
