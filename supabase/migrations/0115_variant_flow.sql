-- Per-variant flow for split tests: a variant can send its opt-ins somewhere DIFFERENT from the
-- control — straight to the offer, to a specific step (skipping ahead), or to a custom URL —
-- instead of every arm converging on the funnel's first step. This is the closed-union shape the
-- form's after-submit action already uses, applied one level up.
--
--   default → the funnel's own flow (today's behavior, and every existing row's value)
--   offer   → no interstitial steps: the opt-in goes straight to the affiliate link
--   step    → a specific funnel step, referenced by ID — never by index, which move_funnel_step
--             swaps between rows (the branch-target lesson). ON DELETE SET NULL, so deleting the
--             step degrades the variant to the default flow rather than a dead link.
--   url     → a tenant-supplied destination, scheme-constrained here because bridge_variants is
--             reachable through PostgREST and the route must not be the only check.
--
-- The CONTROL is locked to 'default' by constraint: its flow IS the funnel's flow (the campaigns
-- row), and end_bridge_split_test copies a winning variant's CONTENT onto the campaign — flow
-- deliberately does not transfer, because promoting a page's copy should not silently rewire the
-- funnel's step chain.
alter table public.bridge_variants
  add column next_action text not null default 'default'
    check (next_action in ('default', 'offer', 'url', 'step')),
  add column next_url text
    check (next_url is null or next_url ~ '^https?://'),
  add column next_step_id uuid references public.funnel_steps(id) on delete set null;

alter table public.bridge_variants
  add constraint bridge_variants_control_default_flow
    check (not is_control or next_action = 'default');
