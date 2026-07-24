# ClickBank Studio

Multi-tenant ClickBank affiliate SaaS. The Next.js app (deployed on Vercel) is the visual
dashboard; **Supabase (Postgres + Auth) is the database**, with every tenant-owned table scoped
by Row Level Security to `auth.uid() = user_id`. **`lib/engine/*` is the research/generation
engine** — an automated Anthropic-API-based worker that drains the `jobs` queue across all
tenants (via a service-role key that bypasses RLS), triggered automatically the instant a job is
queued (no human runs anything). The Google Drive `clickbank-engine/` folder is a legacy cloud
mirror from the pre-multi-tenant version — optional now, not required.

Clients pay a one-time access fee (Stripe) to unlock the dashboard, then buy **credits** (1
credit ≈ $1) that authorize the platform to launch ads on the client's *own* connected Meta ad
account — Meta bills the client directly; the platform never holds ad-spend money. See
`/Users/macbookpro/.claude/plans/binary-stirring-brooks.md` for the full phased roadmap.

## The automated engine

Jobs (`discover_products`, `build_campaign`) process automatically, near-instantly, with no
human trigger — see the "Automated Job Processing" section of the plan doc above for the full
design rationale. Mechanics:

- **Trigger**: a Postgres trigger on `jobs` (`on_job_inserted`, via the `pg_net` extension) POSTs
  to `app/api/engine/run` the instant a row is inserted. A `pg_cron` job (`engine-drain-backstop`,
  every minute, Postgres-side — not gated by any Vercel plan's cron-frequency limit) calls the
  same endpoint as a backstop, driving forward multi-stage jobs and reclaiming anything that died
  mid-stage. Both configured in `supabase/migrations/0003_engine_automation.sql`.
- **Auth**: the route checks an `x-engine-secret` header against `ENGINE_WEBHOOK_SECRET` — the
  matching value lives in Supabase Vault (`engine_webhook_url`/`engine_webhook_secret`, set via
  `execute_sql`, never committed to git) and is read by the trigger/cron SQL at call time.
- **Processing**: `lib/engine/worker.ts` claims one actionable job via the `claim_job()` RPC
  (`SECURITY DEFINER`, `FOR UPDATE SKIP LOCKED`, `service_role`-only) and runs stages in a loop
  bounded to ~50s per invocation (`maxDuration = 60` on the route, safe on any Vercel plan).
  `discover_products` is one stage (`lib/engine/discover.ts`); `build_campaign` is six —
  `context → image → ads → pages → content → social` (`lib/engine/build.ts`,
  `BUILD_CAMPAIGN_STAGES`) — each persisting its output immediately via `jobs.stage`/`stage_data`
  so nothing finished is ever lost or redone. A job that fails is retried up to 5 times
  (`jobs.attempts`) before being marked terminally `error`.
- **Marketplace/sales-page fetches** (`lib/engine/clickbank.ts`, `lib/engine/salespage.ts`) are
  plain server-side `fetch()` calls with a realistic browser `User-Agent` — validated live: no
  headless browser or Claude Code browser tooling is needed, ClickBank's gate is a WAF/CDN rule
  keyed on UA, not a session/CORS requirement.
- **Content generation** (`lib/engine/anthropic.ts`, `COMPLIANCE_SYSTEM`) calls the Anthropic
  Messages API directly (`claude-sonnet-5`) with the content rules below as a cached system
  prompt, using forced tool-use for structured JSON output (`completeJSON()`).
- `scripts/engine.ts` (the old `/run-engine` CLI) still exists as a **manual/debug fallback** —
  useful for inspecting a job's context or manually driving/failing something stuck — but it is
  no longer the primary path.

## Database

Supabase Postgres, schema in `supabase/migrations/0001_init.sql` + `0002_trial.sql` +
`0003_engine_automation.sql`. Tables: `profiles` (one per user — `nickname`, `access_granted`,
`trial_ends_at`), `products` (one row per marketplace offer, unique per `(user_id, vendor_id)`;
statuses New → Selected → Promoting → Paused/Dead), `campaigns` (one per product; kit assets as
text/jsonb columns), `jobs` (`pending → running → done/error`, plus `stage`/`stage_data`/
`locked_at`/`attempts` for the automated worker), `credits_ledger` (append-only; balance =
`SUM(delta)` per user), `payments` (Stripe audit trail + webhook idempotency). Every tenant table
has RLS scoped to `auth.uid() = user_id`.

`lib/engine/core.ts` holds the shared `upsertProduct`/`upsertCampaign`/`jobContext` logic used by
**both** the automated worker and the manual CLI, so the two paths can never diverge:

```bash
npm run engine -- pending [--user <uuid>]                  # pending jobs + context; all tenants, or one with --user
npm run engine -- claim <jobId>                            # mark running (UI shows progress)
npm run engine -- add-product --user <uuid> --meta p.json  # upsert one discovered product for a tenant
npm run engine -- save-campaign <productId> --meta c.json  # save kit assets (tenant inferred from the product row)
npm run engine -- complete <jobId> [--meta meta.json]      # build_campaign: marks kit ready + product Promoting
npm run engine -- fail <jobId> --message "why"
npm run import-csv -- <clickbank-products.csv> --user <uuid>  # sync rows from a legacy Drive master CSV
```

`add-product` dedupes on `(user_id, vendor_id)` (fresh marketplace stats overwrite; other fields
only fill gaps). `save-campaign` can be called repeatedly as assets finish — partial progress
must never be lost. Read-only Supabase queries (via the `mcp__supabase__execute_sql` tool or
`list_tables`) are fine for inspection; `net._http_response` shows past webhook/cron deliveries.

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
5. Marketplace data changes daily — on discovery, always pull fresh numbers (`lib/engine/clickbank.ts`
   hits `https://accounts.clickbank.com/graphql` live on every run). Never reuse stale rows as
   "current stats". Discovery jobs are queued from the dashboard's category/subcategory dropdown
   (`lib/categories.ts` — ClickBank's live taxonomy, 21 categories) or, as a fallback, a
   free-text keyword.
6. Paid ads never direct-link the raw hoplink; the presell page (or bridge page, see below) is
   the ad destination.
7. Never leave a job stuck in `running` — the worker's retry/attempts-cap and `claim_job()`
   staleness reclaim handle this automatically now; a manual `npm run engine -- fail` is only
   for hand-intervening on something the automated retries can't resolve.
8. **Bridge page (`bridge_html`)** is a second, optional landing-page variant alongside
   `presell_html`: a two-step lead-capture flow (hook + name/email form → reveal step with the
   `tid=page` hoplink CTA) instead of a straight advertorial-to-hoplink page. There is currently
   **no wired lead-storage backend** — the form's submit handler is a clearly marked placeholder
   (`<!-- LEAD_CAPTURE_ENDPOINT -->`, rendered by `renderBridgeHtml()` in `lib/engine/build.ts`)
   that only advances the UI locally. Never remove or soften that placeholder marker, and never
   fabricate a working backend; the user wires up real storage (their own API, ESP, or ClickBank
   Studio's own DB) before running paid traffic to it.
9. `presell_html` and `bridge_html` carry a real product image, base64-embedded inline (never
   hotlinked) so the page stays self-contained — `lib/engine/images.ts` has the LLM pick a
   neutral product shot (bottle/box/cover/screenshot, never people/testimonial photos) from the
   sales page's actual `<img>`/`og:image` candidates, then fetches and base64-encodes it
   (capped ~200KB). If nothing clean is available, the page stays text-only rather than
   fabricating a product image.

## Billing (Stripe) and access control

- One-time access fee and credit top-ups are both Stripe Checkout Sessions created ad-hoc
  (`price_data`, no pre-created Stripe Products needed) — see `lib/pricing.ts` for amounts.
- The **only** place that grants `access_granted` or writes `credits_ledger` is the Stripe
  webhook (`app/api/billing/webhook/route.ts`), which verifies the Stripe signature and uses the
  service-role client. Never grant access or add credits from anywhere else, including the
  engine CLI.
- Access = `access_granted OR trial_ends_at > now()` — see `hasAppAccess()` in `lib/shared.ts`,
  used by both the paywall gate and the billing page.
- `app/(app)/layout.tsx` is the paywall: redirects to `/billing` if `hasAppAccess()` is false.
  `middleware.ts` redirects to `/login` if there's no session at all.
- **30-day free trial**: `profiles.trial_ends_at`, set once via the `start_trial()` Postgres RPC
  (`supabase/migrations/0002_trial.sql`) — `SECURITY DEFINER`, callable only by `authenticated`,
  self-limiting (no-ops if `access_granted` is already true or a trial was already started, so
  it can't be replayed). Client calls it via `supabase.rpc("start_trial")` in
  `StartTrialButton` (`components/BillingActions.tsx`). **There is deliberately no RLS policy
  letting users `UPDATE` their own `profiles` row directly** — an earlier broad policy allowed
  self-granting `access_granted` via a raw PATCH to `/rest/v1/profiles`, which this migration
  closed. Do not re-add a general profiles update policy; add narrowly-scoped RPCs instead.
- **Usage/cost audit trail**: every Anthropic call the worker makes writes a row to
  `usage_ledger` (`supabase/migrations/0005_usage_ledger.sql`) with exact token counts and a
  computed dollar cost (`recordUsage()` in `lib/engine/anthropic.ts`, using the introductory
  Sonnet 5 per-MTok rates — revisit `PRICE_PER_MTOK_USD` after 2026-08-31). Logged even on a
  refused/malformed response, since tokens were genuinely spent either way. RLS lets a client
  read only their own rows (`app/billing/page.tsx` renders it via `components/UsageLedger.tsx`);
  only the service-role worker writes here, same trust boundary as `credits_ledger`/`payments`.

## Meta (Facebook) connections and posting

Phase B — OAuth + real posting to a client's own Page, no ad spend involved (that's Phase C,
separate/later). Schema in `supabase/migrations/0006_meta_connections.sql` +
`0007_meta_secret_helper.sql`; client code in `lib/meta/*`, routes under `app/api/meta/*`.

- **Tokens are never stored as plaintext columns.** `meta_connections.user_token_secret_id` /
  `meta_pages.page_token_secret_id` point into Supabase Vault (`vault.create_secret`, via the
  `store_meta_secret()` wrapper — `vault` isn't exposed to PostgREST directly). Retrieval is a
  single `service_role`-only RPC, `get_meta_secret(secret_id)`. This is the first per-row Vault
  use in this codebase (the engine's webhook secret is a static named secret) — reuse this exact
  pattern for any future per-tenant token (Phase C's ad-account tokens, TikTok in Phase D).
- **`meta_connections`/`meta_pages` have no RLS policy at all** (default-deny) plus an explicit
  `revoke all ... from anon, authenticated` at the GRANT layer — belt-and-suspenders beyond RLS,
  since these rows hold live bearer secrets, unlike `credits_ledger`/`payments`/`usage_ledger`
  which safely expose a plain owner-`select` policy. All reads go through narrow
  `SECURITY DEFINER` RPCs that return only sanitized fields: `get_meta_connection_status()`
  (status + page list, no tokens).
- **`assert_owns_meta_page(p_page_id)` must run before anything touches the admin client** in
  `app/api/meta/post/route.ts`. Facebook Page IDs are not secret — without this check, any
  authenticated user could pass another tenant's `page_id` and post to their Page using that
  tenant's stored token. This is the same self-scoping pattern as `start_trial()`, applied to
  authorization instead of idempotency — never skip it when adding a new Meta-writing route.
- **OAuth CSRF**: `app/api/meta/connect/route.ts` sets a random `state` in an httpOnly,
  `SameSite=Lax` cookie (must be `Lax`, not `Strict` — Meta's redirect back is a top-level
  cross-site GET) before redirecting to Meta; `app/api/meta/callback/route.ts` verifies it matches
  and always clears the cookie (single-use), regardless of outcome. The writing `user_id` always
  comes from the live session at write time, never from `state`.
- **Reconnect, not silent refresh**: Meta doesn't reliably support silent refresh for these token
  types. A connection/page flips to `needs_reconnect` two ways — `token_expires_at` read as
  stale, or (more common in practice) a Graph API call failing with an OAuth error code (190, or
  permission subcodes — `isTokenError()` in `lib/meta/client.ts`) — checked reactively in
  `app/api/meta/post/route.ts`, and proactively via `app/api/meta/deauthorize/route.ts`, which
  Meta calls directly (registered as the app's Deauthorize Callback URL) when a user revokes
  access from their own Facebook settings — verifies Meta's `signed_request` HMAC before writing,
  same fail-closed shape as the Stripe webhook.
- **Idempotency**: `meta_posts` has a `unique (user_id, idempotency_key)` constraint; the client
  generates one key per compose session (`components/PostToFacebook.tsx`) and only rotates it
  after a successful publish, so a retry of a failed/in-flight request can't double-post.
- **Env vars**: `FB_CLIENT_ID`/`FB_CLIENT_SECRET` (developers.facebook.com → App Dashboard).
  Register `${NEXT_PUBLIC_APP_URL}/api/meta/callback` as a valid OAuth Redirect URI and
  `${NEXT_PUBLIC_APP_URL}/api/meta/deauthorize` as the Deauthorize Callback URL in the Meta App
  Dashboard. Apps in Meta's **Development Mode** work immediately for Admins/Developers/Testers
  on the app with no App Review needed — sufficient for testing before deciding whether/when to
  submit `pages_show_list`/`pages_manage_posts`/`pages_read_engagement` for public App Review
  (separate from the already-approved `ads_management`).

## Dev

```bash
npm run dev        # app on http://localhost:3400
cp .env.local.example .env.local   # fill in Supabase + Stripe + Anthropic + Meta keys first
```

No ClickBank API key needed (see "The automated engine" above). Supabase, Stripe, and
`ANTHROPIC_API_KEY` are required for the app to fully function (auth, data, billing, job
processing). For local Stripe webhook testing:
`stripe listen --forward-to localhost:3400/api/billing/webhook`.

**Manually triggering the job worker during dev** (replaces the old `/run-engine` habit) —
`pg_net`/`pg_cron` need a public HTTPS URL, so the automatic trigger/backstop only reach a
deployed Vercel URL, not `localhost`. Locally, drive the same code path directly:

```bash
curl -X POST http://localhost:3400/api/engine/run -H "x-engine-secret: $ENGINE_WEBHOOK_SECRET"
```

Call repeatedly to step a `build_campaign` job through its stages one at a time.
