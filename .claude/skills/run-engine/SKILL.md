---
name: run-engine
description: Drain pending Affiliate Offer Secrets jobs across all tenants — discover marketplace products with live research or build complete campaign kits (ads, TikTok scripts, landing copy, presell HTML, lead-capture bridge HTML, blog, emails) for promoted products, writing everything back into Supabase so it appears in each client's dashboard.
---

# Run the Affiliate Offer Secrets engine

Drain the jobs queue — this is a background process running with the Supabase service-role key,
so `pending` (with no `--user` filter) returns open jobs from **every** client, not just one.
Prefer invoking `anthropic-skills:clickbank-affiliate-engine` for the full methodology; the
load-bearing rules are embedded here as a fallback. Also honor the project CLAUDE.md engine
contract and content rules.

## Loop

1. `npm run engine -- pending` — list open jobs across all tenants with context (includes
   `user_id`, `nickname`, and, for discovery, `known_vendor_ids` for dedupe awareness). Pass
   `--user <uuid>` to scope to one client (useful for testing).
2. For each job, `npm run engine -- claim <id>`, do the work (below), then
   `npm run engine -- complete <id> [--meta meta.json]` or
   `npm run engine -- fail <id> --message "why"`. Never leave a job `running`.
3. Meta always goes through JSON files in the scratchpad — never inline SQL, and never write
   `credits_ledger` or `profiles.access_granted` from here (that's the Stripe webhook's job only).

## Job: `discover_products`

Payload is one of two shapes, set by the dashboard's category-picker (`lib/categories.ts` holds
the authoritative ClickBank taxonomy — 21 categories with their subcategories, pulled live from
the marketplace on 2026-07-22):

- **Category mode** (default, preferred — exact and requires no guessing):
  `{mode: "category", category, subCategory?, niche, count}`. `niche` is just the display label
  (`"<category>"` or `"<category> > <subCategory>"`) — use `category`/`subCategory` for the
  actual query.
- **Keyword mode** (fallback for anything not covered by the taxonomy):
  `{mode: "keyword", keyword, niche, count}`.

1. Pull live data from the ClickBank marketplace. The public GraphQL endpoint works without
   login — POST to `https://accounts.clickbank.com/graphql` (from a browser tab on
   accounts.clickbank.com, e.g. via javascript_tool fetch) with:

   ```graphql
   query ($parameters: MarketplaceSearchParameters!) {
     marketplaceSearch(parameters: $parameters) {
       totalHits
       hits {
         site title description url
         marketplaceStats {
           category subCategory initialDollarsPerSale averageDollarsPerSale
           gravity totalRebill rebill upsell
         }
         affiliateToolsUrl
       }
     }
   }
   ```

   `parameters`: for category mode, `{category: payload.category, subCategory: payload.subCategory}`
   (omit `subCategory` if not set — pulls the whole category); for keyword mode,
   `{includeKeywords: payload.keyword}`. Either way add
   `{sortField: "gravity", sortDescending: true, resultsPerPage: payload.count, offset: 0}`.
   Category mode is exact and preferred; only use keyword mode when the niche truly isn't one of
   the 21 ClickBank categories. Fall back to browsing the marketplace UI if the endpoint changes.
   If `lib/categories.ts` looks stale (a category 404s or a subcategory no longer appears), refresh
   it by re-running the same facets-per-category query used to build it originally.
2. Visit each candidate's sales page briefly (angle, price point, audience, ad-review risk).
   If an origin is blocked, still save the product but note "page not verified" in
   `angle_notes` and set `page_verified: 0`.
3. Score 1–10 for promotability (gravity momentum, commission size, sales page quality,
   niche competition) and write one or two sentences of angle notes.
4. Build the hoplink `https://hop.clickbank.net/?affiliate=<nickname>&vendor=<vendor_id>`
   (nickname comes from the job context's `nickname` field, i.e. that client's `profiles.nickname`).
5. Save each product **as it finishes**, scoped to the job's own client (`job.user_id`, also
   surfaced as top-level `user_id` in the `pending`/`claim` output):
   `npm run engine -- add-product --user <job.user_id> --meta product.json` with fields:
   `{vendor_id, niche, product_title, description, gravity, initial_sale, avg_sale, recurring,
   commission_pct, sales_page_url, affiliate_page_url, hoplink, score, angle_notes,
   page_verified, status: "New"}`.
6. Mirror new rows into the Drive master CSV `clickbank-engine/clickbank-products.csv` only if
   that legacy integration is still in use for this client — optional, skip if not applicable.
7. `complete` with `--meta {"result": "<n> products saved"}`.

## Job: `build_campaign` (payload: `{product_id, vendor_id}`)

Generate the full kit per the clickbank-affiliate-engine skill (read its
`references/campaign-kit.md` when available). All copy claims must be traceable to the
product's sales page. Save assets incrementally with
`npm run engine -- save-campaign <productId> --meta camp.json` (any subset of):

- `hoplinks_txt` — one hoplink per channel with `&tid=` fb / tt / blog / email / page
- `fb_ads_md` — 3 Meta-compliant angles (primary text, headline, description, CTA;
  no personal-attribute callouts, no unrealistic claims)
- `tiktok_md` — 3 hooks + 3 full 30–45s UGC scripts (spoken lines + shot notes)
- `landing_md` — presell/bridge copy (headline, lead, mechanism, benefits, proof, FAQ, CTA)
- `presell_html` — single self-contained advertorial page (inline CSS), every CTA goes
  straight to the `tid=page` hoplink, includes an affiliate disclosure
- `bridge_html` — a second, optional landing page: a two-step **lead-capture** flow instead
  of a direct advertorial. Structure:
  1. **Step 1 (capture)** — hook headline tied to the product's angle + a short form asking
     for name (optional) and email (required); one CTA (e.g. "Get My Free Access").
  2. **Step 2 (reveal)** — shown after the form "submits": a short confirmation/bridge message
     plus the actual offer CTA button, using the `tid=page` hoplink.
  Both steps live in one self-contained HTML file (inline CSS, one small inline `<script>`
  toggling step visibility) — no external JS libraries, no real network calls. The form's
  submit handler MUST be a clearly marked, inert placeholder:
  `e.preventDefault()` then reveal step 2 — do not fabricate a working POST endpoint. Mark it
  with an unmissable comment right above the `<form>` tag:
  `<!-- LEAD_CAPTURE_ENDPOINT: no backend wired yet. Point this form at your own API or ESP
  (e.g. POST /api/leads, Mailchimp, ConvertKit) before running paid traffic. -->`. Include the
  same disclosure/disclaimer blocks as the presell page. Never claim leads are being stored.
- `blog_md` — 1200–1800 word SEO article (`tid=blog`), with disclosure
- `social_md` — 5 captions; `email_md` — 3-email swipe sequence (`tid=email`)
- `images_json` — list of generated ad image paths/URLs if image tools are available
  (2× 1080×1080, 2× 1080×1920, 1× 1600×900; no fake endorsements or platform logos)

### Sourcing product images for `presell_html` / `bridge_html`

Both landing pages should carry at least one real product image so they don't read as
text-only. While visiting the sales page for compliance verification, also grab imagery:

1. **What to take**: neutral product photography only — a bottle/box/package shot, an ebook
   or guide cover mockup, a screenshot of the actual app/dashboard/interface. **Never** reuse
   photos of people (testimonials, "customer" photos, before/after imagery, stock models) —
   that's the same red line as the copy rules, since the ad system reviews images too.
2. **How to grab it**: from a browser tab already on the sales page, find the image element's
   `src` (via `read_page` or `javascript_tool`), then fetch it and base64-encode it:
   `fetch(url).then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader();
   fr.onload = () => res(fr.result); fr.readAsDataURL(b); }))` (returns a ready-to-use
   `data:image/...;base64,...` string). Embed that string directly as the `<img src="...">` in
   both `presell_html` and `bridge_html` — **never hotlink** the vendor's URL directly; the page
   must stay self-contained per the single-file rule, and hotlinks break if the vendor changes
   their site.
3. **Where it goes**: a hero image near the top of `presell_html` (below the headline, above
   "What you get"), and optionally a smaller supporting image in `bridge_html`'s step 2 (reveal)
   panel. Keep it modest in size — a product shot is normally well under 200KB; if the source
   image is huge, it's fine to skip rather than bloat the page.
4. **If no clean image is available** (hotlink-protected CDN, only people/testimonial photos,
   page blocked): don't fabricate one. Do not AI-generate a mockup of the physical/digital
   product — that misrepresents what the buyer actually gets. Leave the page as the existing
   text-and-color design and note "no product image available" in the campaign `notes`.
5. Note the source image URL(s) in `images_json` (e.g. `{"source_images": ["https://vendor.../product.png"]}`) for traceability.

Then mirror the kit into Drive `clickbank-engine/campaigns/<vendor_id>/` when Drive is
available, and `complete` with `--meta {"drive_link": "<folder url>"}` (sets the product to
Promoting and the campaign to ready). If generation partially fails, save what exists and
`fail` with a clear message.
