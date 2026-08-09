# Affiliate Offer Secrets

**Product name is "Affiliate Offer Secrets,"** matching the domain
**`www.affiliateoffersecrets.com`**. It was "ClickBank Studio" until Digistore24 support made a
network-specific name wrong, then "Affiliate Studio" until the domain was bought — the
user-facing wordmark must stay network-agnostic. "ClickBank" survives ONLY where it names the
real network: the `'clickbank'` enum value in `network_connections`/`products`, `clickbank.com`'s
GraphQL endpoint, `hop.clickbank.net` hoplinks, `CLICKBANK_CATEGORIES` (`lib/categories.ts`),
`lib/engine/clickbank.ts`, the network label/badge in the UI, copy about live marketplace
discovery (still ClickBank-only), and the trademark disclaimer in
`components/MarketingFooter.tsx`. Never rename those.

**Renaming this product is not a grep-and-replace, and twice now a plain search has missed
things.** Three separate hiding places, all found only by reading rather than searching:
the wordmark is split across JSX (`Affiliate Offer <span>Secrets</span>` in
`components/AppLogo.tsx`, `components/MarketingFooter.tsx` and `app/login/page.tsx`), so the full
product name never appears as one string; `app/icon.svg` carries it in an `aria-label` and a
comment; and the support address was a *different* old name again (`support@clickbankstudio.app`,
a placeholder domain nobody here owns) living alone in the contact page. Search for every historic
name — "ClickBank Studio", "clickbankstudio", "Affiliate Studio" — plus bare `Studio`, plus every
email address in `app/` and `components/`, and read the JSX around each hit.

`lib/brand.ts` now holds `SUPPORT_EMAIL` and `LEGAL_LAST_UPDATED` for exactly this reason: the
support address appears on Contact, Privacy and Terms, and duplicating it is what let it rot in
the first place. `SUPPORT_EMAIL` must be a mailbox that really receives — Privacy prints it as the
address for GDPR/CCPA erasure requests, so a dead address there is a false compliance claim, not a
cosmetic slip. `app/(marketing)/terms/page.tsx` still contains a literal `[LEGAL ENTITY NAME]`
and a few other bracketed items on purpose: those are the operator's to supply and must not be
invented; both legal pages carry an amber "placeholder legal content, have a lawyer finalise this"
banner until they are.

**Infrastructure was renamed too** (the earlier "leave infra alone" decision is superseded): the
GitHub repo is `Viral-Ad-Media/affiliate-offer-secrets`, the local directory is
`affiliate-offer-secrets`, and the Vercel project is `affiliate-offer-secrets`. `supabase/
migrations/0001_init.sql`'s header keeps the original name on purpose — a migration is a record
of what was written at the time, not a live label.

**Every internal reference to `clickbank-studio.vercel.app` moved to the custom domain** when the
project was renamed: `NEXT_PUBLIC_APP_URL`, the fallback origins in `app/layout.tsx`/
`app/robots.ts`/`app/sitemap.ts`/`lib/blog.ts`, and all four Vault cron URLs
(`engine_webhook_url`, `marketplace_refresh_url`, `domains_reverify_url`, `broadcast_sweep_url` —
verified 2026-08-06, all four canonical). Externally registered callbacks pointing at the old host
— Meta/TikTok OAuth redirect URIs, Meta's deauthorize callback, the Stripe webhook endpoint, and
Supabase Auth's Site URL/redirect allowlist — are the one class this codebase can't fix from
inside itself and must be re-registered by hand.

**This section used to claim the hostname "is gone." It is not, and that false claim was
load-bearing** — it is why nobody re-checked the Stripe registration after the rename. Measured
live 2026-08-06: `clickbank-studio.vercel.app` is still a production alias on the Vercel project,
alongside `www.affiliateoffersecrets.com`, the apex, and `*.affiliateoffersecrets.com`.

**What it actually serves matters, and it is not a second copy of the app.** `classifyHost()`
(`lib/host.ts`) files it as a **custom** host, so middleware rewrites every path to `/d`, matches
no `custom_domain_routes` row, and returns the generic 404 — confirmed for `/`, `/login` and
`/dashboard`. So there is no duplicate site, no old-brand marketing page, nothing indexable. The
one thing that DOES resolve is `/api/`, because `PUBLIC_API_PREFIXES` exempts it from that rewrite:
`POST /api/billing/webhook` on the old host returns the real route's `400 missing signature/secret`.

**So the alias is doing exactly two useful jobs, and removing it is not obviously the fix**:
it blocks anyone else claiming a `.vercel.app` hostname that still carries this product's old
name, and it keeps a Stripe webhook registered against the old host working. Removing it is
irreversible in the sense that matters — the name goes back into Vercel's pool. **Before removing
it, confirm in the Stripe dashboard that the endpoint names
`https://www.affiliateoffersecrets.com/api/billing/webhook`**; `payments` has zero rows ever, so
nothing has exercised that path yet and a mis-registration would first show up as a paying
customer who never gets access.

**`NEXT_PUBLIC_APP_URL` is load-bearing for the whole app, not just link generation.**
`middleware.ts` rewrites any request whose `Host` doesn't match it to `/d${pathname}` (tenant
custom-domain serving), so pointing it at the wrong host doesn't degrade gracefully — it 404s
every page of the app. Confirmed live: the domain returned a bare "Not found" for its entire
first day, purely because this var still named the old Vercel host.

Multi-tenant affiliate SaaS. The Next.js app (deployed on Vercel) is the visual
dashboard; **Supabase (Postgres + Auth) is the database**, with every tenant-owned table scoped
by Row Level Security to `auth.uid() = user_id`. **`lib/engine/*` is the research/generation
engine** — an automated Anthropic-API-based worker that drains the `jobs` queue across all
tenants (via a service-role key that bypasses RLS), triggered automatically the instant a job is
queued (no human runs anything). The Google Drive `clickbank-engine/` folder is a legacy cloud
mirror from the pre-multi-tenant version — optional now, not required.

## Theming (light / dark)

The app ships dark; `<html class="light">` flips it. **There are no `dark:` variants anywhere** —
adding one is almost always the wrong fix.

- **How it works**: `tailwind.config.ts` defines the `ink-*` (surfaces), `zinc-100..600` (text),
  and light-text accent shades (`emerald/amber/red/sky` 200-400) as
  `rgb(var(--token) / <alpha-value>)`. The channel values live in `app/globals.css` under `:root`
  (dark) and `:root.light`. One block themes ~600 existing utility usages, which is why this was
  done as a palette indirection instead of touching every component. The `<alpha-value>` form
  keeps opacity modifiers (`bg-ink-900/90`) working. Accent shades 500+ (borders, filled buttons,
  tinted `/15` backgrounds) read fine on both and stay stock.
- **The light ramp inverts at the strong end, not the middle**: `ink-950` is the page background
  and `ink-900` the raised card, so in light mode 950 becomes the softest tint and 900 becomes
  pure white. Same for text — `zinc-100` (strongest) goes near-black, while `zinc-500` (muted) is
  byte-identical in both themes.
- **No flash**: `components/ThemeScript.tsx` is a blocking inline `<script>` in `<head>`
  (app/layout.tsx) that applies the class before first paint. Doing this in a `useEffect` would
  render dark first and flash on every load for light-mode users. `<html>` carries
  `suppressHydrationWarning` because that script mutates its class list pre-hydration.
- **Preference**: `localStorage.theme` = `system` (default) | `light` | `dark`, chosen via
  `components/ThemeToggle.tsx` in the sidebar footer (segmented control expanded, cycle button on
  the collapsed rail). `applyTheme()` there mirrors ThemeScript's logic exactly — keep the two in
  sync. While on `system` it subscribes to `prefers-color-scheme` so the app follows the OS live.
- **Deliberately NOT themed**: the WYSIWYG canvas's page preview (`bg-white`, `text-[#1a1a1a]` in
  `WysiwygCanvas.tsx`) and every rendered public page (funnel opt-in/steps, blog posts, campaign
  images). Those are real published pages served to ad traffic — always light, regardless of the
  theme the operator happens to be editing in. The canvas carries a `shadow-sm` so it still reads
  as a distinct sheet against the near-white light-mode background.
- **Contrast was measured, not eyeballed**: every accent text shade was checked live against its
  real composited background (tinted chips over white). `emerald-400` and `red-300` initially
  landed at 3.7:1 on the 600 shades and were stepped down to the 700s; all now clear 4.5:1
  (emerald-300 4.50, emerald-400 5.39, amber-300 4.58, red-300 4.97, zinc-500 4.75, zinc-100
  17.4). Re-run that check if you change a light-mode accent value.

## Site structure

`/` is the public marketing site, not the app — `app/(marketing)/*` (route group, no URL
segment) covers Home, About, Pricing, FAQ, Contact, Terms, and Privacy, wrapped in
`app/(marketing)/layout.tsx` with `components/MarketingNav.tsx`/`MarketingFooter.tsx`. The
authenticated app lives at `/dashboard`, `/connections`, `/domains`, `/contacts`, `/audit`,
`/product/[id]`, `/billing` — `app/(app)/layout.tsx` is the paywall/auth gate (redirects to
`/login` with no session, `/billing` without access), renders `components/Sidebar.tsx` (left nav:
Overview/Marketplace/Funnels/Ads Manager/Contacts/Emails/SMS/Blog/Referrals/Analytics/Audit
trail/Settings, active-link
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
- **A build generates only what was ASKED for** (`lib/kitAssets.ts`, `jobs.payload.assets`). Every
  build used to produce all nine assets whether or not the operator ran TikTok, or wanted anything
  beyond a funnel page. The selection is on the ASSET axis, not the stage axis, and that distinction
  is the whole difficulty: `stageAds` was a single Anthropic call producing Facebook angles AND
  TikTok scripts, and `stageSocial` likewise produced organic captions AND the email sequence — so
  dropping TikTok while keeping Facebook means building those two stages' **schema and prompt** from
  the selection, not skipping whole stages. Asking for less is also what makes the saving real: a
  combined call that generated TikTok scripts and then discarded them would cost exactly the same.
  `context` always runs (no AI call, and everything downstream reads its sales-page text and
  hoplinks); `image` is skipped without a funnel, since the picked image is only ever embedded in
  the bridge page and choosing it costs an AI call.
  **An absent or empty selection means EVERYTHING** — `normalizeKitAssets` — so jobs queued before
  this shipped, and any direct API caller, behave exactly as before. Verified by simulation:
  absent/empty/garbage all run 5 AI calls (unchanged), funnel-only runs 2, TikTok-only runs 1.
  **The credit price is still flat per build**, not per asset — generating less is faster and costs
  less real API spend but the same credits, and the dialog says so rather than letting someone
  discover it from the ledger.
- `scripts/engine.ts` (the old `/run-engine` CLI) still exists as a **manual/debug fallback** —
  useful for inspecting a job's context or manually driving/failing something stuck — but it is
  no longer the primary path.

#### Build kit shows a live checklist, not "Queued"

Pressing Build kit opens `components/BuildProgressDialog.tsx` — a per-job progress bar and a
six-step checklist, polling `/api/jobs` every 2s (faster than the list's 5s: this is the one screen
where someone is watching a stage change, and a 5s gap reads as a stall). It filters to the job ids
*this* run queued, so an unrelated build never shows up as yours. `runPromote`'s success toast was
removed — the dialog is the confirmation.

`lib/buildProgress.ts` maps stages to what the work actually is ("Reading the sales page", not
`context`). A stage the chosen assets skip renders as **skipped, not hidden**: someone who unticked
blog should see the blog step isn't running, not wonder why the list is shorter than last time —
and `buildPercent` counts skipped as complete, since it isn't work still owed. State comes from
`jobs.stage`, which the worker advances as it commits each stage, so a step reads done only once its
output is really saved.

**The dialog says it can be closed, and that promise is real** — `lib/engine/worker.ts` calls
`notify()` on completion (checked before writing the copy). Nothing about the build depends on the
dialog being open; a modal implying otherwise would trap someone watching a spinner.

**`BUILD_CAMPAIGN_STAGES` lives in `lib/buildStages.ts`, not `lib/engine/build.ts`.** Importing it
from `build.ts` pulls the Anthropic SDK — and `node:path` — into a client bundle: `tsc` passes and
`next build` fails. `build.ts` re-exports it so every server-side importer is unchanged. Any other
engine constant the browser needs belongs in the same isomorphic file.

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
   **`products.hoplink_override` (0064) replaces the derived link wholesale** when the constructed
   one is wrong for an offer — a non-standard hop domain, a sub-affiliate account, a network that
   hands out a pre-built tracking URL, a vendor id read wrong from the marketplace feed. An
   OVERRIDE column rather than making `hoplink` editable, because `hoplink` is rewritten by
   discovery/upsert on every sweep and an edit there would be silently reverted; clearing the
   override falls straight back to the derived link with no second "is this custom?" flag.
   **The per-channel tid is deliberately LOST while an override is set** — `buildHoplink` returns
   it verbatim for every channel, because the tid convention is specific to each network's own URL
   shape (ClickBank's `tid` query param, Digistore24's campaignkey path segment) and an arbitrary
   pasted URL gives no reliable way to know where one belongs. Guessing would produce links that
   look tracked and silently aren't; the UI says so at the point of entry.
   **Setting it must re-render**, and `PATCH /api/products/[id]/hoplink` does: hrefs are baked into
   stored HTML at write time, so without `rerenderFunnelSequence` over the product's campaigns,
   published pages would keep sending paid traffic to the old link while the UI claimed otherwise.
   Re-render failures are counted and returned rather than thrown — the override IS saved by then,
   and reporting "couldn't save" would invite a destructive retry. Scheme-constrained at the
   database (`^https?://`), because `products` RLS is `for all` and is directly PATCH-able through
   PostgREST, so the route cannot be the only check — verified live that `javascript:`, `data:`,
   protocol-relative and scheme-less values are all rejected.
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

## Two-step signup, and the card on file

Signup is two steps: account details, then a payment method. `components/AuthForm.tsx` holds a
`step` state that is only ever 2 while `mode === "signup"`, and only after `signUp` actually
returned a session — step 2 calls an authenticated route, so reaching it without one would just
401. With Supabase's "Confirm email" ON there IS no session, so that path still falls back to the
confirm-your-email notice rather than pretending the card step can run.

- **The 30-day trial is granted by the DATABASE, not by the client** (0075). `handle_new_user` now
  sets `trial_ends_at = now() + interval '30 days'` on the profile it already creates, so an
  abandoned signup, a crash between the two steps, or any future signup path all land on the same
  answer. Before this, "everyone gets a trial" depended on someone finding and pressing
  `StartTrialButton` on the billing page. `start_trial()` still exists and is unchanged — its
  `trial_ends_at is null` guard simply stops matching for new accounts, and it remains correct for
  the handful of older rows that never started one.
  **The interval is a literal and `trial_ends_at` is NOT in the metadata allowlist.** That matters
  because `raw_user_meta_data` is entirely caller-controlled via `signUp({options:{data}})`.
  Verified with a hostile payload carrying `access_granted: true`, `is_superadmin: true` and a
  10-year `trial_ends_at`: the profile came back with exactly 30 days, `access_granted` false and
  `is_superadmin` false. Re-run that probe if you ever touch this function.
- **Step 2 charges nothing.** It is a `mode: 'setup'` Checkout Session
  (`app/api/billing/setup-session/route.ts`), so it saves a card for when the trial ends and moves
  no money. It is also **skippable** — the trial is already live, so gating the app behind a card
  would be a paywall this product doesn't have.
- **`ui_mode: 'embedded'` is what makes it feel like one form.** It returns a `client_secret`
  instead of a redirect URL, and `components/SignupCardStep.tsx` mounts Stripe's own form inline
  via `EmbeddedCheckoutProvider`. **The card is entered inside Stripe's iframe — card data never
  touches this app's DOM.** Never replace this with real `<input>` fields for a card number; that
  would move the whole app into PCI scope for a cosmetic gain.
  `payment_method_types: ['card']` is deliberate: it keeps `currency` optional (Stripe requires it
  in setup mode only when the types are unset) and keeps every redirect-based method off the
  session, which is the precondition for `redirect_on_completion: 'never'` — that is what lets the
  browser stay on our page when the card saves.
- **The Customer is created and persisted before the session**, not at webhook time. If someone
  abandons step 2 the Customer still exists at Stripe, and creating a second one on their next
  attempt would scatter duplicates across the account.
- **A REAL BUG this fixed in passing**: the webhook rejected any `checkout.session.completed`
  whose metadata wasn't `access` or `credits` with a **400**. Stripe treats a 400 as a delivery
  failure and retries the same event on a schedule for days — over something no retry can fix. A
  card-save session would have done exactly that. Unrecognised types are now acknowledged with a
  200 and ignored.
- **A card on file is not a purchase**, and the webhook's `card_on_file` branch returns before any
  of the payment path: no `payments` row (that table is the paid-money audit trail, and the
  referral program's qualifying event reads from this same handler), and no `access_granted`. It
  stores only `card_brand`/`card_last4` — display echoes, never anything that can charge.
  `profiles` stays SELECT-only for clients; these columns are written by the admin client only, and
  they must not become the reason to re-add an update policy.
- **The test-card banner is gated on `pk_test_`.** Stripe's `4242 4242 4242 4242` is public
  documentation and safe to display, but on a live key that banner would be telling real paying
  customers to type a number that will be declined.
- **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is required for step 2, and is set on Vercel for
  production/preview/development as of 2026-08-06** (test-mode key). It is `NEXT_PUBLIC_*`, so it is
  inlined at BUILD time — adding it does nothing until a fresh build runs. Setting it and waiting
  for the next code push is a way to be confused for an hour.
  **Do not verify it by grepping the bundle for `pk_test_`** — that matches the literal inside this
  codebase's own `startsWith("pk_test_")` comparison, so it reports "present" whether or not a key
  exists. It did exactly that here, and the false positive survived two rounds of checking. Grep for
  `pk_(test|live)_[A-Za-z0-9]{12,}` instead, i.e. a key with its actual tail. The other tell is the
  compiled output: an inlined var appears as a string literal, whereas a MISSING one compiles to a
  runtime `s(…).env.NEXT_PUBLIC_…` lookup that resolves to `undefined` in the browser. Without it the step
  renders a plain "card setup isn't configured yet" message and a link onward — deliberately not a
  dead end, since the account and the trial already exist by then.
- **Still to build: nothing charges the card when the trial ends.** Capture is done; billing at
  day 30 (a scheduled charge, a failure/dunning path, and the notifications around both) is a
  separate piece of work and is not implied by this one.

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
### Credits are consumed by work, not just by ad spend (0063)

Until 0063 the ledger was debited in exactly ONE place — `reserve_ad_credits()` at ad activation —
while every unit of real platform cost (Anthropic, kie.ai, Veo) went to `usage_ledger` as tracking
with nothing deducted. Queueing a job is now a purchase.

- **`lib/credits.ts`'s `JOB_CREDIT_COST` is the price list**, deliberately a plain literal so
  reading it tells you the whole pricing model. `launch_ad` and `send_broadcast_email` are `0` on
  purpose: the first already reserves its budget via `reserve_ad_credits` at activation (charging
  to queue the paused draft too would bill twice for one action, and free drafts are the point of
  the Phase C design), and the second is governed by the pooled daily send cap protecting a real
  mailbox. Current numbers are a starting point above marginal cost, not a modelled margin.
- **A job is charged ONCE, at queue time, keyed on its own id — never inside a stage handler.**
  `worker.ts` re-runs stages, reclaims jobs whose `locked_at` went stale, and retries to
  `MAX_ATTEMPTS`; a debit written inside a stage would fire on every one of those. The partial
  unique index `credits_ledger_one_charge_per_job` makes "once" a database guarantee rather than
  app discipline, and `charge_job_credits` swallows the duplicate and returns the current balance,
  so a retried request is idempotent too.
- **Ordering is insert-then-charge, and the routes MUST delete the job when the charge is
  declined.** The debit is keyed on the job's id, so the row has to exist first. `queueChargedJob`
  pairs the two (plus an `onRollback` for the routes that take a concurrency claim first —
  `campaigns.video_status`, `claim_campaign_creative` — or the entity sits "generating" forever
  after a declined charge). A route that inserts without charging gives work away; one that charges
  without deleting bills for a job that never runs.
- **Balance is summed by WORKSPACE, and this fixed a real pre-existing bug.**
  `reserve_ad_credits` summed `where user_id = auth.uid()` while the ledger has been
  workspace-scoped since 0057 and the credits chip sums by `workspace_id` — so in a multi-member
  workspace, credits bought by one member were invisible to another trying to spend them while the
  chip showed the shared total. Everything now goes through `workspace_credit_balance()`.
- **Both debit paths share the advisory lock key `'credits:' || workspace_id`**, so a job charge
  and an ad reservation serialise against each other. Two debits racing under READ COMMITTED can
  both read the same starting balance and both pass — the race 0008 documented, which only holds
  if every debit takes the same lock.
- **Refund happens only on TERMINAL failure** (`failJob`, attempts exhausted). A job with retries
  left may still succeed, and refunding early would let a flaky-then-successful job run free.
  `refund_job_credits` mirrors the original debit rather than taking an amount, so a price change
  between queueing and failing can't refund the wrong number, and it is idempotent. A refund
  failure is logged and never aborts `failJob` — the job being correctly marked failed matters
  more, and an unrefunded credit is recoverable by hand.
- **Verified live against the database**, impersonating a real signed-in user: a charge beyond
  balance returns NULL and writes zero rows; a real charge debits exactly once; charging the same
  job again leaves the balance unchanged with one debit row; refund returns exactly the original
  amount; a second refund returns 0; and `charge_job_credits` on another workspace's job is
  refused with the same generic "Job not found" as a nonexistent one. All test rows removed.
- **Operational note**: this makes a zero balance block all generation. Superadmins can comp
  credits via `admin_adjust_credits` (audited, see the Superadmin section); everyone else tops up
  through Stripe.

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

- **A Meta connection belongs to the workspace, not to whoever clicked Connect**
  (`0071_meta_workspace_scope.sql`). Phase 2 added `workspace_id` to all six Meta tables but left
  the UNIQUE constraints and three RPCs keyed on `user_id`, which broke three things: a user in
  two workspaces could not connect Meta in the second at all (the insert collided with
  `unique(user_id)` from the first); `get_meta_connection_status()` read `where user_id =
  auth.uid()`, so a teammate who did not personally run the OAuth flow saw "not connected" for a
  workspace that is connected; and `disconnect_meta()` deleted by `user_id`, so a teammate could
  not unhook a bad connection. All six constraints are now `(workspace_id, …)`.
- **The `stamp_workspace_id` trigger is not a substitute for stamping it yourself in the OAuth
  callback.** The callback writes through the admin client, where `auth.uid()` is NULL, so the
  trigger falls through to "this user's first owned workspace" — connecting from workspace B
  would file the connection under workspace A, and every read (all workspace-scoped) would then
  show nothing. `app/api/meta/callback/route.ts` passes `workspace_id: ws` on all four inserts.
  Any future connector written on the admin client must do the same.
- `get_meta_connection_status`, `disconnect_meta` and `set_active_meta_page` take an optional
  `p_workspace_id`, so a server caller that already resolved the workspace from the request host
  (Phase 3's rule) passes it rather than letting the RPC re-resolve to whatever
  `profiles.active_workspace_id` holds. Omitted, it falls back to `current_workspace_id()` — what
  browser-side callers do. Membership is re-checked either way in `resolve_workspace_arg()`, so
  passing an id can only narrow, never widen.
- `assert_owns_meta_page`/`assert_owns_ig_account` are membership-only. They used to read
  `user_id = auth.uid() OR is_workspace_member(...)`, which let a person *removed* from a
  workspace keep passing the ownership check on rows they originally created.

**Every other connector got the same treatment in `0072_connector_workspace_scope.sql`**: TikTok,
YouTube, Gmail (`mail_connections`), the mail providers, Everflow and the affiliate networks — all
re-keyed to `(workspace_id, …)`, all their `get_*_connection_status`/`disconnect_*` RPCs
workspace-scoped with the same optional `p_workspace_id` shape. Three more admin-client writes
that relied on the trigger now stamp `workspace_id` explicitly (`tiktok/callback`,
`everflow/connect`, `mail-providers`), and their `onConflict` targets moved with the constraints.

- **`active_mail_provider` moved from `profiles` to `workspaces`** as part of that, because it was
  a genuine split-brain, not just an inconsistency: `lib/mail/send.ts` read the provider *name*
  from `profiles` (keyed by person) and then looked the *connection* up by `workspace_id`. That
  only agrees while a workspace has one member. The Broadcast engine passes `job.user_id`, so
  whoever happened to create a sequence silently decided the whole workspace's sending provider —
  and if their personal pointer named a provider the workspace hadn't connected, every send in
  that sequence failed `not_connected` with nothing in the UI explaining why. The backfill only
  carried a pointer across when the workspace actually has that provider connected; a pointer
  naming an unconnected provider *is* the broken state and was deliberately dropped.
  `profiles.active_mail_provider` stays as an unread legacy mirror (same call as
  `profiles.nickname` in 0015).

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

## A funnel has a URL from generation, not from publish

`/preview/funnel/{campaignId}` and `/preview/step/{stepId}` (`app/preview/[kind]/[id]/route.ts`).
A funnel page previously had no URL at all until it was published — the public route gates on
`bridge_published` — and Preview was a `blob:` document built client-side, so the one thing you
want right after generating a kit had no link you could open, bookmark or send to a teammate.

**Signed-in only, and the gate is by omission.** `/preview` is in NEITHER `PUBLIC_EXACT_PATHS` nor
`PUBLIC_PREFIX_PATHS`, so middleware's auth gate turns an anonymous request away before the
handler runs — everything unlisted is gated by default. **Do not add `/preview` to either list.**
It also reads through the RLS-scoped client AND filters `workspace_id`, so a signed-in member of
another workspace gets the same 404 as a stranger.

**The `sandbox=""` wrapper is the point, not an implementation detail.** These pages carry the
tenant's Meta Pixel and a lead form posting to the real `/api/public/leads` on this same origin —
served as an ordinary document, looking at your own draft would fire live pixels and could write a
real contact row. An empty sandbox runs no scripts and submits no forms. Same guarantee the blob:
preview gave, now addressable. Trade, unchanged from that one: a countdown block sits still.

**Blog posts deliberately do NOT route through here.** `/api/blog/preview/post/[id]` already did
exactly this, with `page_copy`/`seo_index` handling and a `previewBase` that keeps internal links
inside the preview. A branch for posts was written here and then removed on finding it; the blog
editor's draft link points at the existing route. **The editors' own Preview button still renders
locally** — it previews UNSAVED edits, which no URL can.

**Verified live, signed in**: anonymous → 307 to `/login`; own unpublished funnel → renders as a
real page; `sandbox=""` present and `contentDocument` opaque (so scripts genuinely cannot run); a
funnel step → renders; the same campaign's PUBLIC `/p/` URL → still 404, publish gate untouched;
and another workspace's funnel id → "Not found".

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

**Creating one by hand.** "New funnel" on that page (`components/NewFunnelButton.tsx` →
`NewFunnelDialog.tsx` → `POST /api/funnels`) writes an opt-in page and its steps directly — no AI,
no credits, the alternative to Promote. Two steps: funnel type, then name + layout.

**A funnel needs no product** (0068 dropped `campaigns.product_id`'s NOT NULL and added `name` and
`cta_url`). It's a page — a webinar registration, a lead magnet, something to point ads at before
an offer is chosen — and requiring one only made people attach an arbitrary product to get past the
dialog, which is worse data than none. Without a product there's no hoplink to bake, so the CTA
falls back to `campaigns.cta_url` and to `"#"` until one is set; `rerenderFunnelSequence`'s
`offerHref()` is the single place that decision lives. `components/OfferLinkPanel.tsx` sets it, via
`POST /api/campaigns/[id]/cta-url`, and is rendered ONLY when the funnel has no product — with one,
the hoplink is the destination and a second control would claim to set the same thing. Saving
re-renders the funnel, because hrefs are baked at write time; without that the pages would keep
sending real traffic to the old destination while the UI claimed otherwise. Its old early-return when the product or
affiliate id was missing would have left every standalone funnel with no HTML at all.

**Six layout styles** (`lib/funnelStyles.ts`), composed against the type rather than hand-written
6 × 6: the TYPE decides what the page is about, the STYLE decides which sections exist, in what
order, and how the placeholder prompts read. 36 authored blobs would drift apart the first time
anyone edited one. `pruneEmptySections` is what actually drops what a style leaves out —
`normalizePageCopy` appends every missing section by design (right for the AI path, wrong here), so
without it "Minimal" shipped with an empty "How it works" and an empty "Questions" heading.
Verified all six produce distinct block shapes per type. `lib/funnelTypes.ts` lists eight types and, honestly, which four this app can actually
deliver: VSL and Webinar need a video block that `blockTree.ts` doesn't have, Survey needs
answer-based routing that `funnel_steps` (a linear chain ordered by `step_index`) can't express,
and Book/free-plus-shipping needs checkout charging the VISITOR, which is a different system from
the Stripe integration that bills tenants for their own access. Those four render **disabled with
the reason shown**, not hidden — someone who came looking for a webinar funnel should learn why
it isn't there. `isBuildable()` is re-checked server-side; the greyed-out UI is not the boundary.

`lib/funnelTemplates.ts` authors starter copy in the LEGACY flat `PageCopy` shape and runs it
through `normalizePageCopy` — the same permanent adapter every AI-generated campaign uses — so a
template can't produce a tree shape the renderer hasn't already been serving, and the locked
compliance blocks come from one place. The copy is deliberately generic and product-agnostic:
asserting a benefit or a result in a template would put words in the affiliate's mouth on a page
carrying their disclosure. "Scratch" builds its tree directly instead (the adapter always emits
all five legacy sections by design), but still carries the disclosure and a working opt-in form.

Steps are inserted with the admin client rather than via `add_funnel_step()`, since ownership is
already established by the workspace-scoped product lookup. **0066 fixed that RPC and its two
siblings**, which were still authorized by `campaigns.user_id = auth.uid()` — 0023 wrote them
when a tenant was a person, and the workspace migration updated `assert_owns_funnel_step` but
missed these three. A teammate could see a campaign and its buttons, and got "Campaign not found".
`move_funnel_step` had a quieter second bug: its NEIGHBOUR lookup was also filtered by `auth.uid()`,
so in a funnel with steps from two members, "move up" jumped over the other member's step and
swapped with the one beyond — reordering wrongly rather than failing, with no error. All three now
resolve the campaign's workspace and check `is_workspace_member`. `add_funnel_step` also sets
`workspace_id` explicitly from the campaign rather than leaving it to the `stamp_workspace_id`
trigger, whose fallback is the CALLER's active workspace — for someone in two workspaces that
could file a step somewhere other than where its own campaign lives.

`rerenderFunnelSequence(admin, campaignId, workspaceId)` takes a WORKSPACE id. Five call sites
passed `user.id` for months after `network_connections` became workspace-scoped, so the affiliate
lookup never matched, `affiliateId` came back null, and the function returned before rendering
anything — add/move/delete step and tracking edits silently re-rendered nothing. Fixed; if you add
a call site, pass `await currentWorkspaceId()`.

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
- **A verified domain claims the vacant blog/primary role automatically (0078).** `serves_blog`
  and `is_primary` existed since 0042 but were manual checkboxes, so a tenant's first domain did
  nothing until they found and ticked two boxes. The trigger fires on the **status transition to
  verified**, never on add: a pending domain's DNS doesn't point here, so making it the blog host
  would publish links that 404 — and the setter route already refuses these flags on a non-verified
  domain, so auto-setting at insert would contradict the app's own rule. Firing on the transition
  also covers every path that can verify a domain rather than three call sites that must remember.
  **It only ever fills a role nothing else holds**, so an explicit choice is never overridden and
  the checkboxes remain authoritative for switching. The trigger is scoped to `update of status`
  for the same reason — it must not re-evaluate when the setter route writes the flags directly.
  Verified live against the real table: pending claims nothing; verifying claims both vacant roles;
  a second verified domain claims neither; switching moves one role without disturbing the other.
- **Those two indexes were keyed on `user_id` until 0078, and that was wrong after 0057.** 0042
  predates the workspace migration and was missed by the connector re-keying in 0071/0072. The
  setter route clears the flag across the whole WORKSPACE before setting it, so the constraint and
  the code disagreed — two members of one workspace could each hold a `serves_blog` domain and the
  blog would answer on two hosts, exactly the duplicate-content problem 0042 added the index to
  prevent. Now keyed on `workspace_id`; confirmed a second one raises `unique_violation`.
- **A domain belongs to the WORKSPACE, and the create path was the one that forgot.**
  `POST /api/domains` inserted `custom_domains` with `user_id` and no `workspace_id`, on the ADMIN
  client — where `auth.uid()` is null, so `stamp_workspace_id()` fell through to "this user's first
  owned workspace". Every other domain route (DELETE, PATCH, verify) was already
  `.eq("workspace_id", ws)`; only the one that CREATES the row wasn't. A user in two workspaces
  adding a domain from workspace B would have had it filed under A, invisible to their teammates in
  B. Same trap as Meta's callback: any admin-client insert must stamp `workspace_id` itself.
  Checked before fixing — the single existing row's owner belongs to exactly one workspace, so the
  fallback happened to pick correctly and no backfill was needed. The bug was latent, not fired.
  `app/(app)/settings/domains/page.tsx` had the matching read-side gap: no workspace filter at all,
  so RLS kept tenants apart but a member of two workspaces saw both workspaces' domains AND
  campaigns merged into one list. Both queries now filter explicitly — the standing belt-and-braces
  rule, where the policy decides whether a row is visible at all and the filter decides which of
  YOUR workspaces you are looking at.
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

Instagram and TikTok get real posting. (Mail once sent from a client's connected Gmail, and
YouTube once accepted real uploads — both are gone; see "Google is out of this codebase" below.)
Generic
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
- **TikTok follows the exact same OAuth-CSRF/Vault/default-deny-RLS shape as Meta**
  (`lib/tiktok/*`, `app/api/tiktok/{connect,callback,disconnect}`), with its own state-cookie name
  (`tiktok_oauth_state`) so concurrent flows in different tabs never collide. YouTube and Mail
  used to sit alongside it under `lib/google/*` with their own cookie names; both are gone.
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
  (console.cloud.google.com — register `${NEXT_PUBLIC_APP_URL}/api/youtube/callback`, and ONLY
  that one: the Gmail OAuth flow was retired in `0037_retire_gmail_sender.sql`, so `/api/mail/`
  has a `send` route and no `connect`/`callback` at all. Registering a mail callback would point at
  a route that doesn't exist). TikTok apps and Google's OAuth consent screen both
  work immediately for the developer/testers added on the app itself, without full review —
  sufficient for testing, same caveat as Meta's Development Mode.

## Google is out of this codebase

Both Google-dependent connectors were retired, for the same underlying reason, and neither should
be re-added without revisiting it: **`gmail.send` and `youtube.upload` are Google RESTRICTED/
sensitive scopes**, so shipping either to the public needs a security assessment that can require a
third-party audit. That's a fine dependency for one operator in Testing mode and the wrong one
under a multi-tenant product.

- **Gmail sending** went first (`0037_retire_gmail_sender.sql`) — `app/api/mail/` keeps only
  `send`, which now dispatches through `sendViaActiveSender()` and the per-tenant API-key providers
  (Resend/SendGrid/Mailgun/SMTP).
- **YouTube** went second: `app/api/youtube/*`, `components/YouTubePanel.tsx` and the whole of
  `lib/google/*` are deleted, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are no longer read
  anywhere, and `GenerateVideo.tsx` posts a generated clip to Instagram Reels or TikTok only.
  Verified before deleting: zero rows in both `youtube_connections` and `youtube_posts`, so no
  tenant lost a connection and no audit history was destroyed.
- **`youtube_connections` and `youtube_posts` are deliberately left in place**, unread — same call
  as `mail_connections` and `profiles.nickname`. `youtube_posts` in particular is one of the six
  tables the `audit_events` view (0049) UNIONs, so dropping it would mean rewriting that view for
  no user-visible gain. `AuditPlatform`'s `"youtube"` member and `AuditTrail.tsx`'s `PLATFORM_META`
  entry stay for the same reason: the branch is unreachable now, but it's what keeps the view and
  its renderer honest about a table that still exists.
- `GEMINI_API_KEY` is **not** affected — it's a plain Google AI Studio API key for Veo video
  generation, never an OAuth client, and video generation itself is untouched.

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

## Image and video generation shows a real percentage

Every generation surface polled its ENTITY — a `campaign_creatives` row, `campaigns.video_status`,
`blog_posts.featured_image_status` — and those only ever say none/generating/ready/failed. So a Veo
render looked identical at second 5 and at minute 4, and the only honest thing the UI could say was
"Generating…". `components/GenerationProgress.tsx` finds the JOB behind that entity and shows how
far it has got.

- **The number comes from `jobs.stage`, exactly as `lib/buildProgress.ts` derives the build
  checklist** — the worker advances that column only once a stage's output is committed, so the bar
  can never claim progress the job hasn't made. No progress column to keep in sync, and nothing
  written from a stage handler (which re-runs on every retry).
- **`lib/generationStages.ts` is the isomorphic home of all five stage lists**, and each engine
  module now re-exports its own from there. Same rule `BUILD_CAMPAIGN_STAGES`/`lib/buildStages.ts`
  already established: importing one of these from `videogen.ts`/`creativeimage.ts` drags the
  Gemini/kie.ai/Storage clients — and `node:*` — into a client bundle, which `tsc --noEmit` passes
  and `next build` fails.
- **The bar deliberately does NOT creep on a timer.** `poll` is one stage but most of the wall
  clock, so it sits still while the label says "Generating" and a line underneath says the step can
  take minutes. A bar animating toward 100% during a render would be inventing progress at exactly
  the moment nobody knows how far along it is — and `generationProgress()` marks that stage `slow`
  rather than leaving a still bar to read as a stall.
- The component finds its job itself (`type` + `payload->>{key}` + `status in (pending,running)`,
  newest first) through the browser client against `jobs`' workspace RLS — verified live that the
  policy is `is_workspace_member(workspace_id)` and that the payload keys really are
  `campaign_creative_id` / `post_id` / `campaign_id`. No new route: `/api/jobs` returns the whole
  queue, and this is one row.
- Wired into `CreativeItemCard` (per-angle/post image AND video), `GenerateVideo` (campaign-level)
  and `FeaturedImageField` (blog featured image). **`generate_ad_image` has no UI surface left** —
  the per-angle flow replaced the campaign-level button, and nothing in `components/` or `app/`
  calls that route anymore; its stage list is in the table anyway so the fallback route keeps
  working if it is ever surfaced again.

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
  SaaS operator (Affiliate Offer Secrets itself), a completely different context from a tenant's own ad
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

## Credits are consumed by work, not just by ad spend

Until 0063, `credits_ledger` was debited in exactly ONE place — `reserve_ad_credits()` at ad
activation — while every unit of real platform cost (Anthropic calls, kie.ai images, Veo video)
landed in `usage_ledger` as tracking with nothing deducted. Fine while one operator tested solo on
their own API keys; wrong for paying customers. `lib/credits.ts`'s `JOB_CREDIT_COST` is now the
price list and the single place to change what anything costs.

- **A job is charged ONCE, at queue time, keyed on its own id — never inside a stage handler.**
  `worker.ts` re-runs stages, reclaims jobs whose `locked_at` went stale, and retries to
  `MAX_ATTEMPTS`; a debit written inside a stage would fire on every one of those. Two partial
  unique indexes on `credits_ledger (job_id)` — one per sign — make "one charge and one refund per
  job" a database guarantee rather than app discipline, and `charge_job_credits` swallows the
  duplicate and returns the current balance, so a retried request is idempotent by construction.
- **Ordering: insert the job, then charge, then delete the job if the charge is declined.** The
  debit is keyed on the job id, so the row must exist first. `queueChargedJob()` owns that triple
  (plus an `onRollback` for the two routes that take a concurrency claim first — `video_status`,
  `claim_campaign_creative` — which would otherwise sit "generating" forever after a declined
  charge). The alternative, charging against a client-chosen id, would let a caller mint the
  primary key of a row only the admin client writes; nothing else here allows that.
- **A REAL PRE-EXISTING BUG got fixed in the same pass**: `reserve_ad_credits()` summed the balance
  `where user_id = auth.uid()` while `credits_ledger` has been workspace-scoped since 0057 and the
  credits chip sums by `workspace_id`. In a workspace with more than one member those disagree —
  credits bought by one member were invisible to another member trying to spend them, while the
  chip showed the shared total. Both now go through `workspace_credit_balance()`, and both debit
  paths take the SAME advisory lock key (`'credits:' || workspace_id`) so a job charge and an
  ad-spend reservation serialise against each other. Two debits racing under READ COMMITTED can
  both read the same starting balance — the exact race 0008 documented, which only holds if
  everyone shares the lock.
- **`launch_ad` and `send_broadcast_email` cost 0 deliberately.** The ad's budget is already
  reserved by `reserve_ad_credits()` at activation (charging to queue the draft would bill twice
  for one action, and paused drafts are free on purpose); broadcast sends are governed by the
  pooled daily cap that exists to protect a real mailbox, and a per-email price would be a second
  unrelated limiter on the same action.
- **Refund on TERMINAL failure only** (`failJob`, attempts exhausted). A job with retries left may
  still succeed, and refunding early would let a flaky-then-successful job run free.
  `refund_job_credits` mirrors the original debit rather than taking an amount, so a price change
  between queueing and failing can't refund the wrong number. A refund failure is logged, never
  allowed to mask the real error.
- **Synchronous AI helpers are NOT charged** (`/api/broadcast/generate`). Charging safely depends
  on the job-id key; a synchronous call has none, so pricing it would add a second, weaker billing
  path for one cheap text call. Tokens still land in `usage_ledger`. If one ever needs a price,
  give it a client-supplied idempotency key first (the `meta_posts` pattern) — don't bolt on an
  unguarded debit.
- **`CostBadge` is a hint, never a gate.** It shows the price beside every spending action and
  turns amber below balance, but disables nothing: the server re-checks under the advisory lock and
  answers 402, and that is the only trustworthy answer. A client-side block from a possibly-stale
  number would either lie about affordability or grey out a button that would have worked.
  `CreditsProvider` seeds the balance from the value the app layout already computes for the chip
  (correct on first paint, no flash) and each spend calls `refresh()` rather than a full
  `router.refresh()` for one number.

## Regenerate a kit, and restyle without rewriting

Two separate actions, because only one of them can destroy work.

**Regenerate** is `/api/promote` on a product that already has a kit — not a new endpoint.
That route already owns the entitlement check, the credit charge and the rollback, and a second
server-side copy would be a second billing path to keep in step. The bulk bar loops it per product
exactly as bulk promote does. Both entry points exist: the bulk bar in `ProductsPanel`, and the
kit page itself (`app/(app)/product/[id]/page.tsx`).

**`PromoteKitDialog` gained a `mode`, rather than growing a second dialog.** The pieces you can
regenerate are exactly the pieces you could build, so two components would drift the first time an
asset was added to one of them. `openRegenerate` is the exact inverse of `openPromote` — it filters
to products that HAVE a `campaign_status` — so the count, and the credit total quoted from it,
describe what will really run.

**The funnel page starts UNTICKED in regenerate mode, and that default is the safety mechanism —
not the edit detection.** Rebuilding it overwrites `page_copy`, including copy someone wrote by
hand on a page that may already be taking paid traffic. `campaigns.page_copy_edited_at` (0076,
stamped by both editor PATCH routes) sharpens the wording to name the date, but it is null for
anything edited before that column existed — so trusting it as the guard would silently destroy
precisely the oldest, most worked-on pages. Ticking it shows a red, explicit "there is no undo".
The "ads without a funnel" warning is suppressed in this mode: the page already exists, so that
state is normal here, and a warning shown when nothing is wrong is one people learn to ignore.

**Restyle is the non-destructive alternative, offered from inside that same warning.**
`app/api/campaigns/[id]/restyle/route.ts` applies a `THEME_PRESETS` entry
(`lib/engine/pageTheme.ts`) to `page_copy.theme` and re-renders. It carries `blocks` across by
reference and never inspects them — the only key that changes is `theme`, which becomes CSS custom
properties. No Anthropic call, so no credits. Verified directly across all six presets: the block
array is byte-identical before and after, the hand-written headline/lead/bullets all survive into
the rendered HTML, the theme genuinely changes the CSS, an unknown preset id is rejected, and a
colour like `"#fff;} body{display:none}"` sanitizes away rather than closing the rule.

**A theme preset is NOT a funnel style, and they must not be merged.** `FUNNEL_STYLES`
(`lib/funnelStyles.ts`) decides which SECTIONS exist and in what order, so applying one to an
existing page would drop the copy in the sections it omits. That stays a create-time choice.
A theme only repaints what is already there, which is the entire reason it is safe to offer here.

## Bulk actions and quick edit (leads, blog posts)

Two lists carry row selection with a bulk bar: Contacts → Leads and Blog → Posts. Both bulk
endpoints share one non-negotiable shape, and it is the whole security story of each: **they write
on the admin client, which bypasses RLS, and the ids come from the request body — so every id is
re-resolved against the caller's workspace FIRST and only that verified set is touched.** Ids from
another workspace are silently dropped, never acted on. Any second caller-supplied reference in the
same request (`tag_id`, `category_id`) gets its own identical check, or a caller could staple
another workspace's tag onto their own leads / file posts under another workspace's category. Same
discipline as `set_broadcast_sequence_contacts` validating every element of its array: a determined
caller talks to the endpoint, not the UI, and "the UI only sends ids it rendered" is not an
authorization argument. Verified live for contacts: of 3 supplied ids (1 real, 2 foreign) exactly 1
passed the filter.

- **Blog quick edit reuses the existing `PATCH /api/blog/posts/[id]`** rather than adding a route —
  that route already handled title, category and status, so there is no second write path to keep
  in step. Changing a title moves the slug, and the dialog says so: old links to the previous slug
  stop resolving.
- **Bulk publish is a real publish** — it stamps `published_at` exactly as a single publish does.
  A bulk path with quieter semantics is how a bulk action ends up doing less than the single one.
  Unpublish deliberately LEAVES `published_at` in place: it records when the post first went live,
  and the public routes gate on `status`, not on that column.

## shadcn/ui + 21st.dev components

**The hand-rolled classes are gone.** `.card` / `.chip` / `.btn` / `.btn-primary` / `.btn-ghost` and
the `.data-table` descendant rules no longer exist in `app/globals.css` — every call site now uses
`components/ui/{card,badge,button,table}.tsx`. Only `.stat-tile*` and `.prose-dark` remain as CSS
classes. What to know before adding UI:

- **The primitives were retuned to match this app, not the other way round.** Stock shadcn `Button`
  is `rounded-md`, `h-10 px-4 py-2` and fades hover with `bg-primary/90`; this app's buttons are
  `rounded-lg`, `px-3 py-1.5` and hover to a distinct *shade*. `buttonVariants` emits the latter.
  Don't "fix" it back toward stock — that silently restyles ~130 call sites.
- **Variant names don't map to their old class names.** `.btn-ghost` had a border, so it is
  `variant="outline"`; `ghost` is the borderless one. `Badge`'s default variant carries **no**
  colours, because `.chip` didn't either — call sites pass their own.
- **`Card` takes `as`.** A good number of cards are `<section>`/`<header>`; Card is cosmetic and
  shouldn't cost a page its document structure, so the element stays the caller's choice.
- **`Table` moved the descendant selectors onto components.** `.data-table` styled `thead th` and
  `tbody tr` from the parent; `TableHead`/`TableRow` own those rules now, and a row opts out by
  not using them. The interior-vs-edge header padding that was
  `:not(:first-child):not(:last-child)` is an explicit `edge` prop — mark the first and last
  `TableHead` of each header row.
- **For links, use `className={buttonVariants(...)}`, not `asChild`.** It keeps the anchor exactly
  where it is; `asChild` restructures the tree and can drop an `href`.
- Three interactive `.card` sites (a `Link`, a `form`, a `button`) inline the card utilities
  directly, because `Card` can't be any of those elements.

Originally added so components sourced from 21st.dev's registry (`components/ui/*`) could drop in
without per-component recoloring:

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

## Emails (Broadcast + Sequences)

Sidebar parent **Emails** with two children — **Broadcast** (`/emails/broadcast`, one-off send)
and **Sequences** (`/emails/sequences`, the multi-step drip that used to live at `/broadcast`).

- **A broadcast IS a sequence.** `broadcast_sequences.kind` (0035, `'sequence' | 'broadcast'`) is
  the ONLY difference: a broadcast is a `kind='broadcast'` row with a single `delay_days = 0`
  step, created-and-activated in one call by `app/api/broadcast/send-now/route.ts`. Nothing in
  the delivery path reads `kind` — enrollment, `run_broadcast_sweep()`'s pooled daily cap, the
  `send_broadcast_email` job, the code-owned unsubscribe footer, `broadcast_sends` auditing and
  terminal-failure handling all apply unchanged. The column exists purely so the two list
  separately in the UI.
- **`create_broadcast_sequence` gained a defaulted `p_kind`** — and the old 3-arg function was
  DROPPED rather than left alongside it. Keeping both would make every existing 3-arg call
  ambiguous to Postgres's resolver (matches the old exactly AND the new via its default); with
  the old dropped, today's 3-arg call sites resolve to the new function with `kind='sequence'`,
  behaviour unchanged.
- **send-now is pure orchestration**: it calls the three existing RPCs (create → upsert step →
  activate) and rolls the draft back with `delete_broadcast_sequence` if either later step fails,
  so a half-built broadcast never lingers in the history list. Campaign-audience ownership is
  re-checked inside `create_broadcast_sequence` via `assert_owns_campaign` — this route is never
  the boundary.
- **The composer gates on the active sender**: Gmail needs a live OAuth connection, so Send is
  disabled with an explicit reason when it is missing or `needs_reconnect`; the API-key providers
  (Resend/SendGrid/Mailgun/SMTP) are always ready.
- **Verified live**: the Emails submenu renders and highlights correctly, a real send-now call
  produced exactly `kind='broadcast'` / `status='active'` / 1 step at `delay_days=0` with the
  right subject, that row did NOT appear on the Sequences list, and both validation guards
  (missing subject, campaign audience with no campaign) rejected. Test row deleted afterward.
- Route move: `/broadcast` → `/emails/sequences` (all internal links, the Overview quick-link and
  `robots.ts` updated). No redirect from the old path — it was only ever reachable from the
  in-app sidebar, never linked externally.

## Broadcast delivery internals (drip sequences)

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
- **`broadcast_sends` is the audit trail, and ALL its source FKs are `on delete set null`** —
  `sequence_id`/`step_id`/`contact_id` shipped that way in 0021 so send history outlives its
  sources (the `contacts.campaign_id` precedent), and `0061_broadcast_sends_preserve_history.sql`
  brought `enrollment_step_id` in line: 0021 had given it `on delete cascade` (the
  `ad_launches.campaign_id` precedent — wrong one for an audit table), which let deleting a
  sequence cascade sequence → enrollments → enrollment_steps → `broadcast_sends`, erasing history
  and undercounting the pooled daily cap that counts these rows. Safe because nothing selects
  `broadcast_sends` by `enrollment_step_id` — every call site filtering on that value targets
  `broadcast_enrollment_steps.id` or `jobs.payload`.
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
- **A kit's article becomes a draft post automatically, and that is now the ONLY path.**
  `finalizeBuildCampaign` (`lib/engine/worker.ts`) calls `createPostFromCampaign`
  (`lib/blog/fromCampaign.ts`) when a build finishes; the "Import from campaign" dropdown and
  "Import all" button are gone, along with `app/api/blog/posts/import-all`. A button asking
  someone to do by hand what already happened is just a way to be unsure whether it did. Draft,
  never published: this is machine-written copy about someone else's product. Idempotent on
  `campaign_id`, so a rebuild updates the kit rather than stacking posts. Untick "Blog article" in
  the Build kit dialog and there is no `blog_md`, so no post — correct, and worth knowing.
- **`createPostFromCampaign` had NEVER once worked, and the try/catch is why nobody knew.** Its
  insert omitted `user_id`, which is NOT NULL on `blog_posts`, so every call threw — silently in
  the worker (swallowed, `console.error` only) and as a 500 from the import button. The 7 posts
  that exist predate the helper and came from the older inline import. The post now inherits the
  CAMPAIGN's `user_id` (created-by attribution for a derived row, and it needs no signature
  change), and the worker's catch additionally sends a notification, so a future failure surfaces
  to the person who'd notice the post missing instead of dying in a log. **Best-effort must still
  be visible** — that is the lesson, not "add a try/catch".
- **UI**: `components/BlogManager.tsx` (category chips with inline create/delete + filter, posts
  list, New post), `components/BlogPostEditor.tsx`
  (title/category, Write↔Preview markdown editor, Save, Publish/Unpublish — publishing always
  saves current edits first — live-URL bar with copy). Note: the editor's public-URL origin is
  applied post-mount via `useEffect` — reading `window.location` during render was a real
  hydration mismatch caught live.
### Public blog (0033)

The blog is a real published site, not just per-post links.

- **URLs**: index `/b/{blog_slug}`, post `/b/{blog_slug}/{post_slug}` — both served by
  `app/b/[...path]/route.ts`. Legacy `/b/{uuid}` links **301** to the canonical slug URL (the
  UUID branch is kept forever; anything already shared keeps working). Slugs are generated from
  titles via `slugify()` and de-duplicated with a numeric suffix — post slugs are unique per blog,
  the blog slug is globally unique, both by partial unique index. `RESERVED_SLUGS` in the settings
  route stops a blog slug shadowing a real path.
- **Custom domains**: `custom_domains.serves_blog` opts a verified domain into hosting the blog at
  its root (`app/d/[[...path]]/route.ts`). Explicit `custom_domain_routes` are checked FIRST and
  always win, so one domain can host mapped funnel pages *and* the blog on every other path. On a
  domain, `siteOrigin` is threaded into the renderers so links/canonical drop the `/b/{slug}`
  prefix and point at that domain.
- **Renderers** (`lib/blog.ts`): `renderBlogIndexHtml` (card grid: featured image, title, excerpt,
  category, date) and `renderPublicPostHtml` (site header, byline, featured-image hero, article,
  author box) share one `PUBLIC_CSS` constant so the two can't drift. Both self-contained, no
  scripts, indexable.
- **Featured images**: `blog_posts.featured_image_url` (validated data URL, 900k cap). Three
  sources — upload (`components/FeaturedImageField.tsx`), AI generation, or inherited from the
  campaign's `embedded_image_data_url` on import. Drives `og:image` and flips the Twitter card to
  `summary_large_image`.
- **AI generation** reuses the kie.ai pipeline exactly: `lib/engine/blogimage.ts` mirrors
  `creativeimage.ts`'s five stages (16:9 instead of 1:1), a `generate_blog_image` job type in
  `worker.ts` with its own `failJob` branch writing `featured_image_status='failed'`, and
  `stageVerify` re-checking `post_id` against `job.user_id` — the payload is not trusted just
  because the queueing route checked it. Same nominal 100/day runaway-loop cap as the others.
- **Author/blog identity**: `blog_settings` gains `slug`, `description`, `author_bio`,
  `author_avatar_url` — the author box renders under every post and at the foot of the index.
- **Verified live**: index/post/legacy-redirect/404s, slug normalization ("Woodworking Reviews!!"
  → `woodworking-reviews`), featured-image hero + card thumbnail + `og:image`, author box,
  canonical, and that unpublishing removes a post from BOTH its own URL (404) and the index. An
  SVG featured image and a reserved slug are both rejected. All test data reverted afterward.
- **Pagination + category filter** (0034): both are query params on the index —
  `?category={slug}&page={n}` — deliberately NOT path segments, which would risk a category slug
  shadowing a post slug under `/b/{blog}/{...}`. Page size is `postsPerPage(settings)` — the
  tenant's chosen columns x rows (see Blog home layout below), defaulting to 3x4 = 12.
  `POSTS_PER_PAGE` survives only as the fallback for callers with no settings row.
  `lib/blogIndex.ts`'s `loadBlogIndex()` is shared by the app-domain and custom-domain routes so
  the two can't drift; it returns `null` for an unknown category or a page past the end, which
  both callers turn into a 404 (a typo'd filter must not silently render everything). Chips only
  list categories that actually contain a published post — an empty chip is a dead end.
- **Blog home layout** (0065): `blog_settings.index_layout` (`grid`|`list`), `index_columns` (1-4)
  and `index_rows` (1-12), edited on `/blog/home` under the intro editor. Columns x rows IS the
  page size — deriving it (`postsPerPage()`) rather than storing a separate "posts per page" is
  what stops the pager and the visible grid from disagreeing. `indexLayout()` clamps whatever is
  stored, so a bound change later can't break existing rows; the API route REJECTS out-of-range
  input instead of clamping, because a request naming 9 columns is a client with the wrong idea
  and silently saving something else would leave the UI showing a setting the server didn't take.
  A list ignores the stored column count rather than applying it, so switching to list and back
  doesn't look like it lost the setting. Fixed `cols-N` CSS classes use `minmax(0,1fr)`, not an
  auto-fill min width — 4 columns really means 4; one media query handles narrow screens.
- **The blog home editor has no inline live-preview iframe.** It uses `EditorPreviewButton` like
  every other editor in the app; the old always-on iframe below the canvas was the odd one out.
- **The post list is a block on the canvas, not a form below it.** `WysiwygCanvas` takes an
  optional `appendix` — an editor-only block pinned after the tree, with its own hover ⚙ and its
  own side-rail panel (via the shared `EditorSidePanel` chrome). It exists for page furniture that
  is *generated* rather than authored, so it has no place in `page_copy` but is still part of the
  page you're looking at. Not draggable and not deletable: its position on the real page is fixed.
  `StaticBlockWrapper` is `RootBlockWrapper` minus the drag handle, so it can't look reorderable.
  The appendix id must not collide with a real block id (`__post_list__` is prefixed for that
  reason) — `findBlockLocation` can't resolve it, so selection is checked by id separately.
  `blog_categories.slug` is unique per blog, backfilled from existing names in the migration.
- **Paginated SEO**: each page self-canonicalises and carries `rel="prev"`/`rel="next"`; filtered
  and paged views get distinct `<title>`s ("Blog — Tool Reviews", "Blog — Page 2") so search
  results aren't a wall of identical entries. Filter/pager are plain links — the public pages
  still ship zero JS.
- **Verified live** with 15 published posts across 2 categories: 12 + 3 across two pages, correct
  per-category counts (7 + 8), active chip marked `aria-current`, `rel` links present/absent at
  the right ends, and 404s for `?page=99` and `?category=nope`. Test data reverted afterward.
- **Feeds**: `/b/{blog}/rss.xml` and `/b/{blog}/sitemap.xml` (root-level on a custom domain, which
  also gets its own `robots.txt` pointing at that sitemap — the app-wide `app/robots.ts` only
  answers for the app's own host). Reserving those names is safe because `slugify()` strips dots,
  so no post slug can ever collide. Both are unpaginated/unfiltered (`loadAllPublishedPosts`,
  capped at `MAX_FEED_POSTS` = 1000) and 5-minute cached. Escaped with the same `escapeHtml()`
  used everywhere else — it covers `& < > "`, exactly what XML text and double-quoted attributes
  need, so a tenant title can't break the document; deliberately no CDATA (which would need its
  own `]]>` escaping). Index and post pages advertise the feed via `<link rel="alternate">`.
  Verified live against a post titled `Feed Post & One <tagged>`: both documents parse as
  well-formed XML with the entities escaped.
- **Still deferred**: no paginated sitemap index (irrelevant under 1000 posts).

## Per-block responsive visibility

Any block can be hidden on desktop, tablet or mobile independently — `hidden?: Viewport[]` on the
block `Base`, set from the three toggles at the top of the block settings panel.

- **It is a CLASS, never an inline style.** `styleToInlineCss` builds a `style="..."` attribute and
  a media query cannot live in one, so the renderer emits `hide-desktop`/`hide-tablet`/`hide-mobile`
  and the three rules live in `PAGE_STYLE` (renderPages.ts) and `PUBLIC_CSS` (lib/blog.ts).
  **Those two stylesheets must not drift** — the comment in each says so. Breakpoints match the
  editor's own device toggle: mobile below 640, tablet 640-1023, desktop 1024 up.
- **`withVisibility()` merges the class into the block's existing root tag** rather than being
  threaded through `styleAttr`. Most element cases already write their own `class="..."`, and two
  class attributes on one tag is invalid HTML where the browser silently keeps the first. Parsing
  the tag by hand is safe here for a specific reason: `escapeHtml` turns `>` into `&gt;`, so no
  attribute value can contain the delimiter it scans for.
- **The disclosure can never be hidden.** Content rule 3 makes it mandatory, and "hidden on mobile"
  would put an undisclosed affiliate page in front of most of the real traffic. Enforced in the
  validator (`withHidden` returns the disclosure untouched), not only by leaving it out of the panel.
- **The validator has to carry `hidden` through** — it returns a freshly-built tree, so anything not
  copied is dropped on every save. Same trap `contentWidth` hit. Unknown viewport names are filtered
  out rather than rejected: refusing to save a page over one stray string is the worse failure.
- **In the editor a hidden block is dimmed and badged, never removed.** A block you cannot see is a
  block you cannot select to unhide — that is how a page ends up with something invisible on mobile
  and no way to find it. Only the CONTENT dims (`opacity-40` on an inner div); the hover controls
  stay at full strength, since they are exactly what you reach for to bring it back. The wrappers
  learn the previewed width from a `DeviceContext` rather than a prop threaded through
  `SectionBody`/`RowEditor`/`ColumnEditor` — those are module-scope components whose stable identity
  is load-bearing for `EditableText`'s mount-once pattern.
- Verified directly against the renderer and validator: a class-less tag (`<h1>`) gains one, a
  tag with its own class (`icon-list`, `block-btn`) has it merged, a block with no `hidden` is
  byte-identical to before, nested elements and rows round-trip, and the disclosure's `hidden` is
  stripped on save.

**The palette also offers Section now, and lists elements as a grid.** A Section is the only thing
rows and elements can live in, so reaching one only by already having one was a gap;
`insertSection` is root-only, matching `moveBlockToContainer`'s own rule that a Section never nests,
and a new one is empty on purpose (what goes in it is the next decision). The element list became a
two-column grid of icon-over-label tiles: with ~20 types a single column ran past the fold, and a
tile is a bigger drag target. The collapsed rail is still one icon column — there is no room for two.

## Page settings (the canvas ⚙)

`WysiwygCanvas` takes an optional `settings={{ title, panel }}` and renders a ⚙ in its device
toolbar. Every BLOCK already had a settings affordance; the PAGE itself was the only thing on
screen you couldn't open settings for. It shares the side rail with `BlockStylePanel` and the
appendix panel — one panel at a time, selecting a block takes the rail back — via a
`__page_settings__` sentinel that `findBlockLocation` can never resolve.

The blog post editor is what this exists for. It was already a fullscreen overlay (same
`fixed inset-0` treatment as the funnel editor's edit views) but the canvas sat under a stack of
form sections — featured image, excerpt, slug, SEO fields, SEO panel — so it read as a form with a
canvas at the bottom rather than an editor. Those sections moved behind the ⚙ unchanged: same
components, same state, not a second copy.

## Video block

`video` is an element block like any other (palette, drag, style panel), but its content is not a
URL — it's a PARSED `{provider, videoId}` (or `{provider:'file', url}`), and the renderer rebuilds
the embed URL from a fixed template in `lib/engine/videoEmbed.ts`. **There is no code path from a
tenant-typed string to an `<iframe src>.** That matters more here than for a link: an `<a href>`
needs a click, an iframe loads whatever it points at unprompted, on a page served to paid traffic.
Same "closed by construction" reasoning as `styleToInlineCss`'s fixed key table.

`parseVideoUrl` accepts the forms people actually paste (watch/share/embed/shorts/youtu.be, vimeo
and player.vimeo, plus a direct https `.mp4`-style URL) and rejects everything else — non-http(s)
schemes are refused before host matching runs, ids are matched anchored (`[A-Za-z0-9_-]{11}` for
YouTube, digits for Vimeo), and unknown hosts get nothing. `http:` direct files are refused too:
mixed content silently fails to load on an https page, which reads as a broken block rather than a
blocked one. YouTube renders through `youtube-nocookie.com`, matching how consent is treated
elsewhere in this codebase.

The validator **re-parses on every save** rather than trusting the stored shape, so a hand-edited
row can't smuggle a source past it; an unparseable one becomes `null`, which renders nothing,
rather than an error that would block saving the rest of the page. Verified directly: forged
`videoId` and `provider:'file'` + `javascript:` both normalize to null and only the legitimate
iframe reaches the HTML.

`.video-wrap` (in BOTH `renderPages.ts` and `lib/blog.ts` — the two stylesheets must not drift)
owns a 16:9 padding-top ratio so an iframe (no intrinsic size) and a `<video>` (which has one) lay
out identically.

**This unblocked VSL and Webinar** in `lib/funnelTypes.ts` — they were `needs_video` for exactly
this reason, and their templates seed an empty video block above the copy (`VIDEO_FIRST_TYPES`),
since a VSL template without one is just a squeeze page with a different headline. Survey
(`needs_branching`) and Book (`needs_payment`) are still correctly blocked.

## The form's own button decides what happens next (primary_cta is gone from opt-in pages)

An opt-in page used to carry TWO buttons: the form's submit, and a separate locked `primary_cta`
holding the hoplink, hidden in `#step2` until the form was submitted. In the editor both render at
once, so the second one read as a stray duplicate — and it was, once forms became droppable blocks
with their own settings.

`LeadCaptureFormBlock.content.afterSubmit` (and the same field on the standalone `FormBlock`) is
now where the destination lives — a closed `FormSubmitAction` union, same discipline as
`ButtonAction`:

- **`offer`** — the default for an opt-in form, and where the old CTA pointed: the next funnel step
  when the funnel has one, else the hoplink. **Resolved in `afterSubmitAttrs()` at RENDER time from
  `RenderCtx`**, so the affiliate link is never something page content could carry or a tenant
  could type. This is what replaced the old `data-next-step-url` attribute.
- **`url`** — a destination the tenant types, through `isValidRedirectUrl`.
- **`popup`** — open another form block on the page, by id.
- **`message`** — stay put and show the success text. The default for a standalone form, i.e. its
  behavior before this existed.

**Anything unusable degrades to `message`; it never throws.** A form that refuses to SAVE because
the block it pointed at was deleted would be a page you can't edit your way out of, and a form that
saves the lead and then visibly does nothing is the exact failure the `[object Object]` bug
produced. Verified: `javascript:` and a quote-injecting popup id both collapse to `message`, while
a real `https` destination survives.

**`primary_cta` is not gone from the schema — it is gone from opt-in pages that have a form.**
`reconcileBridgeCta()` (validatePageBlockTree.ts) enforces "a form or a CTA, never both" on
`pageKind: "bridge"`: with a form it drops the CTA so the stored tree matches what renders, and
with NO form it appends one, because that button is then the page's only way out.

**"Has a form" means ANY form, at any depth** — `treeHasForm()`, not a root-level
`lead_capture_form` check. A standalone `form` block dropped into a section collects leads and has
its own after-submit action just the same, so the narrower check left such a page (the YU SLEEP
funnel was one) carrying both its form's submit button and a primary_cta — the same duplicate, one
level down. **And dropping the CTA hands its destination over**: `inheritOfferAction()` promotes
the page's last form from the default `message` to `offer`, because a standalone form defaults to
"show a message" and removing the CTA without transferring its job would leave a page taking paid
traffic with no route to the offer at all. A form already pointing somewhere specific is left
alone — verified. **Funnel steps
are untouched** — thank-you/upsell/order pages have no form by design, so `primary_cta` is still
required and still carries `cta_action`/`redirect_url`/`decline_action`. The renderer applies the
same condition independently, so a tree stored before this still renders correctly.

**A real behavior change on live pages, deliberately**: submitting now goes straight to the offer
instead of revealing a button to click. Same destination, one fewer click. Verified live on
`1800mastercard.com/prodentim` — one visible CTA, no `#step2`, the lead saved, and the browser
landed on the real `hop.clickbank.net/?affiliate=…&vendor=PRODENTIM&tid=page`.

Settings live in `BlockSettingsPanel` (content settings, not style) — select the form, set its
button label and its after-submit action there.

## Standalone forms and button actions

**A `form` block can be dropped anywhere** — as many per page as you like, or none. Distinct from
the locked `lead_capture_form` on a funnel opt-in page, which stays for pages that use it. It posts
to the SAME `/api/public/leads` with the same field-key validation rather than growing a second
write path for anonymous visitors, which is the one thing that must not happen here.

`extractLeadFormFields` now walks the WHOLE tree (sections, rows, columns), not just root: a
standalone form can be nested and a page can have several. Every legitimate key on the page has to
be in that union or the leads route silently drops it. `popup: true` renders the form hidden, shown
only by a button.

**A button's action is a closed union, not a URL string with special values smuggled in**:
`link` (the only one that produces an href, still through `isValidRedirectUrl`), `scroll`
(a block id, scrolled to by the page's own script), `popup` (a form block id), `submit`. Ids are
`ID_RE`-checked, so `x" onclick="…` is rejected at save rather than escaped into an attribute and
hoped about. A `scroll`/`popup` target that names nothing on the page does nothing — deleting a
block a button pointed at must not block saving the page.

Pages saved before actions existed carry a bare `href`; both the validator and the renderer promote
that to `{kind:"link"}` rather than a migration — the same permanent-adapter habit as `PageCopy`.

Verified: link/legacy-href/scroll/popup all render the right element, `javascript:` and a
quote-injecting scroll target are both rejected, and a standalone popup form renders its email +
extra field with its key reaching `extractLeadFormFields`.

## Cookie / GDPR consent

`tracking.consent_enabled` turns on a consent gate for a funnel's tracking snippets, configured in
the same Tracking panel as the IDs (no migration — it rides in the existing `tracking` jsonb, so it
goes through the same validate + re-render path).

**Consent actually GATES the tags, which is the whole point.** With it on, `renderTrackingHtml`
emits the snippets inside an inert `<template>` and nothing runs until Accept, at which point a
code-owned script recreates the script elements into `<head>`. Decline stores the choice and loads
nothing. A banner shown over an already-fired Meta Pixel is not consent — it's a notice about
something that already happened, and under GDPR/ePrivacy that's arguably worse than no banner
because it documents the breach.

Three consequences worth keeping:
- **The `<noscript>` pixels are DROPPED when gating.** A `<noscript>` image fires unconditionally
  and can't ask anyone anything, so leaving it in would leak exactly what consent holds back.
- **No banner when there are no tags.** A consent prompt on a page that sets no cookies trains
  people to dismiss prompts that never needed asking; the panel says so rather than rendering one.
- **No "consent by continuing to browse"** — invalid in the EU since Planet49 (2019). Decline is a
  real, equally-reachable button, not greyed out or hidden, which is the dark pattern regulators
  single out.

Verified directly: gating off behaves exactly as before (tags in `<head>`, noscript present); gating
on puts them in a template with no noscript and shows the banner; a `javascript:` policy URL is
rejected at save; banner text is escaped.

## Carousel and countdown blocks

**Carousel is CSS scroll-snap, not a JS carousel.** It swipes natively on touch, scrolls with a
trackpad, and takes arrow keys once focused (`tabindex` on the overflow container is what makes it
keyboard-reachable at all). It emits **no script**, which is what lets it sit on a blog post
without breaking that page's zero-JS property — verified. The trade is no auto-advance and no
arrow buttons; both would need a script for something a finger already does. A carousel whose
slides all lack an image renders nothing rather than an empty track.

**Countdown is the one block that genuinely cannot work without JS**, so it inlines a small
code-owned script NEXT TO the block rather than in the page shell — a page without a countdown
still ships zero JS. Only numbers reach that script (deadline as epoch ms, minutes as an integer)
via data attributes; every visible string is escaped into the HTML and never interpolated into JS.
Verified: `minutes: "1);alert(1);//"` stores as 15 and renders `data-minutes="15"`, a script-tag
deadline stores as null and renders nothing at all, and label/caption XSS is escaped.

**Evergreen countdowns persist per visitor** (localStorage, keyed by block id) and **do not loop**;
at zero they swap in an expired message. That is deliberate and shouldn't be "simplified" away: a
countdown that resets on refresh tells every visitor the offer is expiring and then proves it
isn't, which is the deceptive-urgency pattern content rule 2 already rules out and the one
regulators actually act on. The evergreen window is capped at 7 days for the same reason. `date`
mode counts to a real instant and renders nothing until one is set.

## Page theme (palette / typography / buttons / form)

`PageBlockTree.theme` — same slot as `contentWidth`, for the same reason: one setting covers the
funnel opt-in, split-test variants, funnel steps and blog posts with no migration. Edited from the
canvas ⚙ (`components/PageThemePanel.tsx`).

**`lib/engine/pageTheme.ts` is the only place a theme becomes CSS**, and it works exactly like
`styleToInlineCss`: a fixed key table, per-key regex/range checks, and nothing but a clamped number
or a `#rrggbb` string is ever interpolated. Fonts are an enum mapped through `THEME_FONT_STACKS`,
never the stored string. Verified that `"#fff;} body{display:none}"` as a colour is dropped rather
than closing the rule.

**It emits CSS variables; the stylesheets stay constants.** Every themeable rule in `PAGE_STYLE`
and `PUBLIC_CSS` reads `var(--t-…, <its pre-theme value>)`, so a page with no theme renders exactly
as it did before themes existed, and a themed page overrides only what it set. That fallback is
what makes this safe to ship against pages already serving ad traffic.

**Themes are generated as part of the kit, from the product's own sales page.**
`extractBrandColors` (`lib/engine/salespage.ts`) reads hex/rgb colours out of the RAW html —
it has to run before cheerio strips `<style>`, which is where the colours live — drops greys,
near-white and near-black as structure rather than brand, and ranks the rest by frequency.
`themeFromBrandColors` then takes **only the accent**: the brand colour drives buttons, links and
the testimonial rule, while the page background and body text stay at the defaults. A palette
generated wholly from a vendor page would regularly be unreadable (dark-red-on-black is a common
sales-page look) and this page exists to convert paid traffic. The hover shade is computed by
darkening, and the button label is black or white chosen by the primary's real WCAG luminance —
verified that a pale brand colour yields a dark label rather than white-on-yellow.

## The affiliate disclosure always renders last

`renderBlockTree` hoists the `disclosure` block to the end regardless of where it sits in the
stored tree. It's a footer notice by convention and every ad reviewer expects it there, but it was
a root-level draggable block, so a page could legitimately ship with the disclosure above the fold.
Hoisting at render (rather than reordering stored trees) means existing pages get the right
placement on their next render with no migration, and nothing can drag it back out of place.
Content rule 3 says the disclosure is mandatory; this decides where. Verified across three stored
orders — disclosure first, middle and last all render it last.

## Content width

`PageBlockTree.contentWidth` (px) drives `width:90%; max-width:<n>px` on the published content
column. **Stored on the TREE, not on a column of `campaigns`/`blog_posts`** — `page_copy` is the
one field a funnel opt-in, a split-test variant, a funnel step and a blog post all already have,
so one setting covers four page kinds with no migration. Edited from the canvas ⚙
(`components/ContentWidthField.tsx`, shared by all three editors).

The percentage is why there is no separate mobile setting: a narrow screen gets a gutter for free
and this number only decides how wide the page may become on a big display. It reaches the
published CSS as `--content-w`, so `PAGE_STYLE`/`PUBLIC_CSS` stay constants and only one
declaration varies per page. **Only a clamped integer is ever interpolated** (`contentWidthOf`,
480-1600) — verified that a string like `"wide; background:url(x)"` collapses to the default
rather than reaching the stylesheet.

**The default changed from 680px to 1280px, which visibly reflows every existing page.** Pages
built before this have no stored `contentWidth`, so they take the new default the next time they
render. "Narrow · 680" is a one-click preset for exactly that reason — the old measure had to stay
one click away, not be a number you have to remember.

Two things that would silently break it, both handled: the validator rebuilds the tree, so it has
to carry `contentWidth` through or every save would reset the page to default; and the blog's
public routes had to start selecting `page_copy` (they only ever needed the pre-rendered `html`
before). The canvas's desktop preview honours the width too, so the control does something visible
before you publish.

## Testimonial block

One element type with three media shapes (`text` | `image` | `video`), not three block types —
quote/name/role are the same fields either way, and splitting them would lose what you'd typed the
moment you decided to add a photo. Switching media in the editor keeps the other variant's value,
so flipping image↔video↔text and back doesn't destroy anything.

**The video variant stores a PARSED `VideoSource`, never a URL string** — same rule as the video
block, and it matters more here: a testimonial is the block most likely to have a link pasted into
it. `validatePageBlockTree` re-parses from the display URL on every save rather than trusting the
stored shape, so a hand-edited row can't smuggle anything into an iframe `src`. Verified directly:
a forged `videoId` containing `"><script>` and a `provider:"file"` + `javascript:` URL both
normalize to `null` and render no iframe at all; XSS in the quote and name is escaped; an unknown
`media.kind` falls back to text rather than failing the save.

**An empty testimonial renders nothing**, like the video block's null source — a quote box
attributed to nobody is worse than no block. The image variant goes through the same
`resizeImageFile` + `isValidImageDataUrl` path as every other image here (`pickImage` gained a
patch-shape argument so both call sites share one resize, rather than the testimonial growing its
own FileReader).

`EditableText` gained `placeholder`, rendered via `empty:before:content-[attr(data-placeholder)]`.
An empty contentEditable collapses to a caret-sized target nobody can find, which is exactly the
state a freshly-inserted testimonial starts in.

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
- **A palette item is DRAGGABLE as well as clickable**, so you can put a block where you want it
  instead of always appending at the end and dragging it back. `PaletteDraggable` wraps each
  row/element button in `useDraggable` with an id that encodes what to create
  (`palette-el:{type}` / `palette-row:{layout}`) — there is no block to move yet, so `handleDragEnd`
  branches on that prefix BEFORE its root/nested branches and calls `insertElement`/`insertFormInput`/
  `insertRow` at the drop index instead of `moveBlockToContainer`. The click handler stays: the
  shared `PointerSensor`'s `activationConstraint: {distance: 4}` is what lets one element be both.
  **This is why `<DndContext>` moved out to wrap the whole three-zone layout** — it used to sit
  inside the canvas column, and dnd-kit only tracks draggables mounted under the same context as
  their droppables, so a palette rail outside it could not be dragged from at all.
  `paletteDropTarget()` resolves the drop the same way the nested branch does, with one addition:
  root can never hold an element or a row, so a drop onto a Section resolves to *inside* that
  section rather than beside it — otherwise the most obvious target on the page would do nothing.
  **Standing caveat, unchanged**: this session's tooling cannot simulate a real dnd-kit pointer
  drag, so the insert logic and the build are verified but the gesture itself needs a manual pass.
- **Save & Republish + Preview render at BOTH ends of the canvas** in `PageEditor` and
  `FunnelStepEditor` — one `actions` JSX value rendered twice, never two copies, so they cannot
  disagree about disabled state or the "Saved" indicator. The canvas is a full-screen editing
  surface; whichever end you have scrolled to, the actions should be there. (`BlogPostEditor` keeps
  its single sticky top bar — sticky means always reachable, so a second copy would be noise.)
- **Hover-revealed controls at the block's side, never below**: `RootBlockWrapper`'s top-right
  hover cluster gained a `Settings2` button (`title="Block settings"`, calls `onSelect`) beside
  the drag grip; `NestedItemWrapper`'s left-edge cluster is now grip + `Settings2` + delete. All
  stay `opacity-0 group-hover:opacity-100` — the settings icon is not always visible, per the
  request.
- **Full-bleed by design**: both editor overlays (`app/(app)/funnels/[campaignId]/page.tsx`,
  `components/BlogPostEditor.tsx`) use a plain `px-4 py-6` wrapper — no `mx-auto max-w-*` column.
  The desktop device preset is `width: 100%` so the canvas fills whatever the centre column
  gives it; tablet (480) and mobile (360) stay pinned to real device widths, which is what the
  toggle is for. Remaining left inset is the palette rail (collapsible), right inset is 33px of
  page padding. Fidelity caveat: the PUBLISHED page renders inside its own max-width container,
  so a very wide monitor shows longer lines in the editor than a visitor gets — switch to Tablet
  to judge real line length.
- **Verified live** (TedsWoodworking opt-in editor, desktop viewport): palette renders and
  collapses to icon-only rail with state persisted; clicking a block's side `Settings2` opens the
  style panel docked right (canvas narrows, panel is a readable single column); palette "Heading"
  click inserted a `New heading` into the section holding the selection (then deleted via the
  hover delete button — nothing saved, server data untouched); closing the panel restores the
  full-width canvas. Same standing caveat as O.3: real drag gestures can't be simulated by this
  session's tooling.

## Workspaces / teams — multi-tenancy, complete

`workspaces` + `workspace_members` (owner/admin/member) + `workspace_invitations` (0041), and
since 0057/0058/0059 **the workspace actually owns the data**. 38 tenant tables carry a NOT NULL
`workspace_id`; RLS on all of them is `is_workspace_member(workspace_id)`. Team UI at
**Settings → Team**, invitations accepted at `/invite/{token}`.

**Two layers, and confusing them is the mistake to avoid.** RLS (`is_workspace_member`) decides
whether a row is visible *at all* — that is the security boundary. The active workspace — resolved
per request by `lib/workspace.ts`'s `currentWorkspaceId()` (subdomain slug first, then
`profiles.active_workspace_id` via `current_workspace_id()`) — decides which of *your* workspaces
the UI is showing — that is UX. Queries still filter `.eq("workspace_id", ws)` explicitly, exactly
as they always also filtered on `user_id` despite the policy: belt and braces, and it keeps a
member of two workspaces from seeing both lists merged. **The scope really is resolved in one
function now — it wasn't when this section was first written.** `lib/workspace.ts` claimed to be
the single resolver while having zero callers; all 60 server-side sites inlined
`rpc("current_workspace_id")` themselves, none checking the error. Phase 3 (subdomains) forced
the consolidation: every server page/route now calls `currentWorkspaceId()` /
`currentUserAndWorkspace()`, and nothing else should ever inline the RPC again.

- **`user_id` stays on every table** as created-by attribution ("who launched this ad"). It is no
  longer a scope. Nothing should filter on it except the person-scoped tables below.
- **Deliberately NOT workspace-scoped**, because they describe a person: `notifications`,
  `referral_codes`, `rewards_ledger`, `referrals`, and `usage_ledger` (so per-member generation
  spend stays attributable). `profiles` is identity. Those four keep `auth.uid() = user_id`.
- **Roles do not gate data.** owner/admin/member all read and write the workspace's content; roles
  gate only invitations, role changes and ownership transfer. One uniform policy across 30 tables
  is the version that can actually be verified.

**The trigger is the load-bearing safety net, not a convenience.** `stamp_workspace_id()` (0058)
fires BEFORE INSERT on all 38 tables and fills `workspace_id` when the caller left it NULL —
explicit values always win. It exists because the engine runs as `service_role` and bypasses RLS,
so one forgotten `workspace_id` would have created a row that succeeded and was then invisible to
everyone, silently. Auditing ~90 insert sites and hoping was not a security model. It resolves two
ways: a signed-in caller gets `current_workspace_id()`; a service-role caller gets the row owner's
workspace, the same rule the backfill used. **`NOT NULL` (0059) is the second half** — together
they make the invisible-row failure impossible rather than unlikely. Never drop either.

**Sequenced in three deployable steps on purpose** (0057 add + backfill + permissive OR → app
conversion → 0059 enforce). The dangerous window in a migration like this is the one where
deployed code and RLS disagree about what a row belongs to; a policy accepting
`user_id OR workspace_id` removes that window instead of shortening it. Reuse this shape.

Things worth knowing if you extend this:
- **`handle_new_user` creates the workspace.** It didn't before, which is why three accounts that
  signed up on 2026-08-01 had none and would have failed 0059's NOT NULL. Workspace creation is
  wrapped in an exception handler: a user with no workspace is recoverable, a failed signup isn't.
- **The public blog identifies a blog by workspace, not by owner** (`/b`, `/d`, `lib/blogIndex.ts`).
  Scoping it to the owner would make a post written by an invited teammate vanish from a published
  blog.
- **`product_stats` groups by workspace ALONE.** Grouping by `(workspace, user)` emits one partial
  tile row per member instead of one describing the workspace. `audit_events` carries both.
- **A user id passed into a parameter renamed `workspaceId` is still a `string`** — `tsc` cannot
  catch it. Four of those were found by grepping call sites, not by a clean typecheck. Grep when
  you rename a scope parameter. **A fifth surfaced on 2026-08-05 and it broke Build kit outright**:
  `worker.ts`'s `processBuildCampaignStage` called `getAffiliateId(job.user_id, …)` while
  `network_connections` has been workspace-scoped since 0057, so the lookup never matched and
  EVERY `build_campaign` job died with "No clickbank connection found — connect your clickbank
  affiliate ID first" no matter how the connection was set up. Four jobs burned five attempts each
  across two days. Two things hid it: the promote route's own check is correctly workspace-scoped,
  so it passed and queued the job (the two layers disagreeing is exactly what made the message a
  lie), and until the progress dialog shipped, a terminally-failed build said nothing at all in the
  UI. Confirmed against the live database that the old lookup returns NULL and the fixed one
  returns the real affiliate id for the same job. **When a check exists at both the route and the
  worker, verify they scope on the same column** — divergence there is invisible until a job fails.
- The `assert_owns_*` functions are membership checks now; a plain ownership check would refuse an
  invited member their own workspace's campaigns.
- Slugs are reserved against `reserved_workspace_slugs` so a workspace can't take `api`, `app`,
  `settings`, `blog`, `w`, `p`, `b`, `d` or `r` — each a real route today or a DNS label later.
- A partial unique index enforces one owner per workspace, which is why ownership moves only
  through `transfer_workspace_ownership()`; any other order violates the index.
- `is_workspace_member`/`workspace_role` are SECURITY DEFINER so policies on `workspace_members`
  don't recurse through that table's own RLS.
- Invitation tokens are separate from row ids: the id appears in admin listings, and something
  already shown to other members must never also be the credential that joins the workspace.
- Accepting does NOT require the invited address to match the signed-in one — people sign up with
  a different address routinely, and the token is the credential. Expiry + single use are enforced.
- No invitation *email* is sent yet; the UI surfaces the link for the admin to send.

**Verified by impersonating real users under RLS** at each step: every tenant sees exactly what
they owned before and none of anyone else's; a client insert that omits `workspace_id` still
passes `WITH CHECK` (the trigger fills it before the check runs) and lands in the right workspace;
and a temporarily-added member gains visibility of the workspace's products, with the membership
removed in the same transaction.

## Per-organization subdomains (Phase 3)

Each workspace lives at `{slug}.affiliateoffersecrets.com`, canonically: signing in on the
canonical host redirects you to your workspace's subdomain, and the URL itself says which org
you're in. Feature-flagged entirely by env: **`NEXT_PUBLIC_ROOT_DOMAIN` turns the whole thing on**
(classifier + canonical redirect), `NEXT_PUBLIC_COOKIE_DOMAIN` makes the session domain-wide.
Both are `NEXT_PUBLIC_*` — inlined at build time, each change needs its own deployment. Unset,
the app behaves exactly as pre-Phase-3, which is also how dev runs by default.

- **`lib/host.ts` is the one place a Host header is interpreted** — `classifyHost()` returns
  app / workspace(slug) / custom; middleware switches on it (only `custom` rewrites to `/d`),
  `lib/workspace.ts` resolves scope from it, `lib/publicPage.ts` restricts public serving by it.
  `*.localhost` is a workspace host so all of this is testable in dev with zero config
  (`acme.localhost:3400`) — which also fixed the old `host.startsWith("localhost")` check that
  classified `acme.localhost` as a tenant custom domain.
- **`workspace_id_for_slug(p_slug)` (0060) folds membership into the lookup** — NULL for "no such
  workspace" and "not a member" alike, so a subdomain can't probe which workspaces exist. Public
  serving deliberately does NOT use it (anonymous visitors have no membership):
  `publicWorkspaceScope()` in `lib/publicPage.ts` does a plain admin-client slug lookup and every
  caller collapses a mismatch to the same generic 404. **A workspace subdomain only ever serves
  its own workspace's funnels, images, and blog** — without that check, campaign UUIDs being
  host-independent meant acme's subdomain would happily serve globex's funnel under acme's brand.
- **Cookies** (`lib/supabase/cookieOptions.ts`): `NEXT_PUBLIC_COOKIE_DOMAIN` drives both the
  Domain attribute AND a renamed session cookie (`aos-auth`) — old host-only cookies and new
  domain-wide ones with the same name are both sent with undefined precedence (intermittent
  logged-out loop), so the rename deterministically signs everyone out exactly once when this
  first deploys. OAuth state cookies are domain-wide (a connect flow started on a subdomain lands
  on the canonical host's registered callback); their clears carry the same domain or they'd
  silently no-op. The sticky A/B cookie is host-AWARE via `cookieDomainForHost()` — on a tenant's
  BYO custom domain a Domain naming our root would make the browser reject the entire Set-Cookie.
- **Cross-host redirects in middleware use `redirectToHost()`, never `NextResponse.redirect()`**
  — Next relativizes an absolute Location whose origin it considers its own, including hand-set
  headers for loopback-family hosts (localhost AND 127.0.0.1; www.localhost and real domains
  survive — all observed live). Dev's canonical host is therefore `www.localhost:{port}`, which
  browsers resolve unaided and `classifyHost` treats as app.
- **The canonical redirect lives in `app/(app)/layout.tsx`, not middleware** — so marketing,
  `/login`, `/p`, `/b`, every API route, and `/admin` (cross-tenant by nature) never redirect.
  Path preserved via the `x-pathname` header middleware stamps. On a subdomain, marketing paths
  and `/login` bounce OUT to the canonical host; the bare subdomain root goes to `/dashboard`.
- **The funnel step chain is baked HOST-RELATIVE** (`/p/{id}/step/{n}`, `lib/funnelSteps.ts` +
  both page-copy PATCH routes) — a visitor continues on whatever host they entered on, and a
  workspace rename can't break a chain. **Real Meta ad `link_url`s stay absolute on the canonical
  host on purpose** (`lib/engine/adlaunch.ts`) — an ad already spending must never depend on a
  mutable slug; same for Instagram's fetched image URL and the unsubscribe link in emails.
  Copy-link UI (PublishBridge, LaunchAd preview, Funnels list) shows the current host's URL — the
  branded one the operator is looking at.
- **The blog is noindex on subdomains** (middleware header for `/b/*` on workspace hosts) — the
  canonical host's copy is the indexable one and the renderers' canonical tags already point there.
- The workspace switcher navigates cross-origin to the target workspace's own subdomain (writing
  `set_active_workspace` first so canonical-host landings follow), and derives the ACTIVE
  workspace from the host, not the RPC — the checkmark must agree with the URL.
  `/settings/team` resolves through `currentWorkspaceId()` now; it used to pick the first
  membership by `created_at`, so a two-workspace user could edit A while the switcher showed B.
- **LIVE since 2026-08-04.** The ship checklist is done: wildcard on the Vercel project,
  nameservers moved to Vercel (which also fixed the apex A records), both env vars set, rebuilt.
  Two snags worth remembering: Vercel showed "DNS zone not enabled … cannot solve dns-01" until
  the zone was explicitly enabled on the team (nameserver delegation alone is not enough), and
  resolvers/OS caches that queried a subdomain during the transition held the failure for a
  while — "page did not load" right after cutover is stale negative cache, not a bug. **The
  Vercel DNS zone starts with ONLY the system records (ALIAS + CAA)** — anything that lived in
  GoDaddy's zone (email MX/SPF/DKIM, verification TXTs) must be re-created in Vercel DNS or it is
  silently gone.

**Mail DNS, as of 2026-08-04.** Present: SendGrid's full domain authentication (`em2078`
return-path, `s1`/`s2._domainkey`, `url7871` link branding), a `_dmarc` TXT at `p=none`
(monitoring), and an apex SPF — `v=spf1 include:sendgrid.net ~all`, verified resolving with the
include chain expanding to SendGrid's real IP ranges. `~all` (softfail) rather than `-all` is
deliberate while SendGrid is the only confirmed sender; tighten it only once every sending source
is known, since a hardfail with a missing include silently drops real mail. **Adding another
sending service means EDITING that one record, not adding a second** — multiple SPF TXT records on
one name is a permanent fail, not a merge.

**There is deliberately still no MX record, and that is a live compliance gap, not an oversight.**
Nothing delivers to any @affiliateoffersecrets.com address, including
`support@affiliateoffersecrets.com` — which `lib/brand.ts`'s `SUPPORT_EMAIL` prints on Contact,
Privacy and Terms as the address for support and for GDPR/CCPA erasure requests. The choice was
offered (forwarder / Google Workspace / Zoho / skip) and skip was chosen knowingly. Until MX
exists, either point `SUPPORT_EMAIL` at an address that actually receives, or add MX — a published
erasure contact that bounces is a claim the product can't honour. Whichever mail host is chosen
will also need its own `include:` folded into the SPF record above.

## Settings

Sidebar **Settings** is a submenu, one page per item: **Profile** (`/settings/profile`, also hosts
Appearance), **Security** (`/settings/security`), **Integrations**, **Domains**, **Billing**.
`/settings` itself just redirects to `/settings/profile`.

**Integrations, Domains and Billing keep their own top-level URLs** — they're referenced from the
OAuth callbacks, the access gate (`hasAppAccess` → `/billing`), and a dozen in-app links, so
renaming the routes would be churn with no user-visible gain. Grouping them under Settings is a
navigation decision, not a URL one, which is why the parent nav entry's `match` has to recognise
their paths explicitly — miss that and the submenu collapses when
you're standing on one of those pages.

**`profiles` is SELECT-only for clients and must stay that way.** The general update policy was
dropped in 0002_trial.sql because it let a user self-grant `access_granted`. Profile edits go
through `update_profile(p_full_name, p_timezone)` (0039), which can only write those two columns.
Do NOT re-add a broad update policy to simplify a form — that is the exact hole 0002 closed.
Timezone is validated against `pg_timezone_names` at write time rather than by a CHECK, so a
future tzdata change can't invalidate existing rows.

**Changing a password re-authenticates first.** `supabase.auth.updateUser({password})` does NOT
verify the current password — it trusts the session — so `SecuritySettings` calls
`signInWithPassword` with the current password before updating. Without that, anyone with a
hijacked session could silently lock the real owner out. Don't "simplify" this away.
"Sign out everywhere" uses `signOut({scope:"global"})`, which revokes every refresh token.

**The forgot-password link must NOT rely on PKCE, and this was a real live failure.** Supabase's
default `{{ .ConfirmationURL }}` recovery link round-trips through `/auth/v1/verify`, which then
redirects to `/reset-password?code=…`. Exchanging that code needs a `code_verifier` written to
`localStorage` when the reset was *requested* — so the link only works in the same browser that
asked for it. A reset link is opened from an email client by definition, frequently on another
device and very often inside the mail app's own in-app browser, where that storage doesn't exist.
Observed live: Supabase verified the token and created a session (`recovery_token` cleared,
`last_sign_in_at` moved) while the page still showed "invalid or has expired" — and because the
token is single-use, it was already burned, so retrying the same link could never work. The
misleading message sent the user to check the clock when the cause was the browser.

`app/reset-password/page.tsx` now tries `token_hash` first (`verifyOtp` — the whole credential
rides in the URL, nothing read from storage, works in any browser), then the PKCE `code`, then the
implicit fragment. **The first branch stays dormant unless the Supabase "Reset Password" email
template links to `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`**
instead of the default — a dashboard setting no migration can carry, so it has to be re-applied by
hand if the project is ever recreated. When PKCE does fail for a missing verifier, the page now
says so specifically rather than claiming expiry.

**Changing the sign-in email and deleting the account both live on Security**, and both
re-authenticate with the current password first — a session is not proof of identity for an
account-level change, the same reasoning as the password form.

- **Email change** is `supabase.auth.updateUser({email})`. Supabase owns the confirmation round
  trip: nothing changes until the link is clicked, and with the project's "Secure email change"
  setting on it mails BOTH the old and new address, which is what stops a hijacked session quietly
  moving an account. Confirm that setting is enabled in the Supabase dashboard — the UI copy tells
  the user to check both inboxes.
- **Account deletion** (`app/api/account/delete/route.ts`) needs the password AND the account's own
  email typed back. Deleting the auth user cascades every tenant table, but **three things are
  outside the FK graph and are cleaned up explicitly first**: Vault secrets (every connector's
  `*_secret_id`), Storage objects in `campaign-videos`, and verified domains attached to the Vercel
  project. An account that's "deleted" while its OAuth tokens, videos and domains survive isn't
  deleted in any sense a user would recognise. Each cleanup is best-effort and never blocks the
  deletion — being unable to delete your account because a third-party API is down is the worse
  failure — and whatever failed comes back in `cleanupFailures` to chase by hand. Verified: the
  three rejection paths (no password, wrong email, wrong password) and, with a throwaway auth user,
  that the cascade really does take products/contacts/ledger/profile with it. **Re-auth runs on a throwaway
  Supabase client, never the request-scoped one** — `signInWithPassword` rewrites session cookies,
  so checking a password on the cookie-bound client logs the real user out when the password is
  wrong. Found the hard way: a rejected delete attempt during testing silently signed the browser
  out, after which every authenticated API call returned the login page's HTML with a 200. A successful deletion
  through the UI has NOT been run end to end — there's only one real account here to try it on.

Teams/orgs are out of scope by decision, so RLS stays `user_id = auth.uid()` throughout.

## Superadmin (/admin)

Cross-tenant observability plus a handful of audited account actions, at `/admin`. Schema in
`supabase/migrations/0055_superadmin.sql` (flag, audit table, action RPCs) and
`0056_admin_reads.sql` (read RPCs). Gate in `lib/admin.ts`; UI in `app/admin/*` +
`components/AdminAccountsTable.tsx` / `AdminProblemJobs.tsx`.

- **Authorization lives in the DATABASE, not the route.** Every `admin_*` function is
  `SECURITY DEFINER`, granted to `authenticated`, and calls `assert_superadmin()` as its first
  statement. So the pages use the ordinary RLS-scoped client and **no service-role key is involved
  in this feature at all** — a future admin route that forgets `requireSuperadminOr404()` still
  gets nothing back. That's the opposite of how the rest of this app does cross-tenant reads
  (admin client + a gate in the route) and it is the safer shape; prefer it for anything new here.
- **The flag is `profiles.is_superadmin`.** That table has exactly one policy — SELECT on
  `auth.uid() = id`, no client write path of any kind, because the general update policy was
  dropped in `0002_trial.sql` to stop self-granted `access_granted`. That makes it the safest
  table in the schema to hold a privilege bit, and it is now a **third** independent reason never
  to re-add a broad profiles update policy: doing so would turn this into privilege escalation.
- **`is_superadmin()` takes no argument** — it answers only about the caller, so it can't be used
  to enumerate who the admins are. Non-superadmins get a **404** from `/admin`, not a 403; the
  surface doesn't confirm its own existence.
- **`/admin` sits outside the `(app)` route group on purpose.** That group's layout is the
  paywall — it redirects to `/settings/billing` when `hasAppAccess()` is false — and an operator
  whose own trial lapsed must not lose the ability to see why the platform is on fire.
- **Every action writes its audit row in the same transaction as its effect** (`admin_actions`,
  default-deny RLS, service_role only). There is no code path that changes access, credits or a
  trial without a record of who did it. Verified live: a credit adjustment produced the ledger row
  and the audit row with byte-identical timestamps.
- **`admin_adjust_credits` is a deliberate, documented exception to "only the Stripe webhook
  writes `credits_ledger`."** That rule exists to stop ordinary app code minting credits by
  accident. A superadmin comping or clawing back credits is a real support action, and the
  alternative — doing it by hand in SQL — is strictly less safe: this path is authenticated,
  authorized, reasoned and audited. The ledger stays append-only; a claw-back is a negative delta.
- **`admin_requeue_job` does not reset `stage`** — a multi-stage job resumes where it died, which
  is the entire point of the `stage`/`stage_data` design. It resets `attempts` (so `MAX_ATTEMPTS`
  doesn't instantly re-fail it) and clears `locked_at`. It writes the failure message to
  `jobs.result`, NOT an `error` column — that column doesn't exist; `worker.ts`'s `failJob` uses
  `result` and the admin path has to match or the UI shows a blank reason.
- The sidebar entry is appended only for superadmins, so an ordinary tenant's rendered HTML never
  mentions `/admin` — the route 404s for them regardless, but there's no reason to advertise it.
- **Deliberately NOT included: impersonation / "view as tenant."** It was offered and not chosen;
  it's the most sensitive thing this app could grow and would need its own audit trail and a much
  harder gate than a boolean column.

## TikTok Ads (Marketing API) — connect shipped, launching NOT yet

Ads Manager is now a submenu: **Meta** (`/ads`, unchanged) and **TikTok** (`/ads/tiktok`).

**The API contract here was PROBED, not remembered** — the same rule that governed ClickBank's
GraphQL, kie.ai, Gemini and Meta's video-ad endpoints, and that caused Digistore24 discovery to be
parked rather than guessed. Verified live 2026-08-06 against `business-api.tiktok.com`:

- Base `open_api/v1.3`. Auth is an **`Access-Token` header**, not `Authorization: Bearer` — Bearer
  yields `40104 "you should set it in http header with key Access-Token"`.
- Every response is `{code, message, request_id, data}` and **HTTP status is 200 even on failure**,
  so `res.ok` means nothing; `code` is the only signal. Codes seen: 40002 bad params, 40104 no
  token, 40105 bad/revoked token.
- `oauth2/access_token/` POST needs `app_id` (an int64 — a non-numeric value comes back as a Go
  `strconv.ParseInt` error), `secret`, `auth_code`, `grant_type`.
- `oauth2/advertiser/get/` is GET. `campaign/create/`, `adgroup/create/`, `ad/create/` and
  `file/video/ad/upload/` are **POST-only** (GET returns a bare 405 HTML page, not the envelope).
- Bursting the probes gets you empty responses — same rate-limiting shape ClickBank's WAF showed.

**This is a SECOND TikTok app, not the existing connection.** `tiktok_connections` (0010) is Login
Kit: `user.info.basic` + `video.publish`, for organic posting. The Marketing API has its own
numeric `app_id`/secret, its own OAuth endpoint, and an advertiser-scoped token. Reusing either
credential would produce a token that works on one surface and 40105s on the other. Hence
`TIKTOK_ADS_APP_ID`/`TIKTOK_ADS_SECRET`, `lib/tiktok/adsConfig.ts`, and its own state cookie
(`tiktok_ads_oauth_state`) so two connect flows in two tabs can't clobber each other's CSRF check.

`0077` adds `tiktok_ad_accounts` (default-deny + `revoke all`, token in Vault — verified to have
ZERO client grants, matching `meta_connections`) and `tiktok_ad_launches` (owner-select, writes
service_role only — grants verified byte-identical to `ad_launches`).

**A build-only failure worth knowing**: `TIKTOK_ADS_STATE_COOKIE` originally lived in the connect
route. A Next.js route module may only export its handlers and a fixed set of config keys, so
exporting a constant from one fails `next build` — and **`tsc --noEmit` passes clean**. It lives in
`adsConfig.ts` now. Any shared constant between two routes belongs in lib, not in a route.

**NOT BUILT: actual ad launching.** `campaign/create/` and friends reject every unauthenticated
probe with 40105, so their required fields and enum values (`objective_type`, `budget_mode`,
`optimization_goal`, placements, targeting) could not be confirmed. Writing them from memory is
exactly what this project's verification rule exists to prevent, and the failure mode is a call
that looks right and spends money wrongly. `/ads/tiktok` therefore lists connections and launches
and says plainly when the app isn't configured. Finishing it needs a real TikTok for Business
advertiser account to probe against — then `lib/engine/tiktokadlaunch.ts` mirrors `adlaunch.ts`,
including a stage-0 verify that re-checks ownership before any spend.

## Socials

`/socials` — every organic post across Facebook, Instagram, TikTok and YouTube, with a platform
filter. Reads the **existing `audit_events` view** (0049) filtered to those four platforms rather
than querying `meta_posts`/`instagram_posts`/`tiktok_posts` separately: the view is
`security_invoker` so each table's own RLS still applies, and it already solves the ordering
problem a hand-rolled union reintroduces — `created_at` alone isn't unique across six tables, and a
non-deterministic sort makes rows appear twice or not at all while paging.

Read-only, the same relationship `/ads` has to launching: posting runs from a campaign's Social
tab, where the caption and its creative are in front of you. Until now this data existed but had
nowhere to be seen except the Audit trail, mixed in with email and generation events.

## Ads Manager, Analytics, and the Contacts submenu

Three read surfaces over data other code already writes — no new tables for the first two.

- **`/ads` (Ads Manager)** lists every `ad_launches` row with its campaign, angle, creative kind,
  status and daily budget, plus three summary tiles (active ads, daily credits authorized,
  drafts awaiting review). **Read-only on purpose**: creating, activating and pausing a launch
  stay on the angle's own `LaunchAd` card inside `AdAnglesPanel` on the campaign page, where the
  angle's copy and its generated creative are actually in front of you. A second place that
  spends credits is exactly what the paused-until-confirmed design exists to avoid. Meta's own
  Ads Manager stays the source of truth for delivery/spend/results; this page answers "what have
  I launched, from which angle, in what state," which Meta can't — it has no idea what a campaign
  or an angle is here. It gates its own banner on `ads_management_granted`, same signal
  `LaunchAd` uses.
- **`/analytics`** is five `head:true` count cards (leads, funnels live, split-test views, emails
  sent, posts published). Counts only, deliberately: rates and time series need per-day rollups
  the schema doesn't keep (views live as a running total on `bridge_variants`, not dated rows).
  Four honest numbers beat a chart built from a shape the data can't support.
- **Contacts submenu** — Leads / Tags / Import / Export. `contact_tags` + `contact_tag_links`
  (0047) follow the owner-select / no-client-write shape of every domain table since 0009; tag
  names are unique per tenant case-insensitively (`lower(trim(name))`), because "VIP" and "vip"
  are one tag to a person. `app/api/contacts/import/route.ts` is a hand-rolled RFC4180-ish CSV
  parser (quoted fields with commas/quotes/newlines) — deliberately NOT reusing
  `/api/public/leads`, whose whole shape is built around an untrusted anonymous caller; adding an
  authenticated bulk path there would widen the one endpoint strangers can reach. It dedupes
  within the file and against existing emails, and tags duplicates too (re-importing a list to
  tag an existing segment is a normal thing to want). **Export is a server route
  (`/api/contacts/export`), not the client-side CSV builder** — `ContactsTable` only holds the
  current page since pagination landed, so a client-built file would silently export 50 rows.

### Editing, tagging and bulk actions on leads

Tags existed since 0047 but could only ever be ATTACHED at import time — there was no way to tag
an existing lead, no way to edit one, and no bulk anything. All three now exist, and none of it
needed a new table: `contacts`, `contact_tags` and `contact_tag_links` already had the right shape.

- **`contact_tags` gained `color` and `description` (0062).** The colour is CHECK-constrained to a
  fully-anchored `^#[0-9a-fA-F]{6}$`, and `lib/contactTags.ts` re-states the identical pattern for
  the API routes. Both layers are deliberate: the value ends up as a CSS colour on a rendered chip,
  and PostgREST is directly reachable, so the constraint — not the route — is the boundary. Verified
  live that `red; background: url(...)`, `javascript:alert(1)`, `#12345`, `#1234567` and `#ggg000`
  are all rejected by the database while `#10B981` round-trips. Never loosen either to a
  `startsWith`/`includes` check; that is exactly the gap that turns a colour field into CSS
  injection, the same bug class `styleToInlineCss()` and `isValidImageDataUrl()` already close.
  `NULL` means "no colour" and renders as the neutral chip, so every pre-existing tag kept working
  with no backfill.
- **`/api/contacts/bulk` re-resolves every caller-supplied id against the caller's workspace before
  acting, and operates only on that resolved set.** This is the whole security story of the
  endpoint: it writes on the admin client, which bypasses RLS, so `.eq("workspace_id", ws)` is
  authorization, not a filter. Ids from another workspace are silently dropped rather than acted on.
  `tag_id` gets the same treatment — it is a second caller-supplied reference, and without its own
  check a caller could staple another workspace's tag onto their own leads. Same discipline as
  `set_broadcast_sequence_contacts` validating every element of its array: a determined caller talks
  to the endpoint, not the UI, and "the UI only sends ids it rendered" is not an authorization
  argument. Verified live against the real database: of 3 supplied ids (1 real, 2 foreign) exactly 1
  passed the filter.
- **`/api/contacts/[id]` lowercases an edited email**, because the de-dupe index is a plain
  `(campaign_id, email)` index and case is only collapsed in application code (see the de-dupe note
  above) — an edit that skipped this would create a second row differing solely in case. A collision
  with an existing lead on the same campaign returns a named 409 rather than a raw constraint string.
- **The tag filter is an inner join, not an id list.** `?tag=` uses
  `contact_tag_links!inner(tag_id)` so `count` and `.range()` stay correct at any size; fetching ids
  and passing them to `.in()` would have silently capped the filter at whatever that first query
  returned. The per-row tag chips are fetched separately for the current page precisely because the
  filtering join returns only the MATCHING link — reusing it for display would show a lead with
  three tags carrying one.
- **PATCH on a tag always writes all three fields.** A partial-patch shape would leave no way to
  clear a description or drop a colour back to neutral.
- **Not verified in a browser**: this session has no signed-in app session, so the new table,
  bulk bar, filter chips and edit dialog were verified by typecheck, a clean production build, and
  direct database-level tests of the authorization filter and the colour constraint — not by
  clicking through the UI. Worth a manual pass.

## Form fields in the page editor

The lead-capture form's tenant-added fields were text/email/tel only. They now cover
`FORM_FIELD_TYPES` in `lib/engine/blockTree.ts` — text, email, tel, number, url, textarea,
checkbox, radio, select — declared in ONE exported list so the schema, validator, renderer and the
editor's dropdown can't drift. `FIELD_PRESETS` in `WysiwygCanvas.tsx` adds one-click Last name /
Full name / Phone / Second email / Message / Checkbox / Choose one / Dropdown, each with a readable
`fieldKey` (it becomes the CSV column header and the JSON key in `contacts.extra_fields`, so
`last_name` beats a uuid) de-duplicated against the fields already on that form.

- **First name and email are deliberately NOT presets** — the form renders those itself and they
  can't be edited or removed, so offering them would create a duplicate that silently overwrites
  the real one.
- **The submit collector had to change, and this is the subtle part**: it read `.value` off every
  `[name]` element, which is right for inputs and wrong for the new controls — an unticked checkbox
  would have submitted "yes" anyway, and a radio group would have submitted whichever member came
  last in the DOM rather than the chosen one. Both now require `.checked`.
- Radio/select carry `options`; the validator caps them (`MAX_FIELD_OPTIONS`) and drops them for
  types that can't use them, and the renderer emits nothing for an option-less radio/select rather
  than a broken control. An unknown `fieldType` falls back to text instead of failing the save — a
  page that renders one field as text beats a page that won't save.
- Verified live end to end: every type rendered with the right markup, a submission stored
  last_name/phone/message/budget plus the SELECTED radio option, an unticked checkbox stored
  nothing and a ticked one stored "yes".

## The palette offers Input, not Form; a button's action lives in its settings

Two changes to the same idea — the canvas shows the PAGE, and what a block *does* belongs behind
its ⚙ rather than printed underneath it.

**"Input" replaced "Form" in the element palette.** Something still has to POST, but which
container that is isn't a decision worth making every time you want to collect a phone number.
`insertFormInput` (`lib/engine/blockTree.ts`) walks the tree for the LAST `form` or
`lead_capture_form` and appends there — so on a funnel opt-in page an input lands where the leads
already go — and only wraps a new form around the field when the page has none. `fieldKey` is
de-duplicated against the fields already on that form, because it is the CSV column header and the
key in `contacts.extra_fields`; two fields sharing one would silently overwrite.

`FORM_FIELD_PRESETS` is the "what does this collect" dropdown (last name, full name, phone, second
email, company, website, budget, message, consent, choice, dropdown, custom). Picking one sets
`fieldKey`, `fieldType`, label and placeholder **together** — they are one decision, and letting
them drift is how a field ends up labelled Phone and stored under `budget`. **first_name and email
are deliberately absent**: the form renders those itself and they can't be removed, so a preset for
either would create a duplicate that silently overwrites the real one.

**`form_input` needed its own selection lookup.** `findBlockLocation` deliberately doesn't walk a
form's children — a field is never a drop target and has no style keys — so `findFormInputBlock`
(`WysiwygCanvas.tsx`) is a second, narrower resolver rather than widening the shared locator and
changing what every drag/move call site sees. `STYLE_KEYS_BY_TYPE` still has no `form_input` entry,
so a field's panel is content settings only.

**The button's action moved into `components/BlockSettingsPanel.tsx`.** It was a row of selects on
the canvas under every button — chrome the published page doesn't have, making a button look twice
its real height. The canvas now edits only the label and shows the destination as a hover line.
`BlockSettingsPanel` renders content settings and `BlockStylePanel` renders look-and-feel; keeping
them separate is deliberate — style keys are a uniform table driving generic controls, content
settings are a per-type union editor.

A kind with nothing to point at is never offered (scroll needs another block, popup needs a form),
because an unresolvable target is a **hard reject in the validator — it fails the whole page save,
not just that block**. Verified directly: a valid scroll target round-trips, a `javascript:` href
and a quote-injecting scroll target are both refused at save, and a pre-actions bare `href` still
works through the same promote-to-`{kind:"link"}` adapter.

## A failed poll must not be stored where an array belongs

`/api/products` and `/api/jobs` answer `{error}` on 401/500, and `ProductsPanel` polls both every
5s for as long as the tab is open — so a session expiring mid-session WILL hit it. Storing that
object in `useState<Job[]>` crashed the next render with `A.filter is not a function`, which
presents as "products never load" rather than "you were signed out". The panel now checks
`res.ok`/`Array.isArray`, keeps the last good data on screen, and shows a reload banner.

The server half is worth knowing because it affects ~40 other routes:
**`currentWorkspaceId()` returning `null` is not a filter value.** Both backing RPCs key off
`auth.uid()` and answer NULL rather than erroring when it's missing, so a null flows into
`.eq("workspace_id", null)` → PostgREST `eq.null` → Postgres refuses to cast `"null"` to uuid →
the route answers a **500** where a 401 was meant. Confirmed against the live database. The two
polled routes now guard with `workspaceRequiredResponse()`; every other route that builds a query
around `ws` has the same latent 500.

## Email: transport vs identity

Two different things in two different places, deliberately.

**Transport** — the provider API key, SMTP host, and verified from-address (`mail_provider_connections`)
— stays on **Settings → Integrations** with the other connections. An API key is the same kind of
thing as a Facebook token.

**Identity** — reply-to, business name, postal address, footer note (`email_settings`, 0067) — is on
**Emails → Settings** (`/emails/settings`). It's a marketing decision, it changes independently of
the provider, and it survives switching from SendGrid to Mailgun. Each page points at the other.

`email_settings` is workspace-keyed (matching `mail_provider_connections`, not `blog_settings`'s
legacy user key), owner-select with admin-client writes. Every field is nullable and everything
degrades to "" — an account that fills nothing in sends exactly what it sent before, so this could
not retroactively change existing accounts' mail.

The postal address is why this page is more than a preferences bag: CAN-SPAM (US) and CASL (CA)
both require a physical mailing address in commercial email, and the unsubscribe link this codebase
already treats as non-negotiable is only half of that obligation. `renderSenderIdentityHtml`
(`lib/emailSettings.ts`, isomorphic) renders the block, `renderUnsubscribeFooterHtml` splices it in
above the unsubscribe line, and the settings page previews it by calling **the same function** — so
the preview is the real footer, not a mock-up of it.

Reply-to is resolved inside `sendViaActiveSender` rather than passed by callers, for the same
reason the active provider is: one place decides, and every send path gets it without remembering.
It reaches each provider differently — Resend `reply_to`, SendGrid `reply_to.email`, Mailgun as the
`h:Reply-To` pass-through header, SMTP `replyTo`. The Broadcast worker reads identity per send, not
at enrollment, so an address correction applies to mail going out now rather than only to sequences
enrolled after the edit.

## My Products vs Marketplace

`/marketplace` is discovery; `/products` ("My Products" in the sidebar) is the offers you already
track. Both render the same `components/ProductsPanel.tsx` — the table, its status filter, bulk
bar, manual-add row and the Promote flow. It is shared rather than copied because it owns the
Promote path, which charges credits; a second copy would be a second billing path to keep in step,
the same reason bulk promote calls `/api/promote` once per product instead of growing its own
endpoint. The panel owns its 5s poll and URL-driven pager; the host page passes `basePath` (where
the pager and filter-reset navigate) and can read the stats the panel already fetched via
`onData`. Marketplace nudges it with `refreshKey` after queueing a discovery run. Product detail
pages highlight My Products in the nav.

## Marketplace: Top products and Trending

Two tabs above the products table (`components/MarketplaceHighlights.tsx`,
`app/api/marketplace/highlights/route.ts`), both served from the daily `marketplace_products`
cache — no live ClickBank call, so the panel paints instantly and the WAF sees no extra traffic.
Each row's **Add** posts to the existing `/api/products/manual-add`, so entitlement and validation
are unchanged.

- **Top** is highest gravity right now. Real from day one.
- **Trending and New are real measurements, not re-rankings.** The cache holds one row per
  product and the sweep overwrites it, so nothing recorded change over time — tabs built on that
  snapshot could only be Top wearing a different label. **`marketplace_product_history`
  (0052/0053) stores a full product row per day**, appended by `refreshMarketplaceCache`
  (best-effort — a history write must never fail the refresh) and written BEFORE the prune, so a
  product's final day is recorded rather than lost.
  - Storing the whole row, not just gravity, is what makes `marketplace_trending` self-sufficient:
    it used to INNER JOIN `marketplace_products` for the title/urls, but the sweep prunes that
    table, so a product dropping out of the top-N took its own history with it — precisely the
    product whose fall you'd want to see. The view now reads history alone and reports `in_cache`
    so "climbing" is distinguishable from "was climbing, then vanished". Payout movement
    (`avg_sale_change`) came along for free.
  - **`marketplace_new_products` (0054)** answers "what appeared today": a product whose earliest
    snapshot is recent. The trap it guards: on the first day of history EVERY product's first
    sighting is that day, so a naive query announces hundreds of "new" products — the first day is
    excluded outright, because it's the day we started looking, not the day they launched.
  - **Consequence, surfaced in the UI rather than hidden: Trending and New are both empty until
    two daily sweeps have run.**
- **The database is always the first source, and also the safety net.** `runDiscoverProducts` goes
  fresh cache → live fetch → `getStoredMarketplaceHits` (newest stored snapshot per product,
  any age) *only if the live fetch throws*. ClickBank's WAF has been seen blocking bursts; before
  this, that failure took the whole discovery job down while the database held a perfectly usable
  picture from yesterday. Stale-but-real beats empty. It is deliberately NOT used ahead of the
  live fetch — `getCachedMarketplaceHits`' 30-hour freshness rule stands, because gravity drives
  scoring and serving week-old numbers as current is the failure the cache exists to prevent.
- Two guards worth keeping: percent change is `null` below 1.0 starting gravity (a 0.1 → 1.0 move
  is "+900%" and means nothing, so those rank by absolute change), and the API filters to risers
  (`gravity_change > 0`) — a faller is real data but it isn't trending.
- **Could not check whether ClickBank's GraphQL exposes a trend-style `sortField`** — this sandbox
  has no outbound DNS, and the standing rule is not to write code against an unverified API shape.
  If it turns out to have one, it would be a simpler source than the history table; worth a probe
  from a machine with network access.
- `/api/products/manual-add` now forwards `gravity`/`avg_sale`/`recurring` when given them
  (validated finite, non-negative, capped). `upsert_product` always accepted these; only the route
  dropped them, so a product added from this panel used to land with no stats beside products that
  had them.

## Cross-table paging, and erasing a lead

- **`audit_events`** (0049) UNIONs the six posting/sending tables into one row shape so `/audit` can
  run a single counted, ordered, ranged query. It used to pull 200 rows from each of six tables on
  every load, merge in JS and throw most away — and could only ever show the newest 200, so older
  activity was permanently unreachable. **`security_invoker = true` is the load-bearing detail**:
  each underlying table's owner-select RLS still applies, so a tenant sees only their own rows, and
  it keeps `security definer view` off the advisors report. Ordering is `created_at desc, id desc` —
  `created_at` alone isn't unique across six tables, and a non-deterministic sort makes rows appear
  twice or not at all while paging.
- **`product_stats`** (0050, same invoker pattern) aggregates the Marketplace tiles in Postgres.
  That's what let `/api/products` become paged: the tiles still describe every product while the
  list returns one page. Status filtering moved server-side with it — filtering one page
  client-side would silently hide matches on other pages.
- **PostgREST answers an out-of-range `.range()` with a 416, not an empty list.** Reachable in
  normal use: sit on page 2, delete rows until fewer than one page remains, and the 5s poll starts
  erroring. `/api/products` counts first and clamps the page; the server-rendered pages clamp via
  `pageFromParam(raw, totalPages)`.
- **`Pager` takes `paramName`/`preserve`** so two lists can page independently on one page —
  `/audit` runs `?page=` for events and `?usage=` for the generation ledger.
- **Erasure (0051)** — `contacts` is the first table here holding a third party's PII, and there
  was no way to remove one. `delete_contact(id)` is the everyday row delete; `erase_contact_email
  (email)` is the GDPR/CCPA answer: it's keyed by **address, not row**, because the person asking
  doesn't know which campaigns captured them and may be in several. It also **redacts their address
  in `mail_sends`/`broadcast_sends`** — deleting the contact row alone leaves their email sitting in
  the send logs, which would make the erasure claim untrue. The send rows themselves survive (that
  a send happened is a real audit record, and the pooled daily cap counts it); the address becomes
  `erased@redacted.invalid`, using RFC 2606's reserved TLD so it can never collide with a real one.
  Both are `SECURITY DEFINER` + `auth.uid()`-scoped, granted to `authenticated` — the narrow hole in
  a table with no client write policy, same shape as `start_trial()`/`update_profile()`.

## The product page was re-fetching a page-sized payload on a timer

`campaigns` rows average **166 kB and reach 766 kB** — `page_copy` (~47 kB), `bridge_html`
(~55 kB), the base64 `embedded_image_data_url` (~47 kB), plus the legacy `presell_html`/
`landing_md`. `app/api/products/[id]/route.ts` selected `*`, and the product page polled it every
8 seconds unconditionally. So a fully-rendered page kept pulling ~166 kB forever.

Two fixes, both measured rather than assumed:

- **Explicit column list instead of `select("*")`.** Dropping `page_copy`, `presell_html`,
  `landing_md` and `tracking` takes the average from **166 kB → 108 kB (−35%)** and the worst case
  from 766 kB → 515 kB. `page_copy` is the big pointless one here: the funnel editor lives on
  `/funnels/[campaignId]` and reads it there, while this page only ever renders `bridge_html`.
  **Anything a child component needs must be in that list** — dropping a column is invisible to
  `tsc` and surfaces as an empty tab, so add to the list when you add a consumer.
- **Stop polling once `status === 'ready'`.** A finished campaign never changes again. Build
  progress already has its own cheaper poll (`BuildProgressDialog` against `/api/jobs`), so
  nothing is lost — the interval now only runs while there is genuinely something to wait for.

**Marketplace was the same complaint with a different cause, and measuring said so.** Its payload
is fine — `products` rows average **811 bytes** and `product_stats` plans in **0.7 ms** — so
trimming columns there would have achieved nothing. The cost is round trips: each 5s tick fires
TWO requests (`/api/products` and `/api/jobs`), and each pays `getUser()` plus
`currentWorkspaceId()` — both network calls to Supabase — before running a query. Roughly eight
round trips every five seconds, almost always to learn that nothing changed.

`ProductsPanel` now polls at **5s only while a discovery or build job is open**, and **30s
otherwise** — a sixth of the traffic when idle, which is most of the time. Deliberately not
stopped the way the product page's is: this list has other people writing to it.

**Funnels was a third cause again — counting in the wrong place.** `/funnels` fetched every
`contacts` row (capped at 1000), every `bridge_variants` row and every `funnel_steps` row for the
workspace, then grouped them into Maps in JS to render three numbers per funnel. `funnel_stats`
(0079, `security_invoker` like `audit_events`/`product_stats`) does it as one aggregate instead —
1.06 ms, and verified to return counts identical to the old grouping across all 14 campaigns.

**The `.limit(1000)` was the worse half of that bug**: past a thousand leads the numbers were
silently WRONG, not merely slow, with nothing on screen saying so. An aggregate has no ceiling.
CLAUDE.md already warned about exactly this for the Contacts page — leads accumulate from real paid
traffic, unlike rows throttled by human cadence — and the warning applied here too.

`/funnels` also had **no workspace filter on any of its five queries**, so a member of two
workspaces saw both workspaces' funnels merged; `/funnels/[campaignId]` pulled the full 166 kB
campaign row when the editor needs only `page_copy`, `bridge_html` and `tracking`, and its
cross-sell dropdown queried `products` unfiltered and unbounded. All three fixed.

The general lesson from these three: `select("*")` on a hot path is worth checking, but check
WHICH cost is actually biting first. Product page was payload, Marketplace was frequency, Funnels
was aggregation — and from the outside all three are "the page is slow".

## Product status, and where the jobs queue lives

- **`products.status` is now settable by hand** (`components/ProductStatusSelect.tsx` — the status
  chip itself is the dropdown, on both the Marketplace row and the product page). Before this,
  Selected/Paused/Dead appeared in the Marketplace filter but nothing could ever set them: the
  engine only writes `New` on discovery and `Promoting` when a kit finishes, so three of the five
  statuses were unreachable. `app/api/products/[id]/status/route.ts` uses the **RLS-scoped**
  client, not the admin client — `products`' own policy (`for all using (auth.uid() = user_id)`)
  already scopes the write, and an admin client would only widen what a bug could reach. That's
  the opposite call from `campaigns`, whose policy is select-only precisely because its HTML is
  served to real ad traffic.
- **The route's enum check is a UX nicety; migration 0048's `products_status_check` is the
  boundary** — this table is directly PATCH-able through PostgREST, so a constraint is the only
  thing that actually stops a garbage status being stored. Verified before applying that only
  `New` and `Promoting` existed.
- **The jobs queue moved off Marketplace to `/settings/jobs`** (`components/JobsQueue.tsx`, now
  self-contained with its own fetch+poll). Jobs process automatically within seconds and retry
  themselves — the list is something you consult when something looks stuck, not part of the
  discovery loop. Marketplace keeps its own `/api/jobs` call for the per-row "Queued" indicator
  and the "Open jobs" stat tile, which now links to the new page.

## Top bar: credits and trial countdown

`CreditsChip` and `TrialChip` both live in the desktop top bar rather than the sidebar — account
status, not navigation, the same reason the bell and account menu are there. The trial chip is
**absolutely positioned across the bar** so it centres on the page regardless of how wide the
right-hand cluster grows; `pointer-events-none` on that overlay with `pointer-events-auto` on the
chip keeps the transparent strip from eating clicks.

**The centred chip only renders from `lg`, and the strip underneath covers everything below it.**
Being absolutely positioned means it can't push the right-hand cluster aside — so on a
narrow-but-not-mobile window (~640-900px) it printed straight through the credits chip. The
breakpoint on both halves was `sm` when this shipped and had exactly that overlap; it's `lg` now.
Any future absolutely-centred top-bar element inherits the same constraint.

## Notifications

Bell in the sidebar header (and the mobile top bar), `components/NotificationsBell.tsx`, backed by
`notifications` (0038). Polled every 60s — the events come from background jobs that take tens of
seconds to minutes, so realtime buys nothing and there is no other websocket usage to amortize.

**Deliberately not an activity feed.** Only events a tenant must *act* on get a row:
terminally-failed jobs, finished campaign kits, referral payouts, domain/mail-sender errors.
Per-post and per-lead events are excluded — Audit trail and Contacts already list those, and
adding them would bury the actionable ones. Don't add a high-volume kind without a digest design.

- Writers are server-side only (`notify()` in `lib/notifications.ts`, or in-database inside
  `reward_referral`). `notifications` has no client insert policy.
- `notify()` **never throws** — a notification is layered on top of something more important
  (finishing/failing a job), and letting an insert error propagate could turn "built fine but we
  couldn't tell you" into "the job failed".
- Only TERMINAL job failures notify (attempts exhausted); a job that will still retry isn't
  actionable yet.
- `href` is CHECK-constrained to an in-app path (`^/...`). These render as real links, so allowing
  arbitrary URLs would make any future writer an open-redirect vector.
- Marking read goes through `mark_notifications_read(p_ids)` (NULL = all), not a general UPDATE
  policy — which would also let a client rewrite title/href/kind.

## App icon

`app/icon.svg` (favicon) + `app/apple-icon.png` (180px, Safari home screen) — an emerald "A",
replacing the old "C" (ClickBank) mark. The PNG is generated, not hand-drawn: no SVG rasterizer is
installed on this machine, so it was rendered by a small distance-field script. Regenerate it if
the SVG changes; they are not linked automatically.

**`ICON_PATHS` in `middleware.ts` must include every icon route.** App Router serves these as real
top-level routes, not from `/_next`, so without the exemption the auth gate 307s them to `/login`
and every logged-out visitor — the whole marketing site, every public funnel and blog page — gets
a broken favicon. That was live until it was caught here.

**`PUBLIC_API_PREFIXES` is the third instance, and the most expensive.** The host-mismatch rewrite
(not the auth gate this time) sent every public API route on a non-canonical Host to
`/d/api/...`, where the GET-only catch-all answered **405**. The Stripe webhook was still
registered against the project's old `*.vercel.app` hostname — which is still attached to the
project — so **every `checkout.session.completed` was being rejected before reaching the billing
route: no access granted, no credits added, no error anywhere the operator would see.** Confirmed
live before fixing (405 on the old host, 400 "missing signature" on the canonical one). Public API
routes authorize themselves with an HMAC signature or `x-engine-secret`, never by hostname, so
they are now exempt from the rewrite — derived by filtering `PUBLIC_PREFIX_PATHS` for `/api/` so
the two lists can't drift. `/p/`, `/b/` and `/r/` are deliberately NOT exempt: those are content
routes whose host-scoping is the whole point (custom domains, and per-workspace subdomains).
**A webhook registered anywhere other than the canonical host is now served rather than silently
dropped** — but registrations should still name `www.affiliateoffersecrets.com`.

**`CRAWLER_PATHS` (`/robots.txt`, `/sitemap.xml`) is the same bug, found the same way.**
`app/robots.ts` and `app/sitemap.ts` are also real top-level App Router routes, and both were
307'ing to `/login` — so every crawler that asked this app for the two files whose entire purpose
is to be fetched without a session got a redirect to a login page. Harmless while the app lived on
a `.vercel.app` host nobody was indexing; a real problem the hour a real domain went live, which is
when it was caught (`curl` of `/robots.txt` during the post-rename check). Any future
convention-generated top-level route (`opengraph-image`, `manifest.webmanifest`, …) needs the same
exemption — the rule is "if App Router generates it as a route and an anonymous client fetches it,
the auth gate must skip it."

## Email sending (providers + manual)

**Gmail OAuth was removed in 0037_retire_gmail_sender.sql.** `gmail.send` is a Google RESTRICTED
scope — fine for one operator in Testing mode, but shipping it publicly needs a security
assessment that can require a third-party audit. That is the wrong dependency under a
multi-tenant product's email backbone. Do not re-add it without revisiting that.

Two ways to send, deliberately distinct:

1. **Automatic** — `profiles.active_mail_provider` names one of the `mail_provider_connections`
   rows (Resend / SendGrid / Mailgun / SMTP, per-tenant API key in Vault, 0026). Everything routes
   through `sendViaActiveSender()` in `lib/mail/send.ts` — one-off sends and Broadcast alike.
   Gets the unsubscribe footer, `broadcast_sends` audit rows, and the pooled daily cap.
2. **Manual** — `components/ManualSendPanel.tsx` on Emails → Broadcast, modelled on
   visibility-studio's `EmailQueue`: builds `mailto:` links and clipboard copies in the browser
   and the user's own mail client does the send. Zero setup, works with no provider connected.
   **No unsubscribe footer, no audit row, no delivery tracking** — which is exactly why it is a
   separate panel rather than a mode of "Send now". `{{first_name}}` is interpolated per contact
   (falling back to "there"), and drafts over ~1800 chars show "too long to open" instead of
   producing a silently truncated mailto (a real failure mode of naive mailto builders).

`active_mail_provider` is now NULLABLE, and NULL means "no sender configured" — the same
not-connected state a new account has. Anything that used to fall back to `'gmail'` must use NULL
instead; the CHECK constraint rejects `'gmail'` outright, so a stale fallback fails loudly rather
than silently mis-routing. `mail_connections` (the old Gmail token table) is intentionally left in
place, unread, same call as `profiles.nickname`.

## Referrals + Rewards

Sidebar entries **Referrals** (`/referrals`) and **Rewards** (`/rewards`), schema in
`supabase/migrations/0036_referrals_rewards.sql`.

Flow: `/r/{CODE}` (public, in `middleware.ts` PUBLIC_PREFIX_PATHS) drops a `ref_code` cookie and
redirects to signup → `components/ReferralClaimer.tsx`, mounted in the `(app)` layout, POSTs
`/api/referrals/claim` on first app load if that cookie exists → `claim_referral()` attributes the
account → when that account later pays the **access fee**, the Stripe webhook calls
`reward_referral()` and the referrer gets `REFERRAL_REWARD_POINTS` (25, in `lib/referrals.ts`) →
`redeem_rewards()` converts points 1:1 into `credits_ledger`.

Load-bearing details, none of them incidental:

- **`referrals.referred_user_id` is UNIQUE.** One referrer per account, forever — this is what
  makes re-attribution and double-rewarding structurally impossible, not just app-checked.
- **The access fee is the qualifying event**, not signup. A fake referral costs the referrer's
  friend real money, so the program can't be farmed with throwaway accounts.
- **`reward_referral` is service_role-only and idempotent** via its `status = 'pending'`
  predicate — a replayed Stripe webhook updates zero rows and writes no second ledger entry. It
  sits *after* the `payments` insert, whose unique constraint already short-circuits replays.
  It also never fails the webhook: access is granted first, and a non-2xx would make Stripe retry
  a fully-processed payment.
- **These are NOT Vault-pattern tables** (a referral code is public — it's in a shareable URL),
  but writes still go through RPCs rather than an owner-writable policy like
  `network_connections` has, because the anti-gaming invariants are only enforceable server-side.
- **`redeem_rewards` takes `pg_advisory_xact_lock('rewards:' || uid)`** — same reasoning as
  `reserve_ad_credits`: SELECT SUM → IF → INSERT is not safe under READ COMMITTED. Namespaced
  `rewards:` so it never contends with that function's `credits:` lock.
- **The claim route reads the code only from the cookie**, never the request body, and returns 200
  for every rejection (stale cookie, self-referral, already attributed) — all ordinary states for
  someone who just signed up.
- **`/referrals` shows signup date + status only** — never the referred account's name or email.
  Those are other people; the referrer doesn't need their PII.
- Claims expire 7 days after signup, so an established account can't retroactively attribute
  itself to a friend's code.

## Onboarding: empty states, setup checklist, tooltips, product tour

Four pieces that share one goal — never leave someone looking at a screen that states a fact and
stops. Each has a rule worth keeping.

**Empty states — `components/EmptyState.tsx`.** Funnels and Ads already did this well (icon, what's
missing, the next step as a real link); Contacts, Blog and Domains had drifted to a bare sentence.
The component is the good version lifted out. `children` is required and `action` is optional
because an empty screen is the one moment you know exactly what someone is trying to do and hasn't
managed yet — so it should always answer "what now", and the answer should be clickable rather than
merely named. The Contacts one names all three ways a lead can arrive (opt-in form, Add contact,
CSV import) because two of them aren't discoverable from that page; the tag-filtered variant is its
own state, since "no leads carry this tag" wants *clear the filter*, not *go make a funnel*.

**Setup checklist — `components/SetupChecklist.tsx`, `0073`.** Four steps: connect a network, find
products, build a kit, publish a funnel.

- **Every step is DERIVED from live counts at render time. Do not convert this to stored flags.**
  A flag would say "kit built" forever after the last campaign was deleted, and every write path
  would have to remember to set it. Derived, a step un-ticks itself and there is no sync to get
  wrong. Only the *dismissal* is stored (`workspaces.setup_dismissed_at`, written by
  `dismiss_workspace_setup()`).
- Dismissal is on `workspaces`, not `profiles` — connecting a network is something the org does
  once, so a teammate joining an established workspace shouldn't be handed a finished checklist.
- It renders nothing when every step is done. If you're testing and see nothing, that's probably
  correct — check the counts before assuming it's broken.

**Tooltips — `components/ui/tooltip.tsx` (`Hint`).** Native `title` is not simply the worse option:
no JS, no layout shift, predictable for screen readers. It's bad at anything you want someone to
*read*, because the ~1s delay and OS-styled box mean it goes unseen. So `Hint` is for controls whose
purpose isn't guessable and where the explanation earns its place; `title` stays where the tooltip
would just be the label spelled out. A tooltip describes — it doesn't name, so icon-only buttons
still need `aria-label`. **Wrap a disabled trigger in a span**: disabled buttons fire no pointer
events, and the disabled state is usually where the explanation matters most.

**Product tour — `components/ProductTour.tsx`, `0074`.** Spotlight overlay over real elements,
auto-starts once per person.

- **Per-USER (`profiles.tour_completed_at`), unlike the checklist.** "Has this workspace connected a
  network" is a fact about the org; "has this human been shown around" is a fact about the human.
- Targets are `data-tour` attributes, never selectors or nth-child paths — restyling or reordering
  the nav can't break a step, and the only thing that can (deleting the attribute) is greppable.
- **`findVisible()`, not `querySelector`.** This is the one that bit: `CreditsChip` renders twice
  (sidebar for mobile, top bar for desktop), so `querySelector` returned the hidden copy, whose
  rect is all zeros, and the popover pinned itself to the top-left corner spotlighting nothing.
  "In the DOM" and "on screen" are different questions. Responsive duplicates are normal here, so
  visible-first has to be the default lookup rather than a special case — **any new tour target
  must be checked for a hidden twin.**
- A step whose target isn't visible is skipped, not rendered pointing at the origin; if nothing
  resolves at all the tour closes itself. Positions are measured every frame because the sidebar
  animates its width.
- Replay lives in the account menu (`TopBarAccount`), deliberately not on the checklist — the
  checklist disappears once setup is complete, which is exactly when someone wants a refresher.

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
