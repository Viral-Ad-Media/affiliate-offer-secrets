// Pricing constants — safe to import from client components (no server-only deps).
// Checkout Sessions are created with ad-hoc price_data, so no pre-created Stripe
// Products/Prices are required. Adjust freely.

export const ACCESS_FEE_CENTS = 9700; // one-time software access fee: $97
export const CREDIT_PACKS = [
  { credits: 50, cents: 5000, label: "$50 — 50 credits" },
  { credits: 100, cents: 10000, label: "$100 — 100 credits" },
  { credits: 250, cents: 25000, label: "$250 — 250 credits" },
] as const;
