# ClickBank Studio

Multi-tenant ClickBank affiliate SaaS. The Next.js app (deployed on Vercel) is the visual
dashboard; **Supabase (Postgres + Auth) is the database**, with every tenant-owned table scoped
by Row Level Security to `auth.uid() = user_id`. **`lib/engine/*` is the research/generation
engine** — an automated Anthropic-API-based worker that drains the `jobs` queue across all
tenants (via a service-role key that bypasses RLS), triggered automatically the instant a job is
queued (no human runs anything). The Google Drive `clickbank-engine/` folder is a legacy cloud
mirror from the pre-multi-tenant version — optional now, not required.

## Site structure

`/` is the public marketing site, not the app — `app/(marketing)/*` (route group, no URL
segment) covers Home, About, Pricing, FAQ, Contact, Terms, and Privacy, wrapped in
`app/(marketing)/layout.tsx` with `components/MarketingNav.tsx`/`MarketingFooter.tsx`. The
authenticated app lives at `/dashboard`, `/connections`, `/domains`, `/contacts`, `/audit`,
`/product/[id]`, `/billing` — `app/(app)/layout.tsx` is the paywall/auth gate (redirects to
`/login` with no session, `/billing` without access), renders `components/Sidebar.tsx` (left nav:
Overview/Campaigns/Funnels/Connections/Domains/Contacts/Broadcast/Audit trail/Billing, active-link
highlighting via `usePathname`; on desktop it's collapsible to an icon-only 64px rail — the choice
persists in `localStorage` under `sidebar_collapsed`, applied one paint after mount since reading
localStorage during SSR/hydration would mismatch; below the `sm` breakpoint it becomes a slim top
bar with a hamburger that opens a slide-in drawer carrying the full labeled nav), and owns the
`mx-auto max-w-7xl px-4 py-6` content wrapper for everything under it. One exception to that
wrapper: `/funnels/[campaignId]`'s page-editing views (opt-in/variant/step) render as a
`fixed inset-0 z-40` full-screen overlay above the app chrome — a focused editor with its own
sticky top bar ("← Funnel map" back button + a Dashboard link) instead of competing with the
sidebar; the funnel map view itself stays in normal chrome. `app/(app)/audit/page.tsx`
(+ `components/AuditTrail.tsx`) is a unified, read-only log across `meta_posts`/`instagram_posts`/
`tiktok_posts`/`youtube_posts`/`mail_sends` — every one of those tables already had owner-`select`
RLS but no UI ever read them before this; the page fetches all five in parallel, joins
`campaign_id` → `products.product_title` for display, and normalizes them into one
`AuditEntry[]` (`lib/shared.ts`) sorted newest-first. The page also renders `usage_ledger` via the
existing `components/UsageLedger.tsx` (moved here from the Billing page, not duplicated — the
Anthropic-call cost trail is itself a kind of activity log, and the user asked for it to live
alongside the other activity logs rather than as a separate structure on Billing). No new
tables/RPCs for the audit trail itself — purely a read surface over data other routes already
wrote. The root `app/layout.tsx` intentionally has
**no** content wrapper (just fonts + `<body>`) so
the marketing route group can render full-bleed sections (hero backgrounds, full-width
nav/footer) — `/login` and `/billing` are standalone pages outside both route groups and each
carry their own wrapper. `middleware.ts`'s `PUBLIC_EXACT_PATHS` (exact match: `/`, `/login`,
`/about`, `/pricing`, `/faq`, `/contact`, `/terms`, `/privacy`) and `PUBLIC_PREFIX_PATHS` (prefix
match: Stripe/engine/Meta webhooks, `/p/`) gate everything else behind auth — never add `/` as a
prefix entry, it would match every path and disable the gate entirely.

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

### Marketplace preload cache (instant discovery)

The products analogue of `lib/categories.ts`'s static category snapshot — kept in a table
(`marketplace_products`, `supabase/migrations/0029_marketplace_cache.sql`) rather than a
checked-in file because gravity/$-stats drift daily. Shared, NOT tenant data: no `user_id`,
authenticated-select RLS (public marketplace data), writes service_role-only.

- **Refresh**: `refreshMarketplaceCache()` (`lib/engine/marketplaceCache.ts`) sweeps every
  top-level category, top-100 by gravity, **paged in 50s — the GraphQL endpoint hard-caps every
  page at 50 rows regardless of `resultsPerPage` (measured live: 100/200/500 all return exactly
  50); deeper reads page via `offset`**. Strictly sequential with a 300ms gap — the WAF tolerates
  normal cadence but was observed (live) to temporarily block rapid bursts. Stale rows are pruned
  only after a fully clean sweep, so one flaky category can't mass-delete the catalog. Exposed at
  `POST /api/marketplace/refresh` (`x-engine-secret`, `maxDuration = 60`), run daily by pg_cron
  `marketplace-refresh-backstop` (04:15 UTC; `marketplace_refresh_url` Vault secret, registered
  via `execute_sql`, never committed — same convention as every other cron here).
- **Instant seeding**: `app/api/jobs/route.ts` (category mode), right after inserting the
  discovery job, reads `getCachedMarketplaceHits()` and upserts bare product rows for the caller
  **concurrently** (sequential was measured at ~1s/row) — products appear on the dashboard's next
  5s poll instead of waiting the full job round trip (measured: 12.7s sequential → 2.9s parallel
  locally, faster on Vercel). Best-effort try/catch — a cache miss or failure never blocks the
  queue, since the job re-upserts the same rows idempotently anyway.
- **Worker**: `runDiscoverProducts` (`lib/engine/discover.ts`) is cache-first, falling back to
  the live fetch on any miss. `getCachedMarketplaceHits()` returns null (miss) for: keyword mode
  (ClickBank's own relevance search isn't replicable with `ilike`), rows older than 30h, or fewer
  cached rows than requested (a big subCategory whose top-N falls outside its parent's top-100
  sweep window) — a miss is never a wrong answer, just the old latency.

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
3. The bridge (landing) page and blog articles always include an affiliate disclosure.
4. Hoplinks are built by `buildHoplink(network, affiliateId, vendorId, tid)`
   (`lib/engine/renderPages.ts`) with per-channel tids (fb, tt, blog, email, page) — ClickBank's
   format is `https://hop.clickbank.net/?affiliate=ID&vendor=VENDORID&tid=<channel>`, Digistore24's
   is `https://www.checkout-ds24.com/redir/VENDORID/ID/<channel>`. The affiliate ID comes from the
   caller's own self-service `network_connections` row (see "Multi-network affiliate connections"
   below) — there is no silent `"YOURNICK"`-style placeholder anymore; a missing connection is a
   clear 400 at the API route (or a thrown error in the worker as a defensive re-check), never a
   broken hoplink shipped to real ad traffic.
5. Marketplace data changes daily — on discovery, always pull fresh numbers (`lib/engine/clickbank.ts`
   hits `https://accounts.clickbank.com/graphql` live on every run). Never reuse stale rows as
   "current stats". Discovery jobs are queued from the dashboard's category/subcategory dropdown
   (`lib/categories.ts` — ClickBank's live taxonomy, 21 categories) or, as a fallback, a
   free-text keyword.
6. Paid ads never direct-link the raw hoplink; the bridge page (see rule 8) is the ad destination.
7. Never leave a job stuck in `running` — the worker's retry/attempts-cap and `claim_job()`
   staleness reclaim handle this automatically now; a manual `npm run engine -- fail` is only
   for hand-intervening on something the automated retries can't resolve.
8. **Bridge page (`bridge_html`)** is every campaign's single landing page: a two-step
   advertorial-then-lead-capture flow — step 1 is the full pitch (hook, mechanism, benefits,
   proof, FAQ) followed by an opt-in form, step 2 (shown after submit) is a short reveal with the
   `tid=page` hoplink CTA. There used to be a second, separate "presell" variant (the same
   advertorial with no lead capture, no form) — it was merged into this one so the advertorial
   content isn't split across two pages, only one of which collects a lead. `renderPresellHtml`/
   `campaigns.presell_html` no longer exist; old rows keep their `presell_html` value as an
   unread legacy column rather than a destructive migration (same precedent as
   `profiles.nickname`). It has a real, wired lead-storage backend — see "Lead capture (Contacts)"
   below — that posts to `/api/public/leads` and always advances to the reveal step regardless of
   save outcome. The form's `campaign_id`/`email`/`first_name` wiring and the disclosure/consent
   text are code-owned in `renderBridgeHtml()` (`lib/engine/renderPages.ts`) and are never exposed
   as editable fields in `components/PageEditor.tsx` — never let a future editor field touch them.
9. `bridge_html` carries a real product image, base64-embedded inline (never hotlinked) so the
   page stays self-contained — `lib/engine/images.ts` has the LLM pick a neutral product shot
   (bottle/box/cover/screenshot, never people/testimonial photos) from the sales page's actual
   `<img>`/`og:image` candidates, then fetches and base64-encodes it (capped ~200KB). If nothing
   clean is available, the page stays text-only rather than fabricating a product image.

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
  read only their own rows; it's rendered via `components/UsageLedger.tsx` on
  `app/(app)/audit/page.tsx` (moved there from the Billing page — see "Site structure" above),
  not Billing — only the service-role worker writes here, same trust boundary as
  `credits_ledger`/`payments`.

## Meta (Facebook) connections and posting

Phase B — OAuth + real posting to a client's own Page, no ad spend involved (real ad launches
are Phase C, documented separately below). Schema in `supabase/migrations/0006_meta_connections.sql`
+ `0007_meta_secret_helper.sql`; client code in `lib/meta/*`, routes under `app/api/meta/*`.

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

## Real ad campaign launches (Phase C)

Clients launch real Meta ad campaigns against their own ad account, gated by their credit
balance (1 credit ≈ $1 of authorized daily budget). Builds directly on Phase B's OAuth/token
infrastructure. Schema in `supabase/migrations/0008_ad_launches.sql`; stage handlers in
`lib/engine/adlaunch.ts` (same shape as `lib/engine/build.ts`); routes under `app/api/meta/ads/*`.
A design-review pass before writing any code found a real structural gap and a real race
condition — both fixed, not deferred, since this phase moves real money:

- **The worker re-verifies ownership, not just the API route.** `jobs`' own RLS policy
  (`for all using (auth.uid() = user_id)`) only validates the *row's* `user_id` — nothing stops
  an authenticated client from inserting a `launch_ad` job whose `payload` references another
  tenant's `campaign_id`/`page_id`/`ad_account_id` directly via `supabase-js`, bypassing
  `app/api/meta/ads/create/route.ts` entirely. Since the worker runs as `service_role` (bypasses
  RLS), it must re-check ownership itself — `lib/engine/adlaunch.ts`'s `verify` stage (always
  stage 0) is the actual security boundary; the route's own checks are a UX nicety for a fast
  error, not the enforcement. Never add a new job type that trusts `payload` without an
  equivalent re-check inside its own stage-0 handler.
- **No public URL existed for the bridge page before this phase** — it only ever rendered in an
  authenticated `<iframe srcDoc>`. A real ad's `link_url` needs one: `app/p/[campaignId]/bridge/
  route.ts` is a Route Handler (not a React page, so the root layout never wraps the
  self-contained HTML) using the admin client scoped to one campaign UUID + `status = 'ready'`
  (the UUID is unguessable — that's the access control, not RLS). A sibling `.../presell/route.ts`
  existed here too until the presell page variant was merged into the bridge page (content rule
  8) — removed outright, not left as a redirect, since nothing live ever pointed ad traffic at it
  (confirmed via a direct query before removing: zero `ad_launches`/`custom_domain_routes` rows
  referenced it).
- **Ad creative images are uploaded, never hotlinked.** `images_json.source_images[0]` is the raw
  vendor URL — the same reason CLAUDE.md's content rule 9 already bans hotlinking for the bridge
  page applies to an ad creative too. `uploadAdImage()` (`lib/meta/client.ts`) fetches real bytes
  via the existing `fetchImageAsDataUrl()` and uploads to `POST /act_{id}/adimages` for a stable
  `image_hash`. The same fix was retrofitted into Phase B's Page photo posting —
  `publishPhotoBytes()` replaced the old `url`-param `publishPhoto()`.
- **Credit reservation is atomic against concurrent activations, on purpose, in two independent
  ways.** A plain `select sum(delta) ... if ... insert` inside one `SECURITY DEFINER` function is
  NOT safe against two concurrent calls under Postgres's default `READ COMMITTED` isolation —
  both transactions can read the same starting balance before either commits. `reserve_ad_credits()`
  opens with `pg_advisory_xact_lock(hashtextextended('credits:' || auth.uid()::text, 0))`, which
  serializes concurrent calls for the same user (auto-releases at transaction end). That closes
  the *cross-launch* balance race; a **second, independent** guard in
  `app/api/meta/ads/activate/route.ts` — an optimistic `ad_launches` status transition
  (`paused_review → activating`, 0 rows affected = reject) run *before* `reserve_ad_credits` is
  ever called — closes the *same-launch* replay race (double-click/retry). Both are required;
  neither alone is sufficient.
- **OAuth scope grants are verified, not assumed.** Meta's consent dialog lets a user decline
  individual permissions — a successful token exchange never guarantees `ads_management` was
  actually granted. `app/api/meta/callback/route.ts` checks `/debug_token`'s `scopes` field and
  stores `meta_connections.ads_management_granted`; the "Launch Ad" UI
  (`components/LaunchAd.tsx`) gates on it proactively instead of discovering the gap via a 403
  deep inside a job stage.
- **Deduct at activate, not at create.** `POST /api/meta/ads/create` queues the `launch_ad` job
  and touches no credits — a client can build and compare a few paused drafts for free. Meta
  creates Campaign/Ad Set/Ad objects `PAUSED` by default (confirmed directly from Meta's own API
  behavior), which is what makes "paused until confirmed" free instead of something this app had
  to invent — the only new state is the explicit `POST /api/meta/ads/activate` step.
- **Partial-activation failure re-pauses what succeeded, then refunds — in that order.** If
  campaign-level activation succeeds but ad-set activation fails (Meta requires *every* level
  active to actually deliver, so no spend occurs either way), `activate/route.ts` explicitly
  re-issues `status=PAUSED` on whichever level(s) did go live *before* writing the compensating
  `refund_ad_credits()` entry — so the ledger and Meta's actual object state never disagree about
  whether anything is live. Per-level outcomes persist into `ad_launches.activation_state` as
  they happen, so a retry only re-attempts what didn't succeed.
- **Scoped, not full, Marketing API surface** (deliberate MVP choice, confirmed with the user):
  single objective (`OUTCOME_TRAFFIC` / `LINK_CLICKS`), campaign-level budget only (CBO — no
  ad-set-level budgets), broad country-only targeting (no interest IDs, which need a separate
  audience-research step), single image creative. Expandable later; not a structural limitation.
- **Deferred, explicitly, not blocking**: a soft cap on non-activated paused drafts and a TTL
  sweep for abandoned ones (an API-quota/ad-account-object-count concern, not a credit/security
  one — same call already made for engine usage caps while it's just the user testing solo); a
  `Content-Security-Policy` on the public `/p/` route as extra defense-in-depth.

## No-code page editor

`bridge_html` is no longer edit-only-by-regenerating. `renderBridgeHtml` (+ the `PageCopy` type,
`escapeHtml`, `buildHoplink`) lives in `lib/engine/renderPages.ts` — a pure, isomorphic function
with zero server-only imports, imported by **both** the campaign build pipeline
(`lib/engine/build.ts`'s `stagePages`, which now also persists the structured `page_copy jsonb`
alongside the rendered HTML) and the client-side editor (`components/PageEditor.tsx`), so live
preview and what actually gets published are always the literal same function call — never two
copies that can drift apart. (There used to be a second render function, `renderPresellHtml`, and
a second preview tab in the editor to match — removed when the presell page variant was merged
into the bridge page; see content rule 8.)

- **There is no separate "Landing copy" tab/field anymore.** `PageCopy.landing_md` and
  `campaigns.landing_md` (a standalone markdown rendering of the same headline/lead/mechanism/
  benefits/proof/FAQ/CTA fields, previously shown on its own read-only tab) were pure duplication
  once the bridge page itself became the single, fully editable landing page — every field that
  markdown doc carried already lives in `page_copy` and renders in `bridge_html`. Removed:
  `renderLandingMd()`, the `landing_md` field from `PageCopy`/`Campaign`, the LLM's obligation to
  produce it in `stagePages`' schema, and the `landing_md` write in both `stagePages` and the
  page-copy PATCH route. `campaigns.landing_md` is left as an unread legacy column on old rows
  rather than a destructive migration (same precedent as `profiles.nickname`/`presell_html`).

- **The editor is a locked-down WYSIWYG canvas, not a freeform block builder.** headline/lead/
  mechanism/benefits/proof/FAQ/CTA/image are editable directly on a rendered page surface that
  looks like the real thing; the affiliate disclosure, the hoplink, the lead-capture form, and the
  `LEAD_CAPTURE_ENDPOINT` wiring are rendered as plain static JSX alongside the editable content —
  structurally impossible to edit or delete (not just visually locked), since they're never wrapped
  in a `contentEditable` element at all. Scope was negotiated twice with the user before landing
  here: "Elementor/ClickFunnels style" was first scoped down via `AskUserQuestion` to
  **drag-to-reorder of the 5 fixed sections** (not a freeform canvas), then — after seeing that
  version — the user asked for it again and was offered a follow-up choice (freeform canvas /
  inline WYSIWYG / more block variety / keep drag-to-reorder); **"Inline WYSIWYG editing"** is what
  shipped: click text on the live-look page itself instead of a separate form panel + iframe
  preview, still only the same 5 reorderable sections, still no new block types or style panel.
  - **`components/WysiwygCanvas.tsx`** is the shared surface both `components/PageEditor.tsx`
    (opt-in page + `bridge_variants`) and `components/FunnelStepEditor.tsx` (funnel steps) render —
    same "two-component-mirror, shared-piece-for-the-fiddly-part" precedent as the deleted
    `SortableSection.tsx` before it (this rework replaced that component outright; its drag-handle/
    `useSortable` wiring now lives inside `WysiwygCanvas.tsx`'s own `Section`). Its typography/
    colors/spacing are hand-matched to the `<style>` block in `lib/engine/renderPages.ts` — if that
    template's CSS changes, update this file in the same commit or the editor stops looking like
    what actually publishes.
  - **`EditableText`'s "set once at mount, never again" pattern is the load-bearing fix for the
    classic React+contentEditable cursor-jump bug.** A ref callback sets `el.textContent = value`
    exactly once (fires only on mount, for a stable-keyed element) and the component never passes
    `children`/`dangerouslySetInnerHTML` again afterward — meaning React has nothing to reconcile
    inside that node on future re-renders, so committing one field (which re-renders the whole
    canvas) can never reset or move the cursor in a sibling field the user is still mid-typing in.
    `onBlur` is the only point that reads `textContent` back into React state (`setCopy` via the
    same `update(key, value)` used everywhere else in this codebase). Verified directly: focus
    field A, set uncommitted text, commit a *different* field B (forcing a full re-render), confirm
    field A's DOM text survived unchanged. Any future editable field added to this canvas must
    follow the same mount-once-then-blur-commit shape — a naive `value`+`onChange` controlled
    contentEditable will re-fight the DOM on every keystroke.
  - **Zero-migration, unchanged from the drag-to-reorder phase**: `sectionOrder?: SectionKey[]`
    (`SECTION_KEYS = ["lead", "mechanism", "benefits", "proof", "faq"] as const`,
    `lib/engine/renderPages.ts`) still lives *inside* the existing `page_copy` JSONB blob, still
    resolved defensively by `resolveSectionOrder()` both server-side (every PATCH route) and
    client-side. The embedded product image is still coupled inside the `lead` section (dragging
    "Lead paragraph" carries the image with it, default order stays byte-for-byte unchanged).
  - **`@dnd-kit/core`+`/sortable`+`/utilities`** wiring is unchanged in shape (`DndContext` +
    `SortableContext` + `useSortable` per section, `PointerSensor` with `activationConstraint:
    {distance: 4}`) — only *where* it lives moved, from the deleted `SortableSection.tsx` into
    `WysiwygCanvas.tsx`'s `Section`, now with a hover-revealed floating grip handle (top-right of
    each section) instead of an always-visible dark-panel header, matching the page-like visual.
  - **`app/api/*/page-copy` and `app/api/funnel-steps/[id]` routes are completely unchanged** — the
    save payload shape (`headline`/`lead`/`mechanism`/`benefits`/`proof`/`faq`/`cta`/
    `image_data_url`/`section_order`) is identical to the pre-WYSIWYG editor; only *how* the user
    populates `copy` state client-side changed, not what gets validated/persisted server-side.
  - **`previewHoplink` was removed** from `PageEditor`'s props (and its pass-through in
    `SplitTestPanel.tsx` and `app/(app)/funnels/[campaignId]/page.tsx`, along with the now-unused
    `hoplink` state/query field there) — it existed only to build a real link for the old separate
    `<iframe srcDoc>` preview, which no longer exists now that the canvas itself *is* the preview.
- **`campaigns`' RLS is select-only for `authenticated`** (tightened in
  `supabase/migrations/0009_page_domains.sql`, dropping the original Phase-A `for all` policy).
  This table's HTML fields are served completely raw to real, unauthenticated ad traffic
  (`servePublicCampaignPage`) — the only legitimate writer is `app/api/campaigns/[id]/page-copy/
  route.ts`, via `createAdminClient()`, after validating everything server-side. Never re-add a
  general client-write policy to this table; if a new legitimate client write is ever needed, add
  a narrow `SECURITY DEFINER` RPC instead (same fix already applied once for `profiles` in Phase
  A, and now again here — same table class, same shape).
- **`image_data_url` is validated with a single fully-anchored regex** (`^data:image\/(png|jpe?g
  |webp|gif);base64,[A-Za-z0-9+/]+=*$`) against a hard length cap *before* the regex ever runs
  (avoids ReDoS on a huge string) — the load-bearing defense, since the render templates
  interpolate this value into an unescaped-by-convention `src="..."` attribute (now also routed
  through `escapeHtml()` as defense-in-depth). Never loosen this to a `.startsWith(...)` check —
  that's exactly the gap a crafted value could use to break out of the attribute and stored-XSS
  real ad visitors.
- Campaigns generated before this shipped have `page_copy = null` and can't be edited until
  regenerated — `PageEditor` shows a clear message rather than a broken form in that case.

## Bridge page publish/draft state

Building (or editing) a campaign's bridge page no longer makes it publicly reachable by itself.
`campaigns.bridge_published boolean not null default false` (`supabase/migrations/
0018_bridge_publish.sql`) is an explicit gate on top of `status = 'ready'` —
`servePublicCampaignPage()` (`lib/publicPage.ts`, shared by `/p/[campaignId]/bridge` and the
custom-domain `/d/[[...path]]` route) now requires **both** conditions. `components/
PublishBridge.tsx`, rendered at the top of the product page's Bridge page tab, is the toggle UI;
`app/api/campaigns/[id]/publish/route.ts` is the only writer (ownership-checked via
`assert_owns_campaign`, refuses to publish a campaign that isn't `status='ready'` or has no
`bridge_html` yet).

- **No backfill was needed when this shipped** — verified via a direct query before writing the
  migration that zero rows existed in `ad_launches` or `custom_domain_routes` at the time, so no
  real ad traffic depended on any campaign's bridge page already being public; every pre-existing
  `ready` campaign safely defaults to unpublished, same as a brand-new one. If this pattern is
  reused for a future gate, don't assume that's still true — recheck.
- **Publishing surfaces two kinds of link**: the default `/p/{campaignId}/bridge` URL (always
  available once published, no setup needed) and, if the tenant has verified domains, one or more
  branded links via the existing custom-domain route-mapping RPC (`add_domain_route`,
  `supabase/migrations/0009_page_domains.sql`) — `PublishBridge.tsx` is a campaign-scoped view
  over the same `custom_domain_routes` data `components/DomainsPanel.tsx` manages, calling the
  exact same `/api/domains/[id]/routes` POST and `/api/domains/[id]/routes/[routeId]` DELETE
  endpoints rather than duplicating that logic. Unpublishing doesn't remove any domain-route
  mappings — they just stop resolving (same generic 404 as everything else here) until
  republished.
- **`/api/meta/ads/create` refuses to queue a `launch_ad` job for an unpublished campaign** —
  checks `campaigns.bridge_published` (via the RLS-respecting user-scoped client, already
  ownership-scoped by that point) and returns a clear 400 rather than letting a real paid ad go
  live pointing at a page nobody can see yet. `components/LaunchAd.tsx` mirrors this client-side
  (a `bridgePublished` prop gates the whole create-draft UI behind a "publish first" message) so
  the 400 is a defensive backstop, not the primary UX. Not a security boundary — a tenant can only
  ever misconfigure their own campaign this way — so there's no matching worker-side stage-0
  re-check the way `campaign_id`/`page_id` cross-tenant references get elsewhere in this codebase.

**A real, pre-existing bug this surfaced and fixed, not new to this feature**:
`createAdminClient()` (`lib/supabase/admin.ts`) previously let `@supabase/supabase-js`'s
underlying `fetch()` calls go through Next.js's default Data Cache. `export const dynamic =
"force-dynamic"` on a Route Handler does **not** reliably disable that for a library's own
internal fetch calls — confirmed directly: toggling `bridge_published` in the database, then
re-requesting `/p/{campaignId}/bridge` against the *same already-running* `next start` process,
kept serving the stale pre-toggle result. It had gone unnoticed until now because every other
`createAdminClient()` call site is either a mutation (POST/PATCH/DELETE, never cached) or sits
behind `createClient()`'s cookie read first (implicitly dynamic) — the public bridge/domain-image
serving routes were the only GET paths using the admin client with nothing upstream forcing
dynamism, and until this phase nothing about their output actually needed to change within a
process lifetime. **Fixed at the source**: `createAdminClient()` now passes `global: { fetch: (url,
init) => fetch(url, { ...init, cache: "no-store" }) }` — a blanket fix, not a per-route patch,
since caching a service-role read was never correct anywhere this client is used (the engine
worker, the Stripe webhook, `/api/public/leads`' campaign lookup, and `servePublicCampaignImage`
all benefit from the same fix, not just the bridge-publish gate that exposed it). Verified by
toggling `bridge_published` against a single long-running `next start` process (no rebuild) and
confirming both directions took effect on the very next request.

## Funnels (sidebar)

`/funnels` (`app/(app)/funnels/page.tsx`) is a read-only list page, not a new entity — a "funnel"
isn't its own table, it's every `campaigns` row that already has `bridge_html` generated. It
appears there automatically the moment `stagePages` (`lib/engine/build.ts`) writes the bridge page
— nothing explicitly inserts a "funnel." The page shows publish status (`bridge_published`), the
public link (a verified custom-domain route if one is mapped, else the default `/p/{id}/bridge`),
step count, and leads captured (`contacts` count by `campaign_id`). **All editing, publishing,
split-testing, and step management happen on the funnel's own `/funnels/[campaignId]` page** — the
"Manage" link goes there. The product page's Bridge tab is preview-only (a read-only iframe of the
opt-in page plus a link to `/funnels/{campaignId}`); it no longer mounts `PublishBridge`/
`PageEditor`/`SplitTestPanel` directly. A "Testing (N)" chip appears once a campaign has active
`bridge_variants` rows (see below).

## Bridge page A/B / split testing

`bridge_variants` (`supabase/migrations/0022_bridge_variants.sql`) lets a tenant run copy variants
against a campaign's existing bridge URL — no second URL, no changes anywhere ads/domains link to
the page. The **control** (today's `campaigns.bridge_html`/`page_copy`/`embedded_image_data_url`)
is never duplicated into a row; it gets a tracking row (`is_control=true`) with its own content
columns permanently `NULL` (enforced by a `check` constraint), purely so weight/stats/pause and
`contacts.bridge_variant_id` attribution have one uniform shape across control and real variants.
No `bridge_variants` rows for a campaign (the default, ~100% of campaigns) → `servePublicCampaignPage`
(`lib/publicPage.ts`) behaves exactly as before this feature existed — one extra cheap indexed
lookup, nothing else changes.

- **Assignment is sticky, not re-rolled per request**: a visitor gets a weighted-random pick
  (`lib/bridgeVariants.ts`'s `pickWeightedVariant`) on first visit, recorded in an `HttpOnly`
  cookie (`bv_{campaignId}`, 30 days, same `SameSite=Lax`+conditional-`Secure` flags as
  `app/api/meta/connect/route.ts`'s OAuth state cookie) — every later request for that visitor
  (including real ad click-throughs, since it's the same URL) keeps seeing the same variant, and
  `views` increments via a `service_role`-only atomic RPC (`increment_bridge_variant_views`) rather
  than a read-modify-write from the app.
- **Lead attribution never trusts client input**: `app/api/public/leads/route.ts` independently
  reads the same sticky cookie (the browser sends it automatically — confirmed working for both
  the default `/p/` URL and a custom domain) and re-validates the variant id actually belongs to
  the posted `campaign_id` before using it; no `variant_id` field exists in the request body at
  all.
- **Editing a variant reuses `PageEditor`/`renderBridgeHtml()` unchanged** — the component gained
  an optional `saveEndpoint` prop (defaults to the existing campaign page-copy route) so the same
  live-preview-matches-published guarantee holds for variants; a new
  `app/api/bridge-variants/[id]/route.ts` mirrors `page-copy/route.ts`'s validate/render/write
  shape exactly, scoped to a `bridge_variants` row. `assert_owns_bridge_variant()` explicitly
  excludes control rows — editing the control through this path 404s (control edits stay on the
  existing Bridge tab editor, which writes the `campaigns` row correctly); the DB `check`
  constraint is a second, independent layer of the same protection.
- **`start_bridge_split_test`/`add_bridge_variant`** are advisory-locked
  (`pg_advisory_xact_lock(hashtextextended('bridge_variants:' || campaign_id, 0))`, same idiom as
  `reserve_ad_credits`) — a double-click can't race two control rows into colliding on the
  one-control-per-campaign partial unique index, and can't race two "next letter" label
  computations into a collision either. Both share the same lock key, so they also serialize
  against each other.
- **`end_bridge_split_test(campaign_id, promote_variant_id?)`** is the only way a test ends: with
  a variant id, copies that variant's content onto `campaigns` (declaring it the new control —
  literally the same write shape the page-copy route already does) then deletes every
  `bridge_variants` row for the campaign either way; leads already captured keep their row
  (`contacts.bridge_variant_id` → null via `on delete set null`).
- **The split test renders as a visual branch directly on the funnel map** —
  `components/SplitTestBranch.tsx` replaces the plain opt-in `MapNode` in
  `components/FunnelMap.tsx`. With no test running (the default), it renders the same single
  opt-in node as before plus an inline "Split test" start button; once a test exists, the node
  visually splits into parallel variant cards (Control/B/… side by side — each with weight input,
  views/leads/computed rate, preview, edit, pause/resume, delete) that merge back into the single
  funnel path below, mirroring the real weighted-random split a visitor experiences. A variant
  card's "Edit copy" switches the parent page (`app/(app)/funnels/[campaignId]/page.tsx`) to a new
  `{kind: "variant", variantId}` view — a focused `PageEditor` with
  `saveEndpoint=/api/bridge-variants/{id}` (the variant row is fetched on demand there, not
  preloaded with the page); the control card's edit routes to the existing `optin` view, which
  writes the `campaigns` row correctly.
- **`components/SplitTestPanel.tsx`** (the detailed vertical list — variant rows, "Add variant"
  capped at 5 total, "End test" with a promote-winner picker, inline variant `PageEditor`) still
  exists, shown on the opt-in page's own focused editor view. **Both components share
  `lib/useSplitTest.ts`** — the variants/leadCounts state and every RPC call
  (start/add/weight/toggle/delete/end) extracted into one hook once this became two consumers, so
  neither can drift from the other's read-after-write/error-handling behavior.

## Funnel tracking integrations (GA4 / GTM / Clarity / Meta Pixel)

`campaigns.tracking jsonb` (`supabase/migrations/0028_campaign_tracking.sql`) holds per-funnel
analytics IDs (`ga4_id`/`gtm_id`/`clarity_id`/`meta_pixel_id`), injected into every publicly
served page of that funnel — opt-in, split-test variants, and steps. Configured via the Tracking
panel (`components/TrackingPanel.tsx`) on the funnel map view; saved through
`app/api/campaigns/[id]/tracking/route.ts`, which re-renders everything the funnel serves (page
HTML is baked at write time in this codebase, never templated at serve time).

- **`lib/engine/tracking.ts` is the security boundary, and pasted snippets are never stored or
  rendered.** Each field accepts a bare ID or the full "paste before </head>" install snippet the
  platform hands out — `extractTrackingId()` pulls the ID out via provider-specific contextual
  regexes and discards the markup; the app then renders its own canonical, code-owned version of
  each snippet (`renderTrackingHtml()`). Raw tenant-pasted `<script>` HTML must NEVER be injected
  into served pages: funnel pages serve on the app's shared origin (`/p/...`), where the app's own
  session cookies live — verbatim injection would be cross-tenant XSS by construction (a visiting
  logged-in user's session exposed to another tenant's script). Extraction + code-owned snippets
  gives the paste-the-code UX without that. Every ID is validated against a strict anchored
  per-provider pattern at save time (hard 400 with a field-specific message on failure — a typo'd
  ID silently dropped would read as "tracking is broken") AND re-checked at render time — a stored
  value that doesn't match renders nothing. Verified directly: script-injection-shaped IDs are
  rejected at validation and render nothing even when force-stored.
- **Threading**: `renderBridgeHtml`/`renderFunnelStepHtml` gained an optional `tracking` param
  (spliced into `<head>` + a body-start fragment for GTM's/the Pixel's noscript blocks); passed by
  every render call site — `stagePages` (fetches the row's `tracking` so a campaign REBUILD keeps
  its snippets), both page-copy PATCH routes, and `rerenderFunnelSequence`. The opt-in submit
  handler fires `fbq('track','Lead')` when the Pixel is installed (guarded no-op otherwise).
- **A pre-existing gap got fixed in the same pass**: `rerenderFunnelSequence` never re-rendered
  `bridge_variants` — a non-control variant's page (served at the same URL as the control) never
  picked up funnel-step redirects, so visitors assigned to B+ on a multi-step funnel got the
  in-place reveal instead of step 1. It now re-renders every non-control variant with the same
  `nextStepUrl` + tracking as the control; the bridge-variants PATCH route also resolves
  `nextStepUrl` now (it previously always baked the reveal behavior).
- **Verified end-to-end at the DB level** (service-role script mirroring exactly what the route
  does after auth): save tracking → re-render → GA4/Pixel/noscript/Lead-event all present in the
  real stored `bridge_html`; clear tracking → re-render → all snippets gone, page content intact.
  Extraction verified against each platform's real verbatim install snippet shape.

## Multi-step funnels

`funnel_steps` (`supabase/migrations/0023_funnel_steps.sql`) lets a tenant chain fixed-type pages
(Thank-you, Upsell, Order) after the opt-in page, all still anchored to one campaign — no separate
parent "funnel" row; `/funnels/[campaignId]` uses the campaign id directly. The opt-in page itself
is untouched (`campaigns.bridge_html`/`page_copy`/`bridge_published` + `bridge_variants` A/B
testing, unchanged) and stays the funnel's entry point. One publish toggle
(`campaigns.bridge_published`) gates the opt-in page and every step together — no per-step publish
state. A funnel with zero `funnel_steps` rows (the default) behaves byte-for-byte as before this
feature existed.

- **Editing/publishing moved off the product page** onto `/funnels/[campaignId]/page.tsx` (a client
  component fetching campaign + steps via `createClient()`, same pattern as `/broadcast/[id]/page.tsx`).
  The product page's Bridge tab is now preview-only (the existing read-only iframe) with a "Manage &
  publish this funnel" link there.
- **The management page defaults to a map, not one long inline scroll.** `components/FunnelMap.tsx`
  renders the opt-in page and every step as a sequence of nodes (icon + label + a connecting arrow),
  each with a **Preview** action (opens a shadcn `Dialog` with an `iframe srcDoc={html}` of that
  page's currently-*stored* HTML — `campaign.bridge_html` for the opt-in node, `step.html` per step
  — not a fresh render, so it can go stale relative to unsaved in-progress edits until the next
  Save; "Nothing to preview yet" is the deliberate empty state for a step that's never been saved)
  and an **Edit** action. Steps additionally keep their own Move up/down/Delete icons inline on the
  node (these are map-level operations now, not inside the editor). `FunnelPage`
  (`app/(app)/funnels/[campaignId]/page.tsx`) holds a `View = {kind:"map"}|{kind:"optin"}|
  {kind:"step",stepId}` state — clicking Edit switches to a focused single-page editor view
  (`PageEditor`+`SplitTestPanel` for `"optin"`, `FunnelStepEditor` for a step) with a "← Back to
  funnel map" link, replacing the entire page body rather than expanding inline — the map, the
  opt-in editor, and a step's editor are never rendered at the same time. `PublishBridge` (the
  funnel-wide publish toggle) only shows on the map view, since it's a funnel-level control, not
  specific to whichever page happens to be open. Replaced `components/FunnelStepsSection.tsx`
  outright (deleted, not deprecated) — its list+inline-edit responsibilities split between
  `FunnelMap.tsx` (list/move/delete/preview) and the page's own view-switching (edit).
- **CTA hrefs are resolved and baked into `html` at write time**, matching how every other
  rendered field in this codebase already works — not templated at serve time, which would be a
  second mechanism unique to this feature. Because of that, `lib/funnelSteps.ts`'s
  `rerenderFunnelSequence(admin, campaignId, userId)` re-renders `campaigns.bridge_html` (its
  `nextStepUrl`) and every step's `html` (its own CTA/decline href) in one pass after any action
  that changes the step sequence or a step's own copy — simplest-correct for typical funnel size,
  not a targeted diff. `renderBridgeHtml()` gained an optional `nextStepUrl` param for this; when
  set, the opt-in page's submit handler redirects there instead of today's in-place step-2 reveal.
- **Thank-you/Order**: one CTA, `cta_action` (`supabase/migrations/0024_funnel_step_redirect_url.sql`)
  picks `next_step` (the following step's URL, or the resolved hoplink if this is the last step),
  `hoplink` (always the hoplink, skipping ahead), or `redirect_url` (a tenant-supplied custom URL,
  stored in `redirect_url`, validated server-side — see below). **Upsell** has two independent
  actions, each with the same three-way choice: Accept (`cta_action`, defaulting to `hoplink`
  against `target_product_id`'s product — or this campaign's own product if null — for cross-sell,
  ownership-checked in `app/api/funnel-steps/[id]/route.ts` against the same user) and Decline
  (`decline_action`/`decline_redirect_url`, defaulting to `next_step`, falling back to the
  *original* product's hoplink if there's no next step). Every hoplink path still gets a distinct
  tid (`step-{index}`, `step-{index}-upsell`/`-decline`) extending the existing per-channel tid
  convention; a `redirect_url` choice bypasses hoplink resolution (and the target-product lookup)
  entirely. `isValidRedirectUrl()` requires `http(s)://` and caps length at 2000 chars — the value
  is tenant-supplied, not public input, but still becomes a real `<a href>` on the tenant's own
  page, so a cheap scheme allowlist avoids an accidental `javascript:`/`data:` self-XSS.
- **`add_funnel_step`/`move_funnel_step`/`delete_funnel_step`** (`SECURITY DEFINER`,
  `authenticated`) are advisory-locked (`pg_advisory_xact_lock(hashtextextended('funnel_steps:' ||
  campaign_id, 0))`, same idiom as `bridge_variants`) — a double-click can't collide two rows on
  the `(campaign_id, step_index)` unique constraint. `move_funnel_step`'s swap uses a large
  sentinel offset (`1000000000 + index`), not `-1`: `step_index` has a `>= 1` CHECK and this
  table's unique index isn't deferrable, so a naive swap would fail mid-transaction.
- **Public serving**: `app/p/[campaignId]/step/[stepIndex]/route.ts` mirrors `.../bridge/route.ts`
  exactly (same `status='ready' AND bridge_published=true` gate, same generic 404, no oracle).
  Deliberately **not** custom-domain-routed or A/B-tested in this phase (both stay scoped to the
  opt-in page) — downstream steps are only reachable via the internal redirect chain, using the
  default `/p/` URL even when the opt-in page itself was reached through a custom domain.

## Custom domains

Clients can connect their own domain(s) — bring-your-own only, no in-app domain purchase — and
publish bridge pages under them. **One domain can host many campaigns**, each at its own
path (e.g. `yourdomain.com/eat-stop-eat`, `yourdomain.com/smoothie-diet`, or the bare root).
Schema in `supabase/migrations/0009_page_domains.sql`; Vercel API wrapper in
`lib/vercel/client.ts`; routes under `app/api/domains/*`; UI at `app/(app)/domains/page.tsx` +
`components/DomainsPanel.tsx`.

- **`custom_domains`/`custom_domain_routes` have owner-`select` RLS but no client write access**
  (`revoke insert, update, delete ... from anon, authenticated`) — every write is paired 1:1 with
  a real Vercel API call (adding/removing a domain from the project), so it must go through a
  server route using `createAdminClient()`, or through the two narrow `SECURITY DEFINER` RPCs
  below for path-mapping writes specifically.
- **Domain-claim uniqueness is a *partial* unique index, not a blanket one**:
  `create unique index ... on custom_domains(domain) where status = 'verified'`. Anyone
  authenticated can type in a domain they don't own and create a `pending` claim — expected,
  ownership is proven later via Vercel's own verification. A blanket `unique(domain)` would let an
  abandoned, never-verified claim permanently block the real owner from ever connecting it here;
  the partial index means multiple tenants can each hold a harmless `pending` claim on the same
  string, but only one can ever actually reach `verified`.
- **`add_domain_route(p_domain_id, p_path, p_campaign_id, p_destination)` is the load-bearing
  ownership check** — re-verifies the domain belongs to `auth.uid()` **and** calls the existing
  `assert_owns_campaign(p_campaign_id)` RPC (from Phase C, reused as-is) before inserting. Without
  this, a tenant could map their own verified domain's path to *another* tenant's `campaign_id`
  and publicly serve/rebrand that tenant's bridge page under an attacker-controlled domain. Never
  add a route-mapping write path that skips this RPC. `p_destination`/`custom_domain_routes
  .destination` still exist at the DB layer (`'presell' | 'bridge'` check constraint) but the app
  never accepts it as caller input anymore — `app/api/domains/[id]/routes/route.ts` always passes
  the literal `"bridge"`, since the presell page variant was merged into the bridge page (content
  rule 8); the column stays rather than a destructive migration, matching every other deprecated
  column this codebase has left in place (`profiles.nickname`, `campaigns.presell_html`). Same for
  `ad_launches.destination` (`lib/engine/adlaunch.ts`, `app/api/meta/ads/create/route.ts`) — always
  `"bridge"`, no longer a `LaunchAd`/`DomainsPanel` UI choice.
- **`custom_domain_routes.campaign_id` cascades on delete** (matching the precedent already set on
  `ad_launches.campaign_id`) — deleting a campaign makes its domain routes vanish (clean 404)
  instead of blocking the delete with an FK error.
- **Serving path**: `middleware.ts` compares the incoming `Host` header against
  `NEXT_PUBLIC_APP_URL`'s host (always also allowing `localhost`) **before** the auth-gate logic
  runs. A mismatch rewrites to `/d${pathname}` and returns immediately — this traffic is always
  anonymous and must never redirect to `/login`, and the rewrite fully pre-empts route resolution
  for anything else (dashboard, `/api/domains`, etc. are simply never reached for a mismatched
  Host). `app/d/[[...path]]/route.ts` reads `request.headers.get("host")` **directly** (not
  `request.nextUrl.host`, which reflects the rewritten internal URL and would silently break
  this), looks up `custom_domain_routes` joined to `custom_domains` (`status = 'verified'`), and
  on a hit calls the existing `servePublicCampaignPage()` (`lib/publicPage.ts`) completely
  unchanged — full reuse, zero duplicated serving logic, same generic 404 as the `/p/` route.
- **Two verification checks, not one**: Vercel's domain API distinguishes *ownership*
  verification (a TXT challenge, only needed for domains already tied to another Vercel
  project/account) from actual *DNS-pointing* config (whether A/CNAME records really resolve
  here). `isDomainFullyVerified()` (`lib/vercel/client.ts`) checks both — our own `status =
  'verified'` only ever means both passed.
- **Periodic re-verification**: `pg_cron` job `domains-reverify-backstop` (every 6 hours, same
  pattern as `engine-drain-backstop`) calls `app/api/domains/reverify-all/route.ts` (same
  `x-engine-secret`/`ENGINE_WEBHOOK_SECRET` trust boundary as `app/api/engine/run`) to catch a
  domain re-pointed away from Vercel after initial verification — not a security hole (Vercel's
  own edge just stops routing that hostname here), but worth surfacing as `error` instead of a
  silent, unexplained 404. The Vault secret `domains_reverify_url` holds the full endpoint URL
  (set via `execute_sql`, same as `engine_webhook_url`/`engine_webhook_secret`).
- **Env vars**: `VERCEL_API_TOKEN` (create at vercel.com/account/tokens, scoped to this project —
  I cannot generate this), `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` (only needed if the project lives
  under a team, which it does here).

## Connectors (Instagram, TikTok, YouTube, Mail)

Instagram gets real posting; TikTok and YouTube are **connect-only** (this app doesn't generate
video, so there's nothing to post yet — connecting now means it's ready the moment that changes);
Mail sends the generated email swipe copy from the client's own connected Gmail. Generic
Vault-secret RPCs (`store_oauth_secret`/`get_oauth_secret`/`delete_oauth_secret`, added in
`supabase/migrations/0010_connectors.sql`) are used by TikTok/YouTube/Mail instead of the
Meta-named ones in `0007_meta_secret_helper.sql` — those stay untouched, zero risk to Phase B/C.

- **Instagram reuses the existing Meta/Facebook connection — no separate OAuth flow.**
  `FB_OAUTH_SCOPES` (`lib/meta/config.ts`) includes `instagram_basic`/`instagram_content_publish`;
  existing connections need one re-auth to pick them up (same pattern as `ads_management` before).
  `app/api/meta/callback/route.ts` discovers a linked IG Business account per Page
  (`GET /{page-id}?fields=instagram_business_account`) and upserts `meta_instagram_accounts`.
  **There is no separate IG token** — IG Business actions are authorized via the *linked Page's*
  own token (`meta_pages.page_token_secret_id`), which is how Meta's Graph API actually works.
  **The token lookup in `app/api/instagram/post/route.ts` is double-scoped by `user_id` AND
  `page_id`, never by `linked_page_id` alone** — `assert_owns_ig_account` only confirms the caller
  owns the IG-account row, not that the Page token fetched one hop away is safe to trust without
  re-checking; this mirrors `/api/meta/post`'s existing double-scoped pattern and closes the same
  class of cross-tenant IDOR. Never simplify that lookup to a bare `page_id` match.
- **Instagram posting needs a real public image URL** (`POST /{ig-user-id}/media` requires a
  fetchable `image_url`, unlike Facebook's Photos API which accepts direct byte upload).
  `campaigns.embedded_image_data_url` persists the same image already embedded in
  `bridge_html` (written by `stagePages()` and the page-copy editor route);
  `app/api/public/campaign-image/[campaignId]/route.ts` (`lib/publicPage.ts`'s
  `servePublicCampaignImage`) serves it standalone, same UUID+`status='ready'` scoping as the
  `/p/` route. **Image content-type is allowlisted, not just checked for an `image/*` prefix** —
  `lib/images/validate.ts`'s `isValidImageDataUrl()`/`ALLOWED_IMAGE_CONTENT_TYPES` (png/jpeg/webp/
  gif only, never svg+xml, which can carry inline `<script>`) is enforced at all three points that
  touch this value: `lib/engine/images.ts`'s `fetchImageAsDataUrl()` at fetch time, the page-copy
  route at save time, and the public image route again at **serve** time — never trust the DB
  row's format is guaranteed just because a write path validated it; a non-matching stored value
  is a 404, not served with whatever Content-Type it happens to claim.
- **TikTok/YouTube/Mail follow the exact same OAuth-CSRF/Vault/default-deny-RLS shape as Meta**
  (`lib/tiktok/*`, `lib/google/*`, `app/api/{tiktok,youtube,mail}/{connect,callback,disconnect}`),
  each with its own state-cookie name (`tiktok_oauth_state`/`youtube_oauth_state`/
  `mail_oauth_state`) so concurrent flows in different tabs never collide.
- **YouTube and Mail share one Google Cloud OAuth client** (`GOOGLE_CLIENT_ID`/`SECRET`) but each
  has its own dedicated callback route and its own disjoint scope constant
  (`YOUTUBE_SCOPES`/`MAIL_SCOPES` in `lib/google/config.ts`) — **never combine them into one
  shared list**, or the YouTube connect flow could accidentally request (and receive consent for)
  `gmail.send`. A code issued for one flow can't be exchanged at the other's callback regardless
  (Google requires the exchange's `redirect_uri` to exactly match the one used to obtain the
  code), but keeping the scopes disjoint is what actually enforces "YouTube is read-only."
  `access_type=offline&prompt=consent` is forced on both so a `refresh_token` is always returned.
- **Google access-token refreshes must delete the old Vault secret, not just repoint the column.**
  Meta's token replacement only happens on a rare full re-auth; Google access tokens expire
  hourly, so `app/api/mail/send/route.ts`'s refresh-on-expiry path calls `delete_oauth_secret` on
  the prior access-token secret immediately after storing and repointing to the new one — without
  this, `vault.secrets` grows unbounded for any actively-used mail/YouTube connection. Any future
  code that refreshes a Google token must do the same.
- **`mail_sends.campaign_id`, when provided, is validated via `assert_owns_campaign` before
  insert** — the send route itself never operates on another tenant's resource (the mailbox is
  always the caller's own `mail_connections` row, `to`/`subject`/`html` are the caller's own
  freeform content), but this closes a landmine for any future feature that joins `mail_sends` →
  `campaigns` via the admin client without independently re-checking ownership.
- **Env vars**: `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET` (developers.tiktok.com — register
  `${NEXT_PUBLIC_APP_URL}/api/tiktok/callback`), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
  (console.cloud.google.com — register both `${NEXT_PUBLIC_APP_URL}/api/youtube/callback` and
  `${NEXT_PUBLIC_APP_URL}/api/mail/callback`). TikTok apps and Google's OAuth consent screen both
  work immediately for the developer/testers added on the app itself, without full review —
  sufficient for testing, same caveat as Meta's Development Mode; `gmail.send` specifically is a
  "restricted" scope that needs Google's security assessment before a public rollout.

## Mail providers (Resend / SendGrid / Mailgun / generic SMTP)

Tenants can send email through a transactional provider instead of Gmail. `mail_provider_connections`
(`supabase/migrations/0026_mail_providers.sql`) holds one row per (user, provider ∈ resend/
sendgrid/mailgun/smtp); the single credential per row (API key, or the SMTP password) lives in
Vault via the existing generic `store/get/delete_oauth_secret` RPCs — same per-row Vault +
default-deny-RLS + sanitized-read-RPC (`get_mail_provider_connections()`) pattern as every OAuth
connector. Gmail's own OAuth connection (`mail_connections`) is untouched.

- **Exactly one active sender per account** (`profiles.active_mail_provider`, default `'gmail'` so
  nothing changed for existing users; changed only via the `set_active_mail_provider()` RPC, which
  refuses to point at a provider that isn't actually connected — no general profiles update policy
  exists, per the 0002_trial.sql precedent). **Every send goes through
  `sendViaActiveSender()` (`lib/mail/send.ts`)** — both `app/api/mail/send/route.ts` (one-off
  SendEmail) and `lib/engine/broadcast.ts`'s send stage dispatch through it, so "which provider
  sends" is decided in exactly one place. `mail_sends`/`broadcast_sends` gained a `provider`
  column (null = legacy Gmail rows). `SendEmail.tsx`/`BroadcastActivateControl.tsx` gate on the
  new `get_active_mail_sender()` RPC ("can this account send right now, via whatever's active")
  instead of the Gmail-specific status RPC.
- **Credentials are live-verified at connect time, before anything is stored**
  (`app/api/mail-providers/route.ts` POST): Resend `GET /domains`, SendGrid `GET /v3/scopes`,
  Mailgun `GET /v3/domains/{domain}` (basic `api:key` auth, US/EU region-aware base URL), SMTP via
  a real `nodemailer` `verify()` handshake — a bad key is a clear 400 at connect, never a mystery
  failure on the first real send. All three HTTP APIs' endpoint/auth shapes were live-verified
  (401 + documented error JSON against each real endpoint) before the client code was written, per
  the standing external-integration rule. Verified end-to-end that a rejected credential stores
  nothing: no row, no orphaned Vault secret. Re-connecting replaces the credential with the same
  store-new-then-delete-old Vault hygiene as `lib/google/mailToken.ts`. **Port 25 is rejected up
  front** (Vercel blocks outbound 25) with a clear "use 465/587" message instead of a timeout.
- **Auth-shaped send failures degrade, transient ones throw**: `MailProviderError.isAuthError`
  (revoked key, rejected SMTP login — SMTP 535/534/530 codes) flips the connection row to
  `status='error'` so the UI shows "needs reconnect", mirroring Gmail's `needs_reconnect`
  degradation; anything else propagates to the caller's normal retry semantics (Broadcast's
  attempts cap, the send route's 502).
- **The from address is tenant-supplied and must be provider-verified** (a verified domain/sender)
  — stated in the UI; the provider itself rejects unverified senders, this app doesn't try to
  pre-validate domain ownership.
- **Rate cap unchanged**: the pooled 300/day cap (`run_broadcast_sweep` + `lib/engine/broadcast.ts`)
  still applies regardless of provider. It exists to protect Gmail specifically; per-provider caps
  (Resend/SendGrid/Mailgun tiers all differ) are an explicit deferred follow-up, not silently
  handled.
- **UI**: `components/MailProvidersPanel.tsx` on the Connections page's Email section, under the
  Gmail panel — provider tabs (existing shadcn Tabs) with per-provider connect forms, and an
  "Active sender" picker built on `components/ui/radio-group-card.tsx` (from 21st.dev,
  `@ruixen.ui/radio-group-card` — third 21st.dev-sourced component, fetched via the MCP connector).
  `components/ui/input.tsx`/`label.tsx` are standard shadcn primitives written directly (the
  21st.dev fetch API hit its 2/day limit — same documented fallback as the Tabs commit).
  Unconnected providers' cards are disabled; Gmail stays pickable only when its OAuth connection
  exists.
- **Not live-verified: an actual delivered send through each provider** — that needs a real API
  key/SMTP account, same caveat shape as Meta video ads. What is verified live: all three HTTP
  endpoint shapes, the full connect-flow rejection paths (bad Resend key against Resend's real
  API, missing from-address, port 25), advisors (same intentional shapes as every prior Vault
  table/authenticated RPC), and that failed connects store nothing.
- **New npm deps**: `nodemailer` (+ types). No new env vars — credentials are per-tenant.

## AI image + video generation, real TikTok/YouTube/Reels posting

Ad creative images (Facebook/Instagram ads only — the bridge page and Instagram photo posts
still use the vendor-extracted `embedded_image_data_url`, untouched) come from **kie.ai**
(`lib/kieai/client.ts`). Short-form video — generated specifically to unlock real TikTok/YouTube/
Instagram Reels posting — comes from **Google's Gemini API directly** (Veo 3.1,
`lib/gemini/client.ts`), no third-party proxy. Both are platform-level API keys
(`KIE_AI_API_KEY`, `GEMINI_API_KEY`), same trust tier as `ANTHROPIC_API_KEY` — not per-tenant
OAuth. `GEMINI_API_KEY` is a plain Google AI Studio key, unrelated to the `GOOGLE_CLIENT_ID`/
`GOOGLE_CLIENT_SECRET` OAuth client used for YouTube/Mail connections.

- **A "poll, not ready yet" job stage has its own DB-level mechanism**
  (`heartbeat_job_retry()` RPC, `lib/engine/worker.ts`'s `heartbeatRetry()`/`runStageLoop()`) —
  distinct from a normal stage-advance and from a thrown error. `claim_job()` increments
  `attempts` on every claim, including a stale-reclaim (`locked_at` older than 90s); without this,
  a long `generate_video` poll that's still legitimately waiting would get reclaimed roughly every
  90-150s and hit `MAX_ATTEMPTS` in ~8-12 minutes — squarely inside what's a *normal* Veo wait —
  terminally failing a video that may have been about to finish. A stage function signals this by
  returning `{ retry: true }`; `runStageLoop` heartbeats (`locked_at = now()`, `attempts =
  greatest(attempts - 1, 0)`) and **breaks to the outer claim loop** rather than hammering the
  same not-ready poll, so one job's wait never starves every other tenant's queued jobs for a
  whole invocation. Any new long-running/polling job type must use this same `retry` shape, never
  just silently `return { done: false }` on "not ready yet."
- **`generate_ad_image`/`generate_video` both have their own `verify` stage 0**
  (`lib/engine/adimage.ts`/`lib/engine/videogen.ts`), mirroring `launch_ad`'s — `jobs`' RLS only
  validates the row's `user_id`, not `payload` contents, so a forged `campaign_id` would let an
  attacker's `finalize` stage silently overwrite a *different* tenant's ad creative or video
  (paid for with the attacker's own money — a griefing bug, not a billing-theft one). Never add a
  job type that trusts `payload` without an equivalent stage-0 re-check.
- **The `campaign-videos` Supabase Storage bucket is private** — the first Storage usage in this
  codebase (every prior "needs a public URL" case used a Postgres-backed Route Handler instead).
  `storage.objects` has zero RLS policies (default-deny, same shape as `meta_pages`), so only the
  service-role admin client (`lib/supabase/storage.ts`) can read/write directly. TikTok's
  `PULL_FROM_URL` and Instagram's Reels container are the only consumers that need a URL *their*
  servers fetch — `createSignedVideoUrl()` mints a short-lived (1 hour) signed URL fresh at each
  posting call, never stored. YouTube's resumable upload streams bytes directly from our server
  and never touches a URL at all (`downloadCampaignVideo()`).
- **`generate_video` has two independent cost guardrails** (`app/api/campaigns/[id]/
  generate-video/route.ts`) — Veo pricing per generation is a materially different order of
  magnitude than a text/image call, so the "usage-tracking only" reasoning that's fine for
  Anthropic calls and ad-image generation doesn't transfer: (a) an atomic concurrency claim
  (`update campaigns set video_status='generating' ... where video_status != 'generating'
  returning id` — a single UPDATE...WHERE...RETURNING, same idiom as every job stage-advance in
  this codebase, not a separate check-then-write) rejects a second concurrent request for the
  same campaign; (b) `MAX_VIDEO_GENERATIONS_PER_DAY` (currently 5) caps per-user daily requests,
  checked via a count query against `jobs` before the claim.
- **Google's hourly token refresh must delete the old Vault secret, not just repoint the
  column** — same `delete_oauth_secret` hygiene already established for Mail/YouTube connections
  in the prior phase, now also applied to TikTok's refresh path (`app/api/tiktok/post-video/
  route.ts`) and reused verbatim for YouTube's (`app/api/youtube/upload/route.ts`). Skipping this
  leaves `vault.secrets` growing unbounded for any actively-posting connection.
- **Real posting defaults are deliberately conservative for unaudited/unverified apps**:
  TikTok posts are hardcoded `privacy_level: "SELF_ONLY"` (unaudited apps aren't approved for
  public "Direct Post"); YouTube uploads default `privacyStatus: "private"`. Both are safe for
  testing on your own account — change from the platform's own settings (TikTok app review,
  YouTube Studio) once ready for a real rollout, same caveat shape as every other platform
  integration in this project.
- **Ad-creative image generation prefers the AI-generated creative over the vendor photo, never
  a hard dependency** — `lib/engine/adlaunch.ts`'s `stageCreative` checks
  `campaigns.ad_creative_image_data_url` first, falls back to the existing vendor-photo path
  (`fetchImageAsDataUrl` + `uploadAdImage`) exactly as before if generation hasn't run or failed.
- **Env vars**: `KIE_AI_API_KEY` (kie.ai/api-key), `GEMINI_API_KEY` (aistudio.google.com/apikey —
  a plain API key, not the `GOOGLE_CLIENT_ID`/`SECRET` OAuth client).

## Per-item ad angle & social post creatives

`fb_ads_md`/`social_md` used to be one flat markdown string each (3 ad angles / 5 social captions
as prose inside a single string, no per-item addressability). `lib/engine/build.ts`'s `stageAds`/
`stageSocial` now request structured arrays instead — `campaigns.fb_ad_angles jsonb` (exactly 3
`{headline, primary_text, description, cta}` objects) and `campaigns.social_posts jsonb` (exactly
5 `{caption}` objects) — so each angle/post can have its own AI-generated image and/or video,
independent of every other item on the campaign. `fb_ads_md`/`social_md` are never written by new
builds; old rows keep their legacy flat text, unread by the new UI — same precedent as
`profiles.nickname`/`campaigns.presell_html`/`campaigns.landing_md`. `tiktok_md`/`email_md`/
`blog_md` are untouched by this — still flat strings, no per-item generation for those.

- **`campaign_creatives`** (`supabase/migrations/0019_campaign_creatives.sql`) is the per-item
  generalization of the old single `campaigns.ad_creative_image_data_url`/`video_path`/
  `video_status` columns — one row per `(campaign_id, source ∈ {'fb_ad_angle','social_post'},
  item_index, kind ∈ {'image','video'})`, each with its own `status` (`'none'|'generating'|
  'ready'|'failed'`), `image_data_url`/`video_path`, and `error`. Same owner-select-only RLS +
  admin-client-only-write pattern as every other domain table in this app. The old single-column
  flows (`components/LaunchAd.tsx`'s "Generate ad creative" button, `components/GenerateVideo.tsx`)
  are left exactly as they were — they're campaign-level fallbacks/quick options, not replaced.
- **`claim_campaign_creative(campaign_id, source, item_index, kind)` is an atomic per-row
  generation claim in one round trip** — an `INSERT ... ON CONFLICT DO UPDATE ... WHERE status <>
  'generating' RETURNING id`, returning `NULL` (not an error) if the row was already generating.
  This exists because PostgREST's `.upsert({onConflict})` can't express a conditional `WHERE` on
  the `UPDATE` arm of an upsert (same limitation already documented for the `contacts` de-dupe
  index in `0017_contacts.sql`) — this is what a per-row analogue of `generate-video/route.ts`'s
  `UPDATE...WHERE...RETURNING` concurrency claim has to look like once there's a row per item
  instead of one column per campaign. Verified directly: two claims for the same `(campaign_id,
  source, item_index, kind)` — first returns a real id, second returns `NULL`; a claim against
  another tenant's `campaign_id` raises before any row is touched.
- **Two new job types generalize `generate_ad_image`/`generate_video`** — `generate_creative_image`
  (`lib/engine/creativeimage.ts`, stages `["verify","prompt","submit","poll","finalize"]`) and
  `generate_creative_video` (`lib/engine/creativevideo.ts`, stages `["verify","script","submit",
  "poll","download","finalize"]`) — same stage-loop + `retry`-heartbeat mechanics as every other
  job type in `lib/engine/worker.ts`, same stage-0 ownership re-check pattern (jobs' RLS only
  validates the row's `user_id`, not payload contents), but every read/write targets one
  `campaign_creatives` row by `id`, not a `campaigns` column by `campaign_id`. The generation
  prompt is seeded from that *one* angle's/post's own copy (`campaigns.fb_ad_angles[item_index]`/
  `social_posts[item_index]`, with a defensive bounds check — the array could have shrunk if the
  campaign was rebuilt after the creative row was created), not the whole `fb_ads_md`/`tiktok_md`
  blob the legacy jobs use. **Unlike the legacy `generate_ad_image` job (a known, documented gap —
  a terminally-failed image job leaves no failure signal anywhere), both new job types get a real
  `failJob()` branch** writing `status='failed'`/`error` onto the `campaign_creatives` row, so the
  UI can actually show "failed" instead of silently staying "generating" forever.
- **Ad-angle video defaults to `16:9` (Feed-ad-shaped); social-post video stays `9:16`**
  (Reels/Stories-shaped, matching `GenerateVideo.tsx`'s existing default) — picked automatically
  from the `campaign_creatives` row's own `source` column, no extra input needed. Storage path is
  per-item (`${campaignId}/${source}-${itemIndex}.mp4`), not the legacy flat `${campaignId}.mp4` —
  the private `campaign-videos` bucket and its signed-URL helpers (`lib/supabase/storage.ts`) are
  reused completely unchanged, only the path shape is new.
- **Rate caps, revisited for multiplied volume.** A campaign can now have up to 8 image slots and
  8 video slots (3 angles + 5 posts), versus 1+1 before — `app/api/campaign-creatives/generate/
  route.ts` pools its daily cap check with the matching legacy route (`generate_ad_image`+
  `generate_creative_image` share one counter; `generate_video`+`generate_creative_video` share
  another) so a client can't dodge either cap by picking one route over the other for the same
  kind of generation. **Both caps are currently `100`/day — a nominal runaway-loop backstop, not a
  real budget control** (the user is testing solo and explicitly doesn't want to hit a ceiling
  while trying this out) — revisit both before opening this beyond solo testing. Image generation
  never had a cap at all before this (it was "usage-tracking only, no cap" specifically because it
  was structurally rare at one button per campaign — that reasoning doesn't survive 8x the
  volume), so this is the first time it does.
- **UI**: `components/CreativeItemCard.tsx` (one card, two independent Generate Image / Generate
  Video buttons, each polling its own status every 4s while `generating` — same pattern
  `GenerateVideo.tsx`/`LaunchAd.tsx` already use) renders under every angle/post in
  `components/AdAnglesPanel.tsx`/`components/SocialPostsPanel.tsx`, which replace the old
  `marked.parse()` blob render for the `fb_ads_md`/`social_md` tabs in `app/(app)/product/[id]/
  page.tsx`. **Legacy campaigns without `fb_ad_angles`/`social_posts` fall back to that exact old
  blob render**, with a "regenerate to unlock per-item generation" note — same "regenerate to
  upgrade" precedent `components/PageEditor.tsx` already established for `page_copy = null`, no
  backfill/parsing of old markdown attempted. `SocialPostsPanel.tsx` keeps `PostToFacebook`/
  `PostToInstagram` mounted underneath, completely unchanged components — only their
  default-content prop changes (first generated caption instead of the old flat `social_md`
  string). Wiring a *specific* post's own generated creative into the actual posting API calls
  (`PostToFacebook`/`PostToInstagram`/`/api/tiktok/post-video`/`/api/youtube/upload` all still
  reference the single campaign-level `embedded_image_data_url`/`video_path`) is explicitly
  deferred, not built here.

## Per-angle ad launches, including real video ads (Phase J)

`ad_launches` used to be one row per campaign (`unique(campaign_id)`), always an image creative
built from a hard-coded fallback chain. It's now one row per `(campaign_id, angle_index)` — a
client picks a specific ad angle and launches it with that angle's own copy **and** its own
generated creative (image or video, per `campaign_creatives`), and real Meta video ads are
supported end to end (upload → processing-poll → video ad creative), not just a downloadable
asset.

- **`supabase/migrations/0020_multi_angle_ad_launches.sql`**: dropped
  `ad_launches_campaign_id_key`, added `angle_index int not null`, `creative_kind text not null
  default 'image' check (in ('image','video'))`, `meta_video_id text`, and a new
  `unique(campaign_id, angle_index)`. Reconfirmed immediately before applying (both facts, not
  assumed from the plan): `ad_launches` had zero rows and the dropped constraint was exactly what
  was expected — low-risk widen.
- **`id`, not the `(campaign_id, angle_index)` business key, is what every stage after `verify`
  actually uses.** `lib/engine/adlaunch.ts`'s `stageVerify` is the only place that needs
  find-or-create-by-business-key semantics (`upsert(..., {onConflict: "campaign_id,angle_index"})`
  — verified directly: a same-key upsert returns the same `id` and updates in place, a different
  `angle_index` creates an independent row); it selects the row's `id` back and threads it forward
  as `stageData.launch_id`. Every later stage/route keys off that plain `id` — `worker.ts`'s
  `processLaunchAdStage` (past stage 0), `app/api/meta/ads/activate/route.ts` (request body is now
  `{launch_id}`, not `{campaign_id}`), `components/LaunchAd.tsx` (queries by `(campaign_id,
  angle_index)` to *find* its own launch, then acts on it by `id`). This avoids a client ever
  pre-choosing the primary key of a row only the admin client writes — a pattern nothing else in
  this codebase does and one that would need its own defensive re-check against key collisions
  across tenants.
- **The worker's `verify` stage re-checks the specific angle AND its specific creative, not just
  the campaign.** Same load-bearing pattern as Phase C (jobs' RLS only validates the row's
  `user_id`, not payload contents) — extended to check `payload.angle_index` is in range for
  `campaigns.fb_ad_angles`, and that the matching `campaign_creatives` row `(campaign_id,
  'fb_ad_angle', angle_index, creative_kind)` is `status = 'ready'`, throwing a clear error if
  either isn't true. `app/api/meta/ads/create/route.ts` does the same check for a fast 400 — same
  "route is UX nicety, worker is the boundary" split as every other job type here.
- **Video ad creation reuses the existing `retry: true` heartbeat mechanic — no new stage, no new
  pattern.** `LAUNCH_AD_STAGES` stays `["verify","campaign","adset","creative","ad"]`; the
  `creative` stage branches on `creative_kind`. The video branch is genuinely multi-step and async
  (upload the stored video bytes to Meta, wait for Meta's own transcoding, then create the video ad
  creative) — on first entry it uploads and stores `meta_video_id` in `stageData`; on every entry
  (including the first, once the id exists) it checks processing status; not-ready returns
  `{stageData, retry: true}`, which heartbeats and yields to other tenants' jobs exactly like
  `generate_creative_video`'s own `poll` stage does. **This required one real fix to the shared
  worker loop**: every other retry-capable job type's `stageData` is stable across retries (a poll
  stage just re-checks the same `operation_name`/`task_id`, persisted once at the prior stage's
  transition) — this is the first stage whose `stageData` gains real progress *during* retries
  (`meta_video_id`, once the upload completes) that must survive to the next poll. `worker.ts`'s
  `processLaunchAdStage` now persists `stage_data` even on `retry` (uniquely — the other
  `process*Stage` functions still don't, since their `stageData` doesn't need it), so the video
  upload never gets re-submitted to Meta on every ~1-minute cron re-poll.
- **The two flagged unknowns from the plan were live-verified before writing `lib/meta/client.ts`,
  not assumed** (via Meta's own Ads MCP tool schema plus direct fetches of
  `developers.facebook.com`'s current Marketing API reference, matching this project's standing
  rule for every external integration): `POST /{ad_account_id}/advideos` takes a simple `source`
  byte-form upload (same shape as `uploadAdImage`/`publishPhotoBytes`) — chunked/resumable upload
  is a separate path Meta reserves for much larger files, not needed for an ~8-second Veo clip; the
  response's id key is documented inconsistently across Meta's own pages (`id` per the `AdVideo`
  field enum, `video_id` elsewhere), so `uploadAdVideo()` reads both defensively. Processing status
  is `GET /{video_id}?fields=status` → `{video_status: "ready"|"processing"|"error",
  processing_progress}`. `object_story_spec.video_data` accepts `image_hash` for its thumbnail
  (not just `image_url`) — confirmed by two independent sources — so the thumbnail follows this
  app's existing no-hotlinking convention (content rule 9) exactly like the image-ad path, never a
  public thumbnail URL or a new serving route.
- **Thumbnail resolution is the same chain for both image ads and video-ad thumbnails**: this
  angle's own generated image first (if `status='ready'`), then the old campaign-level
  `ad_creative_image_data_url` fallback, then the vendor product photo — never a hard dependency on
  any one of them having been generated.
- **`failJob()`'s `launch_ad` branch is keyed by `launch_id` now, not `campaign_id`** — with
  multiple launches per campaign, the old `campaign_id`-only match would have flipped *every*
  launch under a campaign to `failed` on one angle's terminal error. `launch_id` comes from
  `job.stage_data` at claim time, so it's only known once stage 0 has committed — a failure during
  stage 0 itself has no row to update yet (correct no-op; the `jobs` row itself is still marked
  `error` regardless). A narrower, self-healing edge case: a failure on a later stage within the
  *same* invocation that also ran stage 0 could, in principle, use a stale in-memory `job` object
  that predates that stage 0 write — accepted as a known, narrow gap (the job record itself is
  never wrong, only the mirrored `ad_launches.status` might lag one attempt cycle), not blocking.
- **`components/LaunchAd.tsx` is now per-angle**, mounted once per angle inside
  `components/AdAnglesPanel.tsx` (folded in, not a separate component elsewhere) — it looks up its
  own launch row by `(campaign_id, angle_index)`, shows "Launch as image ad" / "Launch as video ad"
  buttons only for the kinds that have a `ready` `campaign_creatives` row, and reads/activates by
  `launch_id`. Legacy campaigns (`fb_ad_angles = null`) can't launch per-angle ads until
  regenerated — same "regenerate to upgrade" precedent as everything else gated on structured
  angles; the global campaign-level launch UI this replaced is removed outright (`ad_launches` had
  zero real rows in production at the time this shipped, confirmed before touching the schema, so
  there was nothing to migrate).
- **Not live-verified against a real Meta ad account** — this environment has no connected Meta
  ad account/page/video to exercise `uploadAdVideo`/`getVideoStatus`/`createVideoAdCreative`
  against Meta's real API, and structured ad-angle generation itself depends on a working
  Anthropic API key (see the Phase I note on this same gap). What *is* verified: `tsc --noEmit`,
  `npm run build`, `get_advisors` (clean, same shape as every prior migration), and the
  `ad_launches` upsert's find-or-create/independent-row behavior directly against the live
  database. A real end-to-end video-ad launch (paused draft → Meta Ads Manager → activate → live
  delivery) still needs to be run once a real ad account is connected — flag this to the user
  before relying on it.

## Multi-network affiliate connections (ClickBank + Digistore24)

Every product row now records which affiliate network it came from (`products.network`, `text`
check-constrained to `'clickbank' | 'digistore24'`, defaulting existing rows to `'clickbank'`),
and hoplink generation is fully generalized — `buildHoplink(network, affiliateId, vendorId, tid)`
(`lib/engine/renderPages.ts`) branches on `network` to produce the right URL shape for each
platform. This closed a real, pre-existing gap: before this, `profiles.nickname` (the ClickBank
affiliate ID baked into every hoplink) could **only ever be set via direct admin SQL** — there was
no UI or RPC for a client to set their own. Digistore24 is the second network landing on the same
foundation.

- **`network_connections` is deliberately NOT the Vault-secret pattern every other connector in
  this app uses.** `meta_connections`/`tiktok_connections`/`youtube_connections`/`mail_connections`
  store real OAuth bearer tokens in Vault behind default-deny RLS because the token itself is
  dangerous if leaked. An affiliate nickname/ID is different — it's public information embedded in
  the hoplink URL every ad visitor sees, not a secret — so this table uses plain owner-scoped RLS
  (`for all using/with check (auth.uid() = user_id)`) with **no RPC indirection**:
  `components/NetworkConnectionsPanel.tsx` writes directly via `supabase.from("network_connections")
  .upsert(...)` from the client. Never add a genuinely sensitive column to this table without
  revisiting that decision — if that ever happens, it needs the Vault pattern instead.
- **`affiliate_id` is charset-constrained at the DB layer (`^[A-Za-z0-9_.-]+$`, 1–64 chars) as
  the load-bearing half of a three-layer XSS defense**, not just input hygiene. `buildHoplink()`'s
  output is interpolated into `href="..."` in `renderBridgeHtml` (`lib/engine/renderPages.ts`) —
  served completely raw to real, unauthenticated ad traffic.
  Before this phase, `nickname` could only ever be trusted admin-set data; the moment it became
  self-service free-text, an unescaped/unencoded value here would be a real stored-XSS vector (the
  exact class of bug `lib/images/validate.ts`'s allowlist regex already exists to prevent for
  `image_data_url`). Fixed at three independent layers: the DB check constraint, `encodeURIComponent()`
  on every dynamic segment inside `buildHoplink()`, and `escapeHtml()` wrapping the hoplink at its
  three HTML interpolation points (defense-in-depth — any one layer alone would already stop this,
  all three are kept because that's this codebase's established pattern for this exact bug class).
- **A forged `network` value in a job payload does not need the same stage-0 ownership-reverify
  pattern used elsewhere** (`launch_ad`/`generate_ad_image`/`generate_video`'s `stageVerify`) —
  that pattern exists because `jobs`' RLS only validates the row's `user_id`, not payload contents
  shaped like a *reference to another tenant's row* (`campaign_id`, `page_id`). `network` isn't a
  cross-tenant reference; it's an enum selecting behavior for the calling tenant's own job. What it
  *does* need, and gets in `lib/engine/worker.ts`'s `processDiscover`/`processBuildCampaignStage`:
  validate the value against the known set (fail clearly on garbage, never silently fall through to
  ClickBank behavior), and check `network_connections` has a row for `(job.user_id, network)` before
  doing real work — `getAffiliateId()` throws a clear error otherwise. This replaced the old
  `getNickname()`'s silent `"YOURNICK"` fallback, which was tolerable when nickname was rare-to-be-
  unset admin data and isn't once it's self-service and commonly unset at first login. Two layers,
  same trust-boundary split as every other job type here: the API route
  (`app/api/jobs/route.ts`/`app/api/promote/route.ts`) checks first for a fast, clear 400; the
  worker re-checks as belt-and-suspenders against a direct-insert bypass.
- **A real, pre-existing, unrelated IDOR-shaped gap got bundled into this same change**:
  `processBuildCampaignStage`'s product `SELECT` had no `user_id` filter, so a forged
  `payload.product_id` could let one tenant's `build_campaign` job read (and spend that tenant's
  own Anthropic usage generating a full content kit from) another tenant's private product row — a
  content-disclosure bug, not a write-side one. Fixed by scoping the SELECT to
  `.eq("user_id", job.user_id)`, same as every other job type's payload-reference re-check. Caught
  and confirmed live: the still-deployed pre-fix Vercel instance raced a local test job via its own
  `pg_cron` backstop and genuinely built a cross-tenant campaign before this fix reached
  production — see the note on that race below.
- **Automated marketplace discovery exists only for ClickBank today.** `lib/engine/discover.ts`'s
  `runDiscoverProducts` is still ClickBank-specific (`searchMarketplace` from `lib/engine/
  clickbank.ts`); a `digistore24` value is accepted by the network-validation layer but explicitly
  rejected with a clear "not available yet" error rather than silently no-op'ing. Digistore24's own
  marketplace-search API shape is unconfirmed — `api.digistore24.com`'s documented endpoints
  (`GET /products/{id}`, `GET /orders`, ...) look vendor-side (managing your own listings), not an
  affiliate-side bulk browse/search endpoint, and `dev.digistore24.com`'s full reference blocks
  automated fetches (same class of bot-protection ClickBank's WAF had). This needs a live
  verification spike — try a realistic-browser-UA fetch first, the same approach that turned out to
  work for ClickBank — before writing any discovery code against it, not an assumption. Connect
  (Affiliate ID) + manual product entry + full content-kit generation for Digistore24 is real,
  buildable work independent of that spike and not blocked on it.

## Lead capture (Contacts)

Every bridge page's opt-in form now saves real leads. Schema in
`supabase/migrations/0017_contacts.sql`; write endpoint at `app/api/public/leads/route.ts`; read
UI at `app/(app)/contacts/page.tsx` + `components/ContactsTable.tsx`. This is genuinely new
ground for this codebase in two ways: `contacts` is the **first table that stores a third
party's PII** (a tenant's own site visitor, not the tenant's own data), and `/api/public/leads`
is this app's **first-ever anonymous, unauthenticated write** — every prior public route is a
GET, and every prior write from an unauthenticated caller is a signature-verified webhook
(Stripe, Meta's deauthorize). A campaign UUID plus server-side validation is a meaningfully
weaker trust boundary than an HMAC check, and the design below treats that as the central risk to
manage, not an afterthought.

- **`user_id` comes only from the campaign row, never from the request body.** There is no
  client-suppliable tenant field anywhere in this endpoint's input shape, and there must never be
  one added later — the campaign lookup (`.eq("id", campaign_id).eq("status", "ready")`,
  identical scoping to `servePublicCampaignPage`) is what derives ownership. Not found / not
  `ready` returns a **generic 404** — the same enumeration-oracle concern every other public route
  already guards (guessing valid campaign UUIDs), now reachable via a new verb (POST) that must
  stay just as generic as the existing GETs.
- **Two independent, cheap per-campaign abuse caps**, mirroring the `generate-video` route's
  `MAX_VIDEO_GENERATIONS_PER_DAY` idiom: a burst cap (20 submissions per campaign per 10 minutes)
  and a daily cap (300 per campaign per 24h). Either exceeded → **silently drop, still `200 OK`**
  — a capped submission must be invisible to the real visitor (this is paid ad traffic; losing a
  lead-save is far cheaper than losing a conversion on a dead-end page), and only blocks what's
  very likely spam. Deliberately per-campaign, not per-IP: a valid, `ready` campaign UUID is
  already this app's entire access-control model for every public route in existence, so
  per-campaign scoping is consistent defense-in-depth with that model, not a weaker substitute.
- **No CAPTCHA, no IP-based rate limiting, no email-deliverability verification, no moderation
  queue** — explicitly deferred v1 decisions, not silent gaps (zero rate-limiting infrastructure
  exists anywhere else in this codebase to build on). Also explicitly deferred: a per-lead delete
  path for a GDPR/CCPA-style erasure request — v1 is view + export only, a real gap for a table
  holding third-party PII for the first time here.
- **De-dupe is a plain `(campaign_id, email)` unique index, not `lower(email)` or a partial
  `WHERE`.** Both of those shapes are conflict targets `supabase-js`'s `.upsert({onConflict})`
  cannot express — PostgREST only accepts a plain, non-partial column-list unique
  index/constraint. Case-insensitive de-dupe is achieved by normalizing `email` to lowercase in
  application code (`app/api/public/leads/route.ts`) before every insert instead. No `WHERE`
  predicate is needed either: standard SQL never treats `NULL = NULL` as true in a uniqueness
  check, so rows that survive a campaign delete (`contacts.campaign_id on delete set null`)
  already coexist freely under a plain unique index. If a future migration ever needs a
  functional or partial de-dupe index here, it cannot be targeted by a bare `.upsert({onConflict})`
  call — raw SQL (`on conflict (...) do nothing` in a `execute_sql`-applied function, or a
  hand-written `INSERT ... ON CONFLICT`) would be required instead.
- **`contacts.campaign_id` is `on delete set null`, not cascade** — deliberate, matches
  `meta_posts` (audit-log-shaped: history worth keeping even after the source campaign is gone),
  not `ad_launches`/`custom_domain_routes` (operational config correctly tied to the campaign's
  existence). A captured lead is a real person the tenant may still want to export/email after
  archiving the campaign that captured them.
- **RLS is owner-`select` only, same shape as `meta_posts`/`instagram_posts`** — no client write
  policy at all (`revoke insert, update, delete ... from anon, authenticated`). The trust model
  differs from those tables (this PII describes a third party, not an action the tenant took),
  but the RLS story doesn't change: the only legitimate writer is `/api/public/leads`, running on
  the admin client from a caller with no `auth.uid()` at all — never an authenticated tenant's own
  browser session.
- **A real bug this design surfaced, not something deferred**: `middleware.ts`'s host-mismatch
  rewrite (for BYO custom domains, see "Custom domains" above) used to rewrite *any* non-own-host
  path except `/_next` to `/d${pathname}`, unconditionally — including API paths. A bridge page
  served under a tenant's custom domain runs its lead-capture `fetch('/api/public/leads', ...)`
  from that domain's own origin, which would otherwise get rewritten to `/d/api/public/leads`,
  match no `custom_domain_routes` entry, and 404 — lead capture would silently fail for every
  tenant using a custom domain. `/api/public/` is now exempt from that rewrite (every route under
  it already does its own campaign-scoped authorization and is safe to resolve regardless of the
  arriving `Host`, the same reasoning as the existing `/_next` exemption), and
  `"/api/public/leads"` is in `PUBLIC_PREFIX_PATHS`. Live-verified through both `/p/[campaignId]/
  bridge` and a direct POST simulating custom-domain traffic — not assumed to work from the code
  alone.
- **No collision with the existing marketing `/contact` page** — that's a visitor contacting the
  SaaS operator (ClickBank Studio itself), a completely different context from a tenant's own ad
  visitor submitting a bridge page's opt-in form. `contacts` (the table/nav entry) and `/contact`
  (the marketing page) are unrelated on purpose; don't conflate them when extending either.
- **`ContactsTable.tsx` is `"use client"`, a deliberate deviation from `AuditTrail.tsx`'s
  server-rendered shape** — justified by the two v1 actions that are the actual reason to have
  this page at all (exporting leads into an ESP): per-row **Copy email** and header-level
  **Export CSV**, built client-side from the already-fetched array with a real CSV-field-escaping
  helper (quotes fields containing commas/quotes/newlines — a naive `.join(",")` would corrupt any
  name containing a comma). The page query caps at `.limit(1000)` — leads can accumulate fast from
  real paid traffic, unlike audit-trail rows throttled by human posting cadence, so this doesn't
  safely generalize to audit's fetch-all pattern. Full pagination/search/date-filter is an
  explicit deferred v2, not silently absent.

## shadcn/ui + 21st.dev components

First use of shadcn/ui in this codebase (everything before this was hand-rolled Tailwind classes —
`.card`/`.chip`/`.btn-*`/`.data-table` in `app/globals.css`, still the primary system for existing
UI). Added so components sourced from 21st.dev's registry (`components/ui/*`) can drop in without
per-component recoloring:

- `components.json` — `cssVariables: true`. The semantic tokens (`background`, `card`, `primary`,
  `border`, etc.) are **not** shadcn's default slate/zinc — they're hand-mapped in
  `app/globals.css`'s `:root` block to this app's actual `ink-*` scale and emerald accent (exact
  HSL conversions of the real hex values already in `tailwind.config.ts`). This app is dark-only
  (no light variant), so there's only one set of values, no `.dark` class toggle.
- `lib/utils.ts` (`cn()`) and `tailwind.config.ts`'s semantic color/`borderRadius` additions +
  `tailwindcss-animate` plugin are the other two pieces every shadcn component assumes exist.
  The pre-existing `ink` color scale is untouched — new shadcn-based components use the semantic
  tokens (`bg-card`, `border`, etc.), existing hand-rolled components keep using `ink-*` directly;
  both coexist without conflict.
- First component installed this way: `components/ui/data-table-filter.tsx` (from 21st.dev's
  `@uniquesonu/data-table-filter`, plus its registry deps — `button`/`popover`/`command`/`dialog`/
  `separator` in `components/ui/`) — replaced the dashboard's old single-select status pill row
  (`app/(app)/dashboard/page.tsx`) with a proper multi-select filter popover.
- To pull in another 21st.dev component going forward: search/fetch via the 21st.dev MCP
  connector (registered at `local` scope for this project directory via `claude mcp add-json`,
  separate from the pre-existing claude.ai-connector version of the same service), write its
  source + registry dependencies into `components/ui/`, and its `npm` dependencies via `npm
  install` — the CSS variable mapping above means no manual re-theming should be needed for
  components that use standard shadcn semantic classes.

## Broadcast (drip sequences)

Full autoresponder/drip-sequence email feature — a client picks an audience (a specific
campaign's contacts, all contacts, or a manually chosen subset) and a named sequence of N steps,
each firing `delay_days` after that **contact's own** enrollment (standard ESP semantics — "day 3
after this contact signed up", never a shared calendar date). Reuses the existing `jobs`/
`claim_job()`/`worker.ts` engine unchanged.

- **`claim_job()` has no time-gating** — any pending job is immediately claimable. A step that
  isn't due yet must therefore never become a `jobs` row. `broadcast_enrollment_steps.due_at` is
  the real precomputed timestamp that keeps this a non-issue: nothing inserts a `jobs` row from
  that table until `run_broadcast_sweep()` (`supabase/migrations/0021_broadcast.sql`) finds
  `status='pending' and due_at <= now()` — a narrow, additive `pg_cron` backstop
  (`broadcast-sweep-backstop`, every 1 minute, same shape as `domains-reverify-backstop`), not a
  change to the shared engine. Cron registration (like `engine_webhook_url`) is applied via
  `execute_sql`, never committed to a migration or git.
- **New contacts are enrolled by the same sweep**, not a write into
  `app/api/public/leads/route.ts` — that route is this codebase's hardest-to-get-right trust
  boundary (anonymous, unauthenticated, rate-capped); a 1-minute sweep delivers enrollment close
  enough to instant without raising that route's blast radius.
- **`enroll_broadcast_sequence_contacts(p_sequence_id)`** is the one function that both
  `activate_broadcast_sequence()`'s retroactive pass and every sweep tick's continuous pass call
  — idempotent (`unique(sequence_id, contact_id)` + `ON CONFLICT DO NOTHING`), so double-calling
  it (activation racing a sweep tick, or two sweep ticks racing each other) is always safe. A
  `campaign_id`-scoped sequence whose campaign gets deleted fails safe automatically (no CHECK
  constraint couples `audience_type='campaign'` to a non-null `campaign_id` — that would break
  campaign deletion; `c.campaign_id = seq.campaign_id` simply never matches a NULL).
- **Unsubscribe is global per contact** (`contacts.unsubscribed_at`), not per-sequence. The
  unsubscribe link (`GET /api/public/unsubscribe?token=<contacts.unsub_token>` — a *second*,
  dedicated unguessable column, never `contacts.id` itself) is code-owned
  (`lib/engine/broadcastEmail.ts`'s `renderUnsubscribeFooterHtml()`) and appended to every sent
  email, same non-negotiable-compliance-text treatment as `DISCLOSURE`/`LEAD_CONSENT_TEXT` in
  `renderPages.ts` — never exposed as an editable field in the step editor. **GET, not POST/RPC**
  — a deliberate exception to this codebase's usual write-via-POST/RPC rule, since the link must
  work as a bare `<a href>` inside an email client with zero JS; the only possible harm from a
  forged/prefetched GET is an unwanted unsubscribe of that same contact. The route eagerly flips
  `broadcast_enrollments`/`broadcast_enrollment_steps` too, purely so the UI's stats don't lag —
  **not** the security boundary; `lib/engine/broadcast.ts`'s `verify` stage re-checks
  `unsubscribed_at` unconditionally right before every send regardless.
- **`send_broadcast_email` job** (`lib/engine/broadcast.ts`, stages `["verify","send"]`, payload
  `{enrollment_step_id}`) — same stage-0 ownership-reverify pattern as every other job type (jobs'
  RLS only validates the row's own `user_id`, not payload contents; `verify` re-scopes every hop —
  enrollment step → enrollment → sequence/step → contact — to `job.user_id`). `verify` also
  handles the unsubscribed-since-queued case (`skip: true`, applies `status='skipped'`, worker
  marks the job done without ever reaching `send`) and a defensive rate-cap re-check (`retry:
  true`, reusing the existing `heartbeatRetry()` mechanic — the sweep's own admission control is
  the primary gate, this covers the narrow race window between that check and the job running).
  `failJob()` mirrors terminal failure onto `broadcast_enrollment_steps.status='failed'`, the
  `ad_launches`/`campaign_creatives` convention.
- **Rate cap is pooled across `mail_sends` + `broadcast_sends`, and provider-aware** — it exists
  to protect a personal mailbox from being flagged (Gmail's free tier is ~500/day; 300/day is the
  nominal headroom figure). Since `0027_provider_aware_send_cap.sql`, the shared
  `is_capped_mail_sender(user_id)` SQL function decides whether it applies: `true` for Gmail OAuth
  (and for a generic SMTP connection pointed at a Gmail/Yahoo host — same personal-mailbox risk,
  and the fail-safe default when the host is unknown), `false` for Resend/SendGrid/Mailgun and
  non-personal SMTP, which are governed by their own plan limits instead. Both enforcement layers
  consult it: `run_broadcast_sweep()`'s admission control (uncapped senders get an effectively
  unlimited claim batch) and `lib/engine/broadcast.ts`'s defensive re-check (skipped entirely for
  uncapped senders; an RPC error fails safe to capped). Verified live: gmail → capped,
  resend → uncapped.
- **`getValidMailAccessToken()`** (`lib/google/mailToken.ts`) is the Gmail refresh-or-fetch dance
  (2-minute-early threshold, store-new-then-delete-old Vault hygiene, `needs_reconnect` flip on
  failure), extracted out of `app/api/mail/send/route.ts` (which now calls it, behavior-preserving)
  so the new job stage can reuse it too — this would otherwise have been the fifth independent
  copy of this exact logic in the codebase.
- **Pre-existing, unrelated bug found while building this** (not fixed here):
  `app/api/domains/reverify-all/route.ts` is missing from `middleware.ts`'s
  `PUBLIC_PREFIX_PATHS` — since it's called by an unauthenticated `pg_net` POST, the auth-gate
  likely redirects it to `/login` before the handler runs, meaning `domains-reverify-backstop`'s
  cron tick has probably been silently failing since it shipped. `/api/broadcast/sweep` is added
  to `PUBLIC_PREFIX_PATHS` explicitly so it doesn't repeat the mistake; the `reverify-all` gap is
  a separate, still-open follow-up.
- **UI**: `/broadcast` (list, `components/BroadcastSequenceList.tsx`) → `/broadcast/[id]`
  (detail/editor — `BroadcastSequenceForm.tsx` for name/audience while `draft`,
  `BroadcastStepsEditor.tsx` for steps while `draft`/`paused`, `BroadcastContactPicker.tsx` for
  the manual-audience case, `BroadcastActivateControl.tsx` for lifecycle + live stats, gated on
  Gmail connection status the same way `LaunchAd.tsx` gates on `bridgePublished`). All reads go
  directly through the browser Supabase client against each table's owner-select RLS policy (same
  pattern as `CreativeItemCard.tsx`); all writes go through the narrow RPCs in
  `0021_broadcast.sql` — no wrapping Next.js routes for CRUD, matching `add_domain_route`/
  `claim_campaign_creative`'s precedent of RPC-only writes when there's no external side effect.
- **Not included**: no retroactive re-scheduling when a sequence's steps are edited after
  contacts are already enrolled (existing enrollments keep the schedule frozen in at their own
  `enrolled_at`); no per-sequence unsubscribe scope (global per contact only); no CAPTCHA/IP-based
  abuse protection on the unsubscribe endpoint (same accepted v1 gap as `/api/public/leads`); no
  manual "send this step now" override or drag-and-drop step reordering.

## Blog (sidebar)

Tenant blog manager (`/blog`) — posts written from scratch or imported from a campaign's
generated `blog_md` (importing COPIES the markdown into a `blog_posts` row; `campaigns.blog_md`
itself is never modified), organized into user-created categories, published at a public per-post
URL.

- **Schema** (`supabase/migrations/0030_blog.sql`): `blog_categories` (`unique(user_id, name)`),
  `blog_posts` (`campaign_id` on-delete-set-null history pointer, `category_id`
  on-delete-set-null so deleting a category keeps its posts, `status` draft/published,
  `published_at`). Owner-select RLS, writes via the `/api/blog/*` routes on the admin client
  only — same shape as every domain table since 0009.
- **Public serving** (`app/b/[postId]/route.ts`): same access model as `/p/{campaignId}` — the
  post UUID + `status='published'` scoping is the access control, generic 404 for
  draft/nonexistent. Deliberately **no `X-Robots-Tag: noindex`** (unlike funnel pages): blog
  posts are content marketing and should be crawlable. `/b/` is in `PUBLIC_PREFIX_PATHS`.
- **XSS boundary — render-time, not save-time** (`lib/blog.ts`): post content is arbitrary
  tenant-edited markdown served raw to anonymous visitors on the app's shared origin, and
  `marked` passes embedded HTML straight through by design. `renderPostContentHtml()` escapes
  `&` and `<` in the source BEFORE parsing — disables every raw-HTML construct while leaving real
  markdown intact. The editor's preview (`components/BlogPostEditor.tsx`) applies the identical
  pre-escaping so preview always matches the published page. Verified live: `<script>`/`onerror`
  probes render as inert escaped text, bold/links render normally. Never replace this with a
  "sanitize later" approach without a real sanitizer.
- **Import** (`POST /api/blog/posts` with `campaign_id`): RLS-scoped campaign read doubles as the
  ownership check; the post title comes from `blog_md`'s first `# H1` (falling back to
  "<product> review").
- **UI**: `components/BlogManager.tsx` (category chips with inline create/delete + filter, posts
  list, import dropdown of campaigns with `blog_md`), `components/BlogPostEditor.tsx`
  (title/category, Write↔Preview markdown editor, Save, Publish/Unpublish — publishing always
  saves current edits first — live-URL bar with copy). Note: the editor's public-URL origin is
  applied post-mount via `useEffect` — reading `window.location` during render was a real
  hydration mismatch caught live.
- **Deferred, explicitly**: no public blog index/archive page (per-post URLs only — no tenant
  enumeration surface), no custom-domain serving for posts (`custom_domain_routes` still maps
  funnel pages only), no SEO slugs in the URL.

## Freeform block-based page builder (Phase O — complete, all 5 sub-phases landed)

Replaces the fixed-field bridge/funnel-step content model (headline/lead/mechanism/benefits/
proof/faq/cta) with a true Elementor-style block tree: sections containing rows/columns containing
elements (heading, subheading, paragraph, image, bullet list, icon list, divider, image list,
button, FAQ item), each with full custom styling, plus a lead-capture form that accepts real
user-added fields. This was a multi-week rebuild that landed in five sub-phases (see
`/Users/macbookpro/.claude/plans/binary-stirring-brooks.md`'s "Phase O" for the full design) —
the schema/renderer (O.1), the validator + rewritten PATCH routes +
a tree-aware top-level editor (O.2), nested drag-and-drop + a full element palette +
Row/Column insertion (O.3), the per-block style panel (O.4), and now real form-input backend
wiring (O.5) — dragging a `form_input` block into the lead-capture form produces a genuinely
saved, exportable field, not a decorative one.

- **`lib/engine/blockTree.ts`** (new) defines the block-tree schema (`PageBlockTree`,
  `SectionBlock`/`RowBlock`/`ColumnBlock`/`ElementBlock`/`LockedBlock`/`FormInputBlock`) and
  `renderBlockTree(tree, ctx)`, a recursive walker producing a body-fragment HTML string.
  Zero dependency on `renderPages.ts` (one-directional: `renderPages.ts` depends on `blockTree.ts`,
  never the reverse) — `escapeHtml()` now lives here and is re-exported from `renderPages.ts` so
  every existing importer (`lib/engine/broadcastEmail.ts`, etc.) is unaffected.
- **Style values are structured, never raw CSS** — `BlockStyle` only holds enums/numbers/hex-color
  strings; `styleToInlineCss()` is the single choke point every value passes through on its way
  into an HTML `style="..."` attribute, via a fixed per-key table with its own range/regex checks
  (defensive — the real validation is `validatePageBlockTree.ts`, landing in sub-phase 2). This is
  what makes "full custom styling per element" safe: there is no code path from stored style data
  to rendered HTML that concatenates attacker-influenceable text, closing off CSS-injection risk by
  construction rather than by sanitization — same defense-in-depth instinct as the hoplink's
  three-layer XSS fix and `image_data_url`'s anchored regex.
- **Icons are a curated, bounded set** (`ICON_SVG_PATHS`/`ALLOWED_ICON_NAMES` in `blockTree.ts`),
  not the full lucide-react catalog — hand-authored inline SVG, since `renderPages.ts` is a pure
  isomorphic string-builder (no `react-dom/server`, so lucide-react components can't be rendered to
  a string directly). The same map doubles as the eventual validator's icon allowlist — a stored
  `icon_list` item's `icon` value that isn't a key here is never rendered (falls back to nothing),
  closing off using user input as a lookup key into anything that could execute or fetch.
- **Locked (compliance-critical) blocks**: `disclosure`, `lead_capture_form` (a container whose
  fixed name/email inputs are NOT tree nodes — always rendered first by `renderBlockTree`'s own
  case, so "email field deleted" is structurally impossible, not just UI-prevented), `primary_cta`
  (destination still resolved via the existing `cta_action`/`redirect_url`/hoplink logic, now read
  from `RenderCtx` instead of a baked function param), and `decline_link` (funnel-step upsell's
  "No thanks, continue," same locked-href/editable-text shape as `primary_cta` — a 4th locked kind
  beyond the 3 originally named, needed for feature parity). All four are draggable to reposition
  among root-level siblings, never deletable, core content/wiring never editable — enforced
  structurally (fixed form inputs) or by the validator (everything else, sub-phase 2).
- **`normalizePageCopy(raw, imageDataUrl, opts?)`** (`renderPages.ts`) is the **permanent** adapter
  from the legacy flat shape into a block tree — not a one-time migration shim. Pure, deterministic
  (sequential `legacy-N` ids, reset per call — same input always produces the same output),
  idempotent on already-normalized input (`version === 2` passes through unchanged, verified by
  reference-equality in an isolated test). `renderBridgeHtml`/`renderFunnelStepHtml` call it
  internally as their first line and their `copy` parameter widened from `PageCopy` to `unknown` —
  every existing render-path caller (`lib/funnelSteps.ts`'s `rerenderFunnelSequence`, all three
  PATCH routes) gets legacy-compat for free, no per-call-site auditing needed for rendering.
  `lib/engine/build.ts`'s `stagePages` additionally calls it explicitly before persisting, so newly
  built campaigns store version-2 `page_copy` from day one rather than relying on read-time
  normalization forever.
- **The Anthropic structured-output schema in `stagePages` is unchanged and stays that way
  permanently** — retraining the LLM's JSON schema to emit a full block tree is a separate, much
  larger prompt-engineering effort, explicitly out of scope. `PageCopy`/`SECTION_KEYS`/
  `resolveSectionOrder` in `renderPages.ts` stay forever as the "AI authoring schema," with
  `normalizePageCopy` as the permanent translation layer — never remove either half of this pair.
- **Legacy-content mapping** (see `normalizePageCopy`'s implementation for the exact per-field
  logic): `headline` becomes a regular draggable/editable heading block instead of being fixed
  outside the content list — a real capability upgrade; each `faq` entry becomes its own atomic
  `faq_item` block (not decomposed into loose heading/paragraph pairs) specifically so future
  nested drag-and-drop can never split a question from its answer; the lead paragraph's `style` is
  seeded with the exact `{fontSize:18, color:"#333333"}` the old `.lead` CSS class provided, so
  visual output stays equivalent even though the underlying HTML is no longer byte-identical (a
  `<div class="section">` wrapper and inline `style` attributes are now unavoidably present — this
  phase's verification is "visually/functionally equivalent," not literal byte-for-byte HTML, which
  stopped being achievable the moment the render architecture changed).
- **Flagged, real behavior change**: the pre-Phase-O bridge page hid the *entire* step-1 subtree
  (headline + all content + form) and revealed a *duplicate* step-2 subtree (headline again + CTA)
  after a successful submit. The new renderer only toggles the `lead_capture_form` block (hides,
  via `form.parentElement.classList.add('hidden')` in the inline submit script) and the
  `primary_cta` block's `#step2` wrapper (unhides) — every other block (headings, images, other
  sections) stays visible throughout. Simpler against a single flat tree, arguably better UX
  (advertorial content doesn't vanish), verified live against the real TedsWoodworking campaign.
- **The submit-handler script now collects fields generically** (`querySelectorAll('[name]')`,
  splitting `first_name`/`email` from everything else into `payload.extra_fields`) instead of
  reading `#leadFirstName`/`#leadEmail` by hardcoded id — laying groundwork for sub-phase 5's real
  form-input fields. `app/api/public/leads/route.ts` doesn't read `extra_fields` yet (harmless
  extra JSON key, ignored) — wiring that up is explicitly sub-phase 5, not this one.
- **`lib/engine/validatePageBlockTree.ts`** (new) is now the real server-side validation boundary —
  all three PATCH routes (`app/api/campaigns/[id]/page-copy/route.ts`,
  `app/api/bridge-variants/[id]/route.ts`, `app/api/funnel-steps/[id]/route.ts`) call
  `validatePageBlockTree(body, {pageKind, stepType?})` and persist `result.tree` instead of the old
  flat-field clamp logic. Recursive walk with hard structural rejection (unknown block type, wrong
  locked-block placement, depth >4, too many blocks) vs. soft clamping (over-length text truncated,
  out-of-range style numbers clamped, invalid colors dropped) — mirrors this codebase's established
  "clamp long input, hard-reject structural tampering" split. `extractLeadFormFields(tree)` is
  exported for sub-phase 5's leads-route use but not called yet. `isValidRedirectUrl` was promoted
  from `app/api/funnel-steps/[id]/route.ts` into `lib/validate.ts` (now needed in 3 places: funnel
  redirects + a `button` block's href). The funnel-steps route fetches the step's `step_type` from
  the DB *before* validating, since the locked-block requirements differ by step type (a
  `decline_link` is only required for `upsell` steps).
- **The editor is now tree-aware, but only at the top level — nested drag-and-drop is sub-phase 3,
  not this one.** `components/WysiwygCanvas.tsx` was rewritten to edit a `PageBlockTree` directly
  instead of the old flat `PageCopy`: the same mount-once-then-blur-commit `EditableText` pattern
  (unchanged — still the load-bearing fix for the React+contentEditable cursor-jump bug);
  `RootBlockWrapper` provides drag-to-reorder for **root-level blocks only** (Sections and the 4
  locked blocks), reusing the existing single-level dnd-kit wiring — dragging an element between
  columns, or a row in/out of a section, doesn't exist yet. Per-image-block upload/replace/remove
  controls replace the old single "hero image" concept (`firstImageDataUrl(tree)` derives the
  `embedded_image_data_url` column value automatically). A new **device-preview toggle**
  (Desktop/Tablet/Mobile icons, `DEVICE_WIDTHS = {desktop:680, tablet:480, mobile:360}`) is a
  purely client-side preview aid with zero effect on saved data or real rendering.
- **`components/PageEditor.tsx`/`components/FunnelStepEditor.tsx`** now hold `PageBlockTree` state
  (`useState(() => normalizePageCopy(initialCopy, null, ...))`) and save
  `{blocks: tree.blocks, image_data_url: firstImageDataUrl(tree)}` — no separate image-upload UI
  section anymore, all image editing is in-canvas, per-block.
- **`lib/shared.ts`**: `Campaign.page_copy` is now typed `PageBlockTree | Record<string, unknown> |
  null` (was a hand-duplicated inline flat-shape object) — documented as opaque, since a row could
  be legacy or version-2 shape depending on when it was last saved. `lib/funnelSteps.ts`'s
  `FunnelStepRow.page_copy` is `unknown`; the 3 `as PageCopy` casts at
  `renderBridgeHtml`/`renderFunnelStepHtml` call sites are gone (no longer needed since those
  functions accept `unknown`, per O.1).
- **A real functional gap was caught and fixed during O.2's own browser verification, not from
  user feedback**: the rewritten canvas initially had no way to add/remove FAQ items, since
  `faq_item` is a discrete block per entry now, not an array field like `benefits` — unlike the old
  editor, which had "+ Add"/remove for FAQ pairs. Fixed at the time by a FAQ-specific remove (X)
  button and "+ Add FAQ item" control. **Both are superseded in O.3** by the generic per-block
  delete (every element, not just FAQ items, now gets a delete affordance) and the general
  "+ Add block" palette (FAQ item is just one of its 10 entries) — see below; the FAQ-specific code
  path no longer exists.

### O.3: nested drag-and-drop + full element palette + Row/Column insertion

- **Modeled as multiple dnd-kit sortable containers under one `DndContext`, not one globally-
  flattened indented list.** This schema's containment is already a fixed, shallow shape (root ->
  section-child -> column-child, 3 levels) — a per-container-array design (the standard dnd-kit
  "multiple containers" pattern: one container for root, one per Section body, one per Column body)
  is simpler to reason about and less failure-prone than generic indentation/depth-projection math
  (dnd-kit's "sortable tree" example), which was the plan doc's original sketch but turned out not
  to fit this shape as well once actually building it. `lib/engine/blockTree.ts` gained the pure
  data-layer half: `ContainerRef` (`{kind:"root"}` / `{kind:"section",sectionId}` /
  `{kind:"column",rowId,colIndex}`), `containerKey()`/`parseContainerKey()` (string round-trip,
  used as the literal dnd-kit droppable/container id), `findBlockLocation(tree, blockId)` (locates
  any block anywhere + which container it's in), `moveBlockToContainer(tree, blockId, toRef,
  toIndex)` (the actual move — removes from its old container, inserts into the new one, adjusts
  the target index the same way `arrayMove` does for a same-container reorder), `insertElement()`/
  `insertRow()` (used by the palette). All pure, all tested via an isolated script before any UI
  code was written (22 assertions: locate-in-column/section/root, move between two columns, move
  out of a row entirely, move a Row within its section, insert a Row/element at a specific index,
  and — the structural-safety cases — a locked block or a Row can never be moved somewhere the
  schema forbids, verified as true no-ops that return the exact original tree reference unchanged).
- **Type-position compatibility is enforced in `moveBlockToContainer` itself, not just the UI** —
  a locked block or a Section can only ever target `{kind:"root"}`; a Row can only ever target
  `{kind:"section", ...}` (any section, not just its originating one — nothing in the schema ties a
  Row to one section, so cross-section Row moves are allowed); an `ElementBlock` can target a
  Section (sitting directly alongside Rows, matching `SectionBlock.children`'s real shape) or a
  Column, never root. An incompatible move is a silent no-op (returns the tree by the same object
  reference) — this is NOT the security boundary (`validatePageBlockTree.ts` still is, unchanged),
  it just keeps the client from producing an obviously-invalid tree mid-drag.
- **`components/WysiwygCanvas.tsx`**: `NestedItemWrapper` (drag handle + delete, hover-revealed,
  top-left) now wraps every Row and every Element below root — module-scope, not a nested function
  defined inside `WysiwygCanvas`'s own body, which matters here specifically: an inline nested
  component definition gets a fresh function identity on every re-render (which happens on nearly
  every edit, since `tree` changes on every commit), forcing React to unmount/remount that whole
  subtree each time — breaking `EditableText`'s mount-once pattern and any transient UI state
  (like a palette's own open/closed toggle) beneath it. `SectionBody`/`RowEditor`/`ColumnEditor` are
  the three container components (each calls `useDroppable`/`SortableContext` with its own
  `containerKey()`), same module-scope-component discipline, taking `tree`-derived data and
  callbacks as explicit props rather than closing over `tree`/`onChange` directly.
  `handleDragEnd` branches once on whether `active.id` is a root block (existing O.2 behavior,
  unchanged) or something nested (resolves `over.id` — either another block's id, via
  `findBlockLocation`, or a container's own droppable id via `parseContainerKey`, meaning "dropped
  on empty space inside this container, append at the end" — `moveBlockToContainer` clamps the
  index internally either way) then calls `moveBlockToContainer`.
- **`AddBlockMenu`** ("+ Add block") is mounted at the end of every Section body and every Column
  body — Section-level menus additionally get a "Row" sub-section (1/2/3-col buttons, fixed presets
  per the confirmed decision, no drag-to-resize) that Column-level menus never show (columns can't
  contain rows — no code path exists for it, matching `ColumnBlock.children: ElementBlock[]`).
  Below that, all 10 `ElementBlock` types with an icon (from the existing `lucide-react` dependency)
  and label — clicking one calls `insertElement`/`insertRow`, always appending at the end of that
  specific container (inserting mid-list is a real, deliberate v1 scope cut — drag-reorder after
  inserting covers it, same "append then reorder" precedent the pre-O.3 editor already used for
  "+ Add FAQ item"/"+ Add benefit").
- **Real end-to-end verification, live against TedsWoodworking** (`e2ce68bb-8fca-4917-9653-
  9879911396fc`): inserted a real 2-column Row via the UI, added a Heading into one column via the
  palette, confirmed the drag-handle/delete controls render correctly on hover, deleted the
  element then the row via those controls, back to the exact original state — all via real clicks
  (`computer`/`javascript_tool`), no console errors at any point. Separately, a direct
  `PATCH .../page-copy` round-trip (bypassing click-simulation) confirmed the Row/Column shape
  itself survives `validatePageBlockTree` and `renderBlockTree` correctly (`<div class="row">` /
  `<div class="col">` markup present, both column's content rendered), then reverted the DB row to
  its exact original content (confirmed via `jsonb_array_length` — 4 root blocks, 12 section
  children, matching pre-test) — same "edit through the real path, verify, restore" discipline used
  throughout this project.
- **Explicitly NOT verified: real mouse-drag gestures themselves.** This session's tooling cannot
  reliably simulate a dnd-kit pointer-drag (confirmed earlier in this same project, unrelated to
  this feature) — every check above exercises clicks (palette, delete) and the data layer
  (`moveBlockToContainer` unit tests + a direct API round-trip), not an actual drag-and-drop
  gesture end-to-end through the browser. The underlying move logic is verified correct in
  isolation; the drag *interaction* itself (picking up a block, hovering a different container,
  dropping) has not been. **Recommend a manual pass** before relying on this in production: drag an
  element between two columns, drag an element out of a row entirely into its section, attempt to
  drag a locked block into a column (should refuse to nest), drag a whole Row to reposition
  relative to another block in its section.
### O.4: per-block style panel

- **`STYLE_KEYS_BY_TYPE`** (new, `lib/engine/blockTree.ts`) is the single source of truth for
  "which style keys actually do anything for this block type" — a `Record<BlockType,
  readonly (keyof BlockStyle)[]>` built from the same `TEXT_STYLE_KEYS`/`BOX_STYLE_KEYS`/
  `BUTTON_STYLE_KEYS`/`DIVIDER_STYLE_KEYS` arrays the renderer's own `styleAttr()` calls already
  used (now exported instead of module-private; the two previously-duplicate `HEADING_STYLE_KEYS`/
  `TEXT_STYLE_KEYS` consts — confirmed byte-identical — were consolidated into one). Both
  `components/BlockStylePanel.tsx` and the renderer consume this exact table, so a control can
  never appear in the panel unless setting it would actually change the published page.
- **`components/BlockStylePanel.tsx`** (new) — `{block, onChange, onClose}`. Four control groups
  (Typography/Background/Spacing/Border/Layout — only the ones relevant to `block.type` render),
  built from three small primitives (`NumberField`, `ColorField`, plus inline align/font-weight/
  font-family selects) that clamp client-side for UX only; `validatePageBlockTree.ts` on save is
  unchanged and remains the real boundary. Renders `null` if the selected block's type has no
  stylable keys at all (none currently do, but this keeps the component honest if one is ever
  added). `STYLE_KEYS_BY_TYPE` deliberately has no `form_input` entry — form fields are never
  independently selectable/stylable, they only ever render inside the lead-capture form's fixed
  layout — so the `Record` type is `Exclude<BlockType, "form_input">`, making a missing case a
  compile error rather than a silent gap.
- **Selection lives inside `WysiwygCanvas.tsx` itself** (`selectedBlockId` state, resolved back to
  the live block via `findBlockLocation` on every render — never a stale cached object, so it
  survives edits to sibling blocks), not threaded through `PageEditor.tsx`/`FunnelStepEditor.tsx`
  — same "the canvas is the one shared surface" discipline as everything else in this file.
  Clicking any Section, Row, Element, or locked block selects it (a persistent emerald ring
  replaces the hover-only dashed border) and opens the panel (docked to the canvas's right side
  on lg+ since the editor-chrome rework below; originally below the canvas). **Column selection
  is a deliberate v1 scope cut** — Sections/Rows/Elements/locked blocks all already had a click
  target from O.2/O.3's `RootBlockWrapper`/`NestedItemWrapper`; giving Columns their own would need
  a third selection-and-stopPropagation shape for comparatively low value (a Row's own background/
  padding controls already cover the common case). Click handling uses `stopPropagation()` at the
  innermost matching wrapper so clicking a nested element selects *it*, not an ancestor Section —
  standard "click the most specific thing under the cursor" behavior.
- **A real, self-caught preview-fidelity bug, not a user report**: after wiring the panel in,
  changing a value (e.g. font size) visibly did nothing in the canvas — confirmed via live testing
  immediately after building the panel, before calling O.4 done. Root cause: `WysiwygCanvas.tsx`'s
  render functions never applied a block's own `style` object to its editable preview element at
  all (the pre-O.4 canvas only ever showed hardcoded Tailwind defaults) — the *data* was saving
  correctly the whole time (confirmed via SQL), only the *live preview* silently ignored it. Fixed
  by adding `blockInlineStyle(block)` (`WysiwygCanvas.tsx`) — reuses `styleToInlineCss()` (the
  exact function that builds the real published page's `style="..."` attribute) and converts its
  CSS-string output into a React style object via a small kebab-to-camelCase parser, so the two can
  never independently drift — and applying it to every element/row/column/section/locked-block's
  own preview node (10 element cases + `ColumnEditor`/`RowEditor`/`SectionBody` + all 4 locked
  block renders). Confirmed live: setting a heading's font size and color now visibly updates the
  canvas immediately, and both values round-trip correctly through Save & Republish into the real
  `bridge_html`.
- **Real end-to-end verification, live against TedsWoodworking**: selected the headline, set
  `fontSize:52`/`color:#2563eb` via the panel (native-setter + `input` event dispatch, since a
  plain `.value =` assignment doesn't trigger React's onChange), confirmed the canvas updated live,
  saved, confirmed via SQL that both `page_copy` and the rendered `bridge_html` contained the new
  style, then reverted to the exact original content and confirmed via SQL (`heading_style: {}`,
  4 root blocks, 12 section children — matching pre-test). Separately selected the locked
  `primary_cta` block and confirmed the panel correctly shows a *different* control set
  (Typography/Background/Spacing/Border, no Layout — matching `BUTTON_STYLE_KEYS`, no `maxWidth`)
  — proving `STYLE_KEYS_BY_TYPE` genuinely varies per type, not just for elements.
### O.5: real form-input backend wiring

- **`contacts.extra_fields jsonb not null default '{}'::jsonb`** (`supabase/migrations/
  0025_contacts_extra_fields.sql`) — no `CHECK` constraint, same 100%-app-layer-enforced shape as
  `page_copy`/`stage_data`/`fb_ad_angles`: the set of legitimate keys is dynamic (whatever a
  tenant's *current* `lead_capture_form` block happens to contain) and is validated at write time,
  not by the database.
- **`app/api/public/leads/route.ts` is the real security boundary here, same as everywhere else in
  this app** — the client already sends `payload.extra_fields` as `{[fieldKey]: value}` (the O.1
  submit script's generic `querySelectorAll('[name]')` collection was built for exactly this, and
  needed zero changes). The route re-fetches the campaign's **current** `page_copy` (or, if a
  sticky `bridge_variants` cookie resolved to a real non-control variant, that variant's own
  `page_copy` — a variant's `page_copy` is `NULL` by construction for the control row per the
  `bridge_variants_control_no_content` check constraint, so falling back to the campaign's tree in
  that case is correct, not a gap), normalizes it, and calls `extractLeadFormFields(tree)`
  (`lib/engine/validatePageBlockTree.ts`, exported since O.2 for exactly this use) to get the set
  of `fieldKey`s that are legitimate *right now*. A submitted key not in that set is silently
  dropped — never a 400, matching this route's established "never block a real conversion over one
  bad datum" philosophy (same as the burst/daily rate caps). This closes the obvious spam-key
  vector: a forged `extra_fields` key can never land in the database, and a field the tenant
  removed from their editor moments ago is never trusted just because it was live a minute earlier.
- **Two more soft clamps, not hard rejects**: each value is capped at 500 chars (mirrors
  `validatePageBlockTree.ts`'s own text-length clamping precedent) and, for a field whose
  `fieldType` is `"email"`, sub-validated with the existing `isValidEmail()` — an invalid value is
  dropped, not rejected. `MAX_EXTRA_FIELDS = 10` caps the total, mirroring
  `validatePageBlockTree.ts`'s own `MAX_FORM_CHILDREN = 10` (a form can never legitimately have
  more fields to begin with).
- **`lib/shared.ts`**: `Contact.extra_fields: Record<string, string>` — threaded through the two
  other read sites that already select from `contacts` (`app/(app)/contacts/page.tsx`,
  `app/(app)/broadcast/[id]/page.tsx`'s manual-audience contact picker), both now selecting the
  new column instead of leaving it an unused `{}`.
- **`components/ContactsTable.tsx`**: a flattened `"key: value; key: value"` "Extra" column in
  both the on-screen table (truncated with a `title` tooltip for the full text) and the CSV export
  — deliberately no dynamic per-field columns, since the field set varies per campaign/variant and
  changes over time as a tenant edits their form; this was the plan's own stated v1 scope cut, not
  an oversight.
- **Real end-to-end verification, live against TedsWoodworking**: added two real `form_input`
  blocks to the lead-capture form via a direct PATCH (`phone_o5_test`, type `tel`; and
  `alt_email_o5_test`, type `email`), confirmed both rendered into the real `bridge_html` with
  correct `name`/`type` attributes, then POSTed to `/api/public/leads` twice — once with the
  legitimate `phone_o5_test` key alongside a forged `spam_key_not_real` key (confirmed via SQL:
  only `phone_o5_test` was stored), once with `phone_o5_test` alongside an invalid value for the
  `email`-typed `alt_email_o5_test` field (confirmed via SQL: the invalid email value was dropped,
  the valid phone value kept). Cleaned up both test contacts and reverted the campaign's
  `page_copy` to its exact original content, confirmed via SQL (4 root blocks, 12 section
  children, empty form-field array, zero leftover contacts).

This completes **Phase O** — all five sub-phases (schema/renderer, validator + editor, nested
drag-and-drop + palette, style panel, real form backend) have landed.

### Editor chrome rework: palette rail + side-docked settings (post-Phase-O)

User-requested Elementor-style chrome pass over `components/WysiwygCanvas.tsx` — no data-layer,
validator, or renderer changes; purely how the existing capabilities are surfaced:

- **Three-zone layout on lg+** (final return of `WysiwygCanvas`): `EditorPalette` rail (left) |
  device toggle + canvas (center, `min-w-0 flex-1`) | `BlockStylePanel` dock (right, `lg:w-80
  lg:shrink-0 lg:sticky lg:top-16`, own `overflow-y-auto` capped at `calc(100vh-5rem)`). Below
  `lg` the palette hides entirely (the inline `AddBlockMenu` popovers still cover insertion) and
  the style panel falls back to rendering under the canvas — `BlockStylePanel`'s outer `mt-4` is
  cancelled with `lg:mt-0` and its groups grid became a single-column stack (`grid gap-4`, group
  headers' `sm:col-span-2` are inert in a 1-col grid) so it reads correctly in both positions.
- **`EditorPalette`** (module-scope component in `WysiwygCanvas.tsx`, same stable-identity
  discipline as every other wrapper there): collapsible `w-52`↔`w-12` rail (chevron button,
  `title="Collapse blocks"`/`"Expand blocks"`, state persisted in
  `localStorage.editor_palette_collapsed`, applied post-mount to avoid hydration mismatch — same
  pattern as the app sidebar's `sidebar_collapsed`), `sticky top-16`, `hidden lg:flex`. Contents:
  ROWS (1/2/3-col insert buttons) + ELEMENTS (all 10 `ELEMENT_PALETTE` entries). Click-to-insert
  targeting via `paletteTargetRef()`: the selected Section, else the container holding the
  selected block, else the **last** Section; rows only ever insert into Sections (falling back to
  the last Section when the selection is inside a Column).
- **Hover-revealed controls at the block's side, never below**: `RootBlockWrapper`'s top-right
  hover cluster gained a `Settings2` button (`title="Block settings"`, calls `onSelect`) beside
  the drag grip; `NestedItemWrapper`'s left-edge cluster is now grip + `Settings2` + delete. All
  stay `opacity-0 group-hover:opacity-100` — the settings icon is not always visible, per the
  request.
- **Verified live** (TedsWoodworking opt-in editor, desktop viewport): palette renders and
  collapses to icon-only rail with state persisted; clicking a block's side `Settings2` opens the
  style panel docked right (canvas narrows, panel is a readable single column); palette "Heading"
  click inserted a `New heading` into the section holding the selection (then deleted via the
  hover delete button — nothing saved, server data untouched); closing the panel restores the
  full-width canvas. Same standing caveat as O.3: real drag gestures can't be simulated by this
  session's tooling.

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

**A deployed Vercel instance races local testing for shared-queue jobs.** The production
deployment's own `pg_cron` backstop calls its `/api/engine/run` every minute regardless of what's
running locally, since both point at the same Supabase `jobs` table and `claim_job()` is a single
shared atomic claim — whichever caller (local `curl`, or the deployed cron tick) claims a row first
wins, using *its own* deployed code. Confirmed concretely during this phase: a local IDOR-fix test
job got claimed and completed by the still-undeployed-fix production instance before the local
server got to it, producing exactly the vulnerable behavior the fix was meant to prevent — not a
bug in the fix (verified separately, in isolation, against the exact query), just proof the fix
hadn't shipped to production yet. **Implication: local-only code changes to `lib/engine/*` are not
safely testable via the shared `jobs` queue until deployed** — either test the changed function
directly in isolation (bypass `claim_job()`/the HTTP route, call the exported stage function with
real Supabase data, the same technique used to verify the AI-generation pipeline in the prior
phase), or deploy first and accept that the deployed instance may win the race either way.

Call repeatedly to step a `build_campaign` job through its stages one at a time.
