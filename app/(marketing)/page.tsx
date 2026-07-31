import Link from "next/link";
import {
  Search,
  Sparkles,
  Rocket,
  Facebook,
  ShieldCheck,
  Coins,
} from "lucide-react";

const STEPS = [
  {
    icon: Search,
    title: "Discover",
    body: "Pick a ClickBank category and let the engine pull live marketplace data, score products, and surface the ones worth promoting today.",
  },
  {
    icon: Sparkles,
    title: "Generate",
    body: "Every product gets a full kit automatically: Facebook & TikTok ad copy, a bridge (lead-capture) landing page, a blog article, email swipes, and social captions — grounded in the vendor's own sales page.",
  },
  {
    icon: Rocket,
    title: "Launch",
    body: "Connect your Facebook Page and ad account, then publish posts or launch a real paused-for-review ad campaign without leaving the dashboard.",
  },
];

const FEATURES = [
  {
    icon: Search,
    title: "Live product discovery",
    body: "Fresh ClickBank marketplace stats on every run, scored and filtered by category — never stale data.",
  },
  {
    icon: Sparkles,
    title: "Full campaign kits",
    body: "Ad copy, a bridge (lead-capture) landing page, blog content, and email swipes generated per product, with a real product image embedded — no hotlinking.",
  },
  {
    icon: Facebook,
    title: "Connect Facebook",
    body: "OAuth-connect your own Page and publish generated captions directly, with an audit trail of every post.",
  },
  {
    icon: Coins,
    title: "Credit-gated ad launches",
    body: "Spin up a real Meta ad campaign against your own ad account — paused for review until you confirm, deducted from your credit balance.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance-aware copy",
    body: "Every claim is traceable back to the vendor's sales page, with affiliate disclosures built into every page the engine generates.",
  },
  {
    icon: Rocket,
    title: "You keep control",
    body: "Your own affiliate nickname, your own ad account, your own Facebook Page. The platform never holds your ad spend.",
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
            <br className="hidden sm:block" /> Ship full campaigns in minutes.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-zinc-400 sm:text-lg">
            Affiliate Studio researches the marketplace, writes your ad copy and pages, and can
            publish to Facebook and launch real ad campaigns — all from one dashboard.
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
            Three steps from a category name to a live, promotable campaign.
          </p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
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
              From research to a live post or a live ad, in one workflow.
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
