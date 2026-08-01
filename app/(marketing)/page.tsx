import Link from "next/link";
import {
  Search,
  Sparkles,
  Filter,
  Rocket,
  Facebook,
  ShieldCheck,
  Coins,
  Globe,
  Users,
  Send,
  Newspaper,
  Video,
  Beaker,
  BarChart3,
} from "lucide-react";

// Everything claimed on this page has actually shipped. Two things deliberately NOT claimed,
// because they haven't: automated marketplace discovery for anything but ClickBank (Digistore24 is
// manual product entry, Everflow is connect-only), and SMS.

const STEPS = [
  {
    icon: Search,
    title: "Discover",
    body: "Pick a category and the engine pulls live marketplace data, scores products, verifies each one against its real sales page, and surfaces what's worth promoting today.",
  },
  {
    icon: Sparkles,
    title: "Generate",
    body: "Every product gets a full kit automatically: three structured ad angles, TikTok scripts, a funnel, a blog article, email swipes and social captions — each claim traceable to the vendor's own page.",
  },
  {
    icon: Filter,
    title: "Build the funnel",
    body: "Edit any page on a drag-and-drop canvas, add thank-you / upsell / order steps after the opt-in, split-test the copy, and publish on your own domain.",
  },
  {
    icon: Rocket,
    title: "Launch and follow up",
    body: "Publish to Facebook, Instagram, TikTok or YouTube, launch a paused-for-review Meta ad, and drip your email sequence to the leads the funnel captures.",
  },
];

const FEATURES = [
  {
    icon: Search,
    title: "Live product discovery",
    body: "Fresh ClickBank marketplace stats on every run, scored and filtered by category and subcategory — never stale data. Add products from other networks by hand.",
  },
  {
    icon: Sparkles,
    title: "Full campaign kits",
    body: "Three ad angles, TikTok scripts, funnel pages, a blog article, email swipes and social captions per product — with a real product image embedded, never hotlinked.",
  },
  {
    icon: Filter,
    title: "Drag-and-drop page builder",
    body: "Sections, rows and columns, headings, images, lists, buttons and custom form fields, each with its own typography, colour and spacing controls — on a canvas that looks like the live page.",
  },
  {
    icon: Beaker,
    title: "Split testing built in",
    body: "Run copy variants against the same funnel URL with weighted traffic, sticky visitor assignment, and per-variant view and lead counts. Promote the winner in one click.",
  },
  {
    icon: Users,
    title: "Lead capture and contacts",
    body: "Opt-ins land in your own contact list — taggable, importable from CSV, exportable to any ESP, and ready to enrol in a sequence.",
  },
  {
    icon: Send,
    title: "Email that actually sends",
    body: "One-off broadcasts and multi-step drip sequences through your own Resend, SendGrid, Mailgun or SMTP account, with unsubscribe handling built in.",
  },
  {
    icon: Video,
    title: "AI images and video",
    body: "Generate an ad image or a short-form video per angle and per social post, then post it straight to Instagram Reels, TikTok or YouTube.",
  },
  {
    icon: Facebook,
    title: "Connect your own accounts",
    body: "Facebook, Instagram, TikTok and YouTube connect over OAuth. Every post is logged in a single audit trail.",
  },
  {
    icon: Coins,
    title: "Credit-gated ad launches",
    body: "Launch a specific angle as a real Meta ad — image or video — against your own ad account. Paused for review until you confirm, then deducted from your credit balance.",
  },
  {
    icon: Globe,
    title: "Your own domains",
    body: "Bring your domains and serve funnels and your blog from them, several campaigns per domain, each on its own path.",
  },
  {
    icon: Newspaper,
    title: "A real blog, not just posts",
    body: "Public index, SEO slugs, categories, featured images, RSS and sitemap — hosted on your domain, indexable, and importable straight from a campaign.",
  },
  {
    icon: BarChart3,
    title: "Tracking and analytics",
    body: "Drop GA4, GTM, Clarity or the Meta Pixel into any funnel, and see leads, live funnels, emails sent and posts published in one place.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance-aware copy",
    body: "Every claim is traceable back to the vendor's sales page, with affiliate disclosures and consent text built into every page the engine generates — and impossible to edit out.",
  },
  {
    icon: Rocket,
    title: "You keep control",
    body: "Your own affiliate ID, your own ad account, your own domains and mailbox. The platform never holds your ad spend or your commissions.",
  },
];

export default function HomePage() {
  return (
    <div>
      <section className="border-b border-ink-700 bg-gradient-to-b from-ink-900/60 to-ink-950">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:py-28">
          <span className="chip border-ink-600 bg-ink-800 text-zinc-300">
            Built for affiliate marketers
          </span>
          <h1 className="mt-5 text-4xl font-bold text-zinc-100 sm:text-5xl">
            Find winning affiliate products.
            <br className="hidden sm:block" /> Ship the whole funnel in minutes.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 sm:text-lg">
            Affiliate Studio researches the marketplace, writes your ads, funnel pages, blog and
            emails, hosts them on your own domain, and launches real campaigns — from one
            dashboard.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className="btn-primary px-5 py-2.5 text-base">
              Start your free trial
            </Link>
            <Link href="/pricing" className="btn-ghost px-5 py-2.5 text-base">
              See pricing
            </Link>
          </div>
          <p className="mt-4 text-xs text-zinc-600">
            30-day free trial, no credit card required to start.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold text-zinc-100 sm:text-3xl">How it works</h2>
          <p className="mt-3 text-sm text-zinc-400">
            From a category name to a live funnel with traffic pointed at it.
          </p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <div key={step.title} className="card p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <step.icon className="h-4.5 w-4.5" />
                </div>
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Step {i + 1}
                </span>
              </div>
              <h3 className="mt-4 font-heading text-lg font-semibold text-zinc-100">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-ink-700 bg-ink-900/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold text-zinc-100 sm:text-3xl">Everything you need</h2>
            <p className="mt-3 text-sm text-zinc-400">
              Research, creative, funnel, hosting, email and ads — one workflow instead of six
              tools.
            </p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="card p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <f.icon className="h-4.5 w-4.5" />
                </div>
                <h3 className="mt-3 font-heading text-base font-semibold text-zinc-100">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
        <h2 className="text-2xl font-bold text-zinc-100 sm:text-3xl">
          Ready to find your next product?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-400">
          Start a 30-day free trial and generate your first full campaign kit today.
        </p>
        <div className="mt-7">
          <Link href="/login" className="btn-primary px-5 py-2.5 text-base">
            Start your free trial
          </Link>
        </div>
      </section>
    </div>
  );
}
