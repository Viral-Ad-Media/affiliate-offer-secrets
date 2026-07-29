-- Adds "redirect to a custom URL" as a third CTA action alongside "next step" and "hoplink",
-- available on every funnel step. Upsell steps get this independently for both Accept and
-- Decline (cta_action drives Accept — reusing the same column thank_you/order already use for
-- their single CTA — decline_action is new, upsell-only).

alter table public.funnel_steps
  add column redirect_url text,
  add column decline_action text not null default 'next_step' check (decline_action in ('next_step', 'hoplink', 'redirect_url')),
  add column decline_redirect_url text;

alter table public.funnel_steps drop constraint funnel_steps_cta_action_check;
alter table public.funnel_steps add constraint funnel_steps_cta_action_check
  check (cta_action in ('next_step', 'hoplink', 'redirect_url'));
