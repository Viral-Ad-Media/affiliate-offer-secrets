# ClickBank Studio

Multi-tenant ClickBank affiliate SaaS. The Next.js app (deployed on Vercel) is the visual
dashboard; **Supabase (Postgres + Auth) is the database**, with every tenant-owned table scoped
by Row Level Security to `auth.uid() = user_id`. **Claude Code is the research/generation
engine** — it drains the `jobs` queue (across all tenants, via a service-role key that bypasses
RLS) using the `anthropic-skills:clickbank-affiliate-engine` methodology. The Google Drive
`clickbank-engine/` folder (config.json + clickbank-products.csv + campaigns/) is a legacy cloud
mirror from the pre-multi-tenant version — optional now, not required.

Clients pay a one-time access fee (Stripe) to unlock the dashboard, then buy **credits** (1
credit ≈ $1) that authorize the platform to launch ads on the client's *own* connected Meta ad
account — Meta bills the client directly; the platform never holds ad-spend money. See
`/Users/macbookpro/.claude/plans/binary-stirring-brooks.md` for the full phased roadmap (Phase A
= this file's scope; Phase B/C add real Meta posting + ad-launch, not yet built).

## The skill

| Skill | Trigger | What it does |
|---|---|---|
| `/run-engine` | after a client queues a job in the app | drains pending `discover_products` / `build_campaign` jobs across all tenants — researches the ClickBank marketplace live, upserts product rows, generates full campaign kits (ads, TikTok scripts, landing copy, presell HTML, lead-capture bridge HTML, blog, emails), and writes everything back into Supabase |

## Database

Supabase Postgres, schema in `supabase/migrations/0001_init.sql`. Tables: `profiles` (one per
user — `nickname`, `access_granted`), `products` (one row per marketplace offer, unique per
`(user_id, vendor_id)`; statuses New → Selected → Promoting → Paused/Dead), `campaigns` (one per
product; kit assets as text/jsonb columns), `jobs` (pending → running → done/error),
`credits_ledger` (append-only; balance = `SUM(delta)` per user), `payments` (Stripe audit trail +
webhook idempotency). Every tenant table has RLS scoped to `auth.uid() = user_id`.

**Engine contract — always use the CLI, never hand-write SQL for queue mutations.** The engine
runs with the Supabase **service-role key** (`lib/supabase/admin.ts`), so it's the one process
trusted to cross tenant boundaries:

```bash
npm run engine -- pending [--user <uuid>]                  # pending jobs + context; all tenants, or one with --user
npm run engine -- claim <jobId>                            # mark running (UI shows progress)
npm run engine -- add-product --user <uuid> --meta p.json  # upsert one discovered product for a tenant
npm run engine -- save-campaign <productId> --meta c.json  # save kit assets (tenant inferred from the product row)
npm run engine -- complete <jobId> [--meta meta.json]      # build_campaign: marks kit ready + product Promoting
npm run engine -- fail <jobId> --message "why"
npm run import-csv -- <clickbank-products.csv> --user <uuid>  # sync rows from a legacy Drive master CSV
```

Meta goes via `--meta` JSON files (scratchpad) to avoid shell-escaping issues. `add-product`
dedupes on `(user_id, vendor_id)` (fresh marketplace stats overwrite; other fields only fill
gaps). `save-campaign` can be called repeatedly as assets finish — partial progress must never
be lost. All primary keys are UUIDs, so most commands infer the tenant from the job/product row
itself — only `pending` and `add-product` need an explicit `--user`. Read-only Supabase queries
(via the `mcp__supabase__execute_sql` tool or `list_tables`) are fine for inspection.

## Content rules (non-negotiable — real money runs against real ad-review systems)

1. Every claim in generated copy must be traceable to the product's own sales page. **Never
   invent** results, income figures, cure claims, testimonials, or marketplace stats.
2. Health/wealth niches are heavily policed on Meta/TikTok: prefer curiosity + mechanism angles
   over promise angles; no personal-attribute callouts; flag products whose own sales pages make
   claims that will get ads rejected (note it in `angle_notes`).
3. Presell pages and blog articles always include an affiliate disclosure.
4. Hoplinks: `https://hop.clickbank.net/?affiliate=NICKNAME&vendor=VENDORID&tid=<channel>` with
   per-channel tids (fb, tt, blog, email, page). Nickname comes from `settings` (key `nickname`)
   or Drive `clickbank-engine/config.json` — placeholder `YOURNICK` only if truly unknown, and
   clearly marked.
5. Marketplace data changes daily — on discovery, always pull fresh numbers (the GraphQL endpoint
   at `https://accounts.clickbank.com/graphql` works publicly; see the skill for the query shape).
   Never reuse stale rows as "current stats". Discovery jobs are queued from the dashboard's
   category/subcategory dropdown (`lib/categories.ts` — ClickBank's live taxonomy, 21 categories)
   or, as a fallback, a free-text keyword; see `/run-engine` for the exact payload shape.
6. Paid ads never direct-link the raw hoplink; the presell page (or bridge page, see below) is
   the ad destination.
7. Never leave a job stuck in `running` — complete it or fail it with a message.
8. **Bridge page (`bridge_html`)** is a second, optional landing-page variant alongside
   `presell_html`: a two-step lead-capture flow (hook + name/email form → reveal step with the
   `tid=page` hoplink CTA) instead of a straight advertorial-to-hoplink page. There is currently
   **no wired lead-storage backend** — the form's submit handler is a clearly marked placeholder
   (`<!-- LEAD_CAPTURE_ENDPOINT -->`) that only advances the UI locally. Never remove or soften
   that placeholder marker, and never fabricate a working backend; the user wires up real storage
   (their own API, ESP, or ClickBank Studio's own DB) before running paid traffic to it.
9. `presell_html` and `bridge_html` should carry a real product image, base64-embedded inline
   (never hotlinked) so the page stays self-contained. Source it from the vendor's own sales
   page — neutral product shots only (bottle/box/cover/screenshot), never people/testimonial
   photos. If nothing clean is available, leave the page text-only rather than fabricating a
   product image. See `/run-engine` for the exact fetch-and-embed steps.

## Billing (Stripe) and access control

- One-time access fee and credit top-ups are both Stripe Checkout Sessions created ad-hoc
  (`price_data`, no pre-created Stripe Products needed) — see `lib/pricing.ts` for amounts.
- The **only** place that grants `access_granted` or writes `credits_ledger` is the Stripe
  webhook (`app/api/billing/webhook/route.ts`), which verifies the Stripe signature and uses the
  service-role client. Never grant access or add credits from anywhere else, including the
  engine CLI.
- `app/(app)/layout.tsx` is the paywall: redirects to `/billing` if `access_granted` is false.
  `middleware.ts` redirects to `/login` if there's no session at all.

## Dev

```bash
npm run dev        # app on http://localhost:3400
cp .env.local.example .env.local   # fill in Supabase + Stripe keys first
```

Research (marketplace discovery, sales-page verification) happens through Claude Code's own
web/browser tools — no ClickBank API key needed. Supabase and Stripe keys ARE required for the
app itself to run (auth, data, billing). For local Stripe webhook testing:
`stripe listen --forward-to localhost:3400/api/billing/webhook`.
