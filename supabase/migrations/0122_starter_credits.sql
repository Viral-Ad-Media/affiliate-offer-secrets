-- Starter credits for first-run. Before this, the access fee and the 30-day trial both granted
-- dashboard access but ZERO credits, so a new stranger's very first generative action (discovery =
-- 1 credit, a kit = 5) hit a paywall — they couldn't feel the product before paying. This grants a
-- small one-time balance at signup so the first kit + a couple of images are free.
--
-- 15 credits = discovery (1) + one full kit (5) + a few images (2 each), deliberately NOT a video
-- (10) — the free run covers the core experience without covering the expensive asset.
--
-- Granted inside handle_new_user, a SECURITY DEFINER trigger — a controlled, auditable, one-per-
-- signup grant, the same class of exception as admin_adjust_credits (0055) and referral rewards
-- (0036). It does NOT weaken the "only the Stripe webhook writes credits_ledger from APP code" rule:
-- there is still no client write path, and this runs server-side exactly once per new account.
--
-- Faithful reproduction of the 0075 function with one added insert; the rest is byte-identical so
-- the diff is auditable as exactly that.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_base text;
  v_slug text;
  v_n integer := 0;
  v_ws uuid;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_first text;
  v_last text;
  v_phone text;
begin
  v_first := left(nullif(btrim(coalesce(v_meta ->> 'first_name', '')), ''), 60);
  v_last  := left(nullif(btrim(coalesce(v_meta ->> 'last_name',  '')), ''), 60);
  v_phone := public.plausible_phone(v_meta ->> 'phone');

  insert into public.profiles (id, first_name, last_name, phone, trial_ends_at)
  values (new.id, v_first, v_last, v_phone, now() + interval '30 days');

  begin
    v_base := left(coalesce(nullif(public.slugify_workspace(split_part(new.email, '@', 1)), ''), 'workspace'), 32);
    v_slug := v_base;
    while exists (select 1 from public.workspaces where slug = v_slug)
       or exists (select 1 from public.reserved_workspace_slugs where slug = v_slug) loop
      v_n := v_n + 1;
      v_slug := v_base || '-' || v_n::text;
    end loop;

    insert into public.workspaces (name, slug)
    values (
      coalesce(
        nullif(btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')), ''),
        split_part(new.email, '@', 1)
      ) || '''s workspace',
      v_slug
    )
    returning id into v_ws;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (v_ws, new.id, 'owner');

    -- Starter credits (0122): one-time, workspace-scoped, so the first kit is free.
    insert into public.credits_ledger (user_id, workspace_id, delta, reason)
    values (new.id, v_ws, 15, 'starter_credits');
  exception when others then
    raise warning 'handle_new_user: could not create workspace for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$function$;
