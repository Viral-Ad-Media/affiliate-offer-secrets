# Affiliate Offer Secrets

Multi-tenant SaaS for affiliate marketers. It researches an affiliate marketplace, generates a
complete campaign kit for a chosen product, hosts the resulting pages on the operator's own domain,
and launches real ad campaigns against their own ad account.

The loop it automates:

**Discover** a product → **generate** a kit (funnel page, ad angles, TikTok scripts, blog article,
email swipes, SMS, social captions) → **edit** the pages on a drag-and-drop canvas → **publish** to
a custom domain → **launch** ads and **follow up** by email and SMS to the leads the funnel captures.

---

## Stack

| | |
|---|---|
| App | Next.js 14 (App Router), React 18, TypeScript, Tailwind, shadcn/ui |
| Database | Supabase (Postgres + Auth), Row Level Security on every tenant table |
| Generation | Anthropic API (copy), kie.ai (images), Google Veo (video) |
| Media | Cloudinary |
| Hosting | Netlify (`@netlify/plugin-nextjs`) |
| Billing | Stripe |

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # fill in at least the "required to boot" vars below
npm run dev                        # http://localhost:3400
```

The app will start without most integrations configured — each one degrades to a clear "not
connected" state rather than crashing. To do anything useful you need Supabase, and to generate
anything you need `ANTHROPIC_API_KEY`.

### Environment variables

Every variable is documented inline in [`.env.local.example`](.env.local.example). Summary:

**Required to boot**

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` — the app's own origin

> `NEXT_PUBLIC_APP_URL` is load-bearing beyond link generation. `middleware.ts` rewrites any request
> whose `Host` doesn't match it to the custom-domain handler, so pointing it at the wrong host
> doesn't degrade — it 404s every page. `lib/appUrl.ts` repairs a missing scheme so a malformed
> value can't take the build down, but the value should still be correct.

**Generation and media** — `ANTHROPIC_API_KEY`, `KIE_AI_API_KEY`, `GEMINI_API_KEY`,
`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` + `CLOUDINARY_API_KEY` + `CLOUDINARY_API_SECRET`

**Billing** — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

**Background work** — `ENGINE_WEBHOOK_SECRET` (shared secret for the engine/cron endpoints)

**Social and ads** — `FB_CLIENT_ID`/`FB_CLIENT_SECRET` (+ `FB_LOGIN_CONFIG_ID` for Login for
Business), `TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`, `TIKTOK_ADS_APP_ID`/`TIKTOK_ADS_SECRET`

**Custom domains** — `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`, `NEXT_PUBLIC_NETLIFY_SITE_HOSTNAME`

**Per-workspace subdomains** — `NEXT_PUBLIC_ROOT_DOMAIN`, `NEXT_PUBLIC_COOKIE_DOMAIN`

Anything `NEXT_PUBLIC_*` is inlined at **build** time — setting one and waiting for the next code
push is a good way to lose an hour. Per-tenant credentials (mail providers, Twilio for SMS,
affiliate network IDs) are **not** environment variables; tenants enter them in the app and they are
stored in Supabase Vault.

---

## How it fits together

```
app/(marketing)/   public marketing site — /, about, pricing, faq, contact, terms, privacy
app/(app)/         the authenticated dashboard — paywall + auth gate live in its layout
app/p/, app/b/     public funnel pages and public blog, served to real ad traffic
app/d/             custom-domain serving (a tenant's own domain maps to their pages)
app/api/           ~90 route handlers
lib/engine/        the generation worker — one module per job type
supabase/migrations/  ~100 ordered SQL migrations; the schema's history and its reasoning
```

**Tenancy.** A workspace owns the data; RLS on every tenant table is `is_workspace_member(...)`.
Queries also filter `workspace_id` explicitly — the policy decides whether a row is visible at all,
the filter decides which of *your* workspaces you're looking at.

**The engine is automatic.** Nothing is run by hand. Inserting a row into `jobs` fires a Postgres
trigger that calls `app/api/engine/run`; a `pg_cron` backstop drives multi-stage jobs forward and
reclaims anything that died mid-stage. Each job type is a list of stages that persist their output
as they go, so a retry never redoes finished work.

**Pages are rendered at write time.** A funnel's HTML is baked when it's saved, not templated on
request. Changing a renderer or stylesheet therefore needs a re-render (`npm run rerender-funnels`)
to reach pages that already exist.

---

## Scripts

```bash
npm run dev                       # dev server on :3400
npm run build                     # production build
npm run engine -- pending         # inspect/drive the job queue by hand (debug fallback)
npm run rerender-funnels          # re-bake funnel HTML after a renderer/stylesheet change
npm run migrate-images            # move legacy base64 images to Cloudinary (dry run by default)
npm run backfill-email-sequences  # create draft email sequences for pre-existing kits
npm run import-csv -- <file.csv> --user <uuid>
```

Locally the engine's Postgres trigger can't reach `localhost`, so drive it directly:

```bash
curl -X POST http://localhost:3400/api/engine/run -H "x-engine-secret: $ENGINE_WEBHOOK_SECRET"
```

---

## Deployment

Netlify builds from `main`. `netlify.toml` sets the build command, publish directory, and an
`ignore` rule that skips builds for pushes touching only docs, migrations or scripts.

Two things that must be done by hand outside the repo, because the app can't do them for itself:

1. **Register callbacks against the canonical host** — the Stripe webhook, Meta's OAuth/deauthorize/
   data-deletion URLs, TikTok's redirect URI, and Supabase Auth's Site URL. A webhook registered on
   a host that redirects is a *failed delivery*, not a followed redirect, and it fails silently.
2. **Point a tenant's SMS number's inbound webhook** at `/api/sms/inbound`, or STOP replies are
   never recorded.

---

## Conventions worth knowing before contributing

These aren't style preferences; each one exists because getting it wrong caused a real failure.

- **Verify an external API before writing code against it.** Probe the real endpoint, and validate
  the probe against a known-bad control — an error that looks specific but is returned for every
  input measures nothing.
- **Compliance strings are code-owned.** The affiliate disclosure, the email unsubscribe footer and
  the SMS `STOP` line are appended by code and are not editable or generatable. A string the model
  can paraphrase or an editor can delete is not a compliance control.
- **Never invent claims.** Generated copy must be traceable to the product's own sales page — no
  invented results, income figures, testimonials or marketplace stats.
- **An empty state is a claim about the data.** If a query failed, say so; rendering "nothing here
  yet" over a failed read is how a bug hides as normalcy.
- **The engine bypasses RLS**, so any job type whose payload references another row must re-check
  ownership itself in its own stage 0. The API route's check is a fast error, not the boundary.
- **`profiles` and `campaigns` are SELECT-only for clients.** New client writes go through narrow
  `SECURITY DEFINER` RPCs, never a broad update policy.

---

## Further reading

[`CLAUDE.md`](CLAUDE.md) is the long-form engineering document: the reasoning behind each subsystem,
the failures that shaped it, and the traps that are easy to walk back into. It is the place to look
before changing anything non-obvious.
