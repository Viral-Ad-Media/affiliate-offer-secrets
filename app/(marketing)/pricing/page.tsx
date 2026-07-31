import Link from "next/link";
import { Check } from "lucide-react";
import { ACCESS_FEE_CENTS, CREDIT_PACKS } from "@/lib/pricing";

export const metadata = {
  title: "Pricing — Affiliate Studio",
  description: "One-time access fee plus pay-as-you-go ad credits.",
};

const ACCESS_INCLUDES = [
  "Unlimited product discovery across all ClickBank categories",
  "Unlimited campaign kit generation (ads, bridge landing pages, blog, email)",
  "Connect your Facebook Page and publish posts",
  "Full usage & cost audit trail",
  "30-day free trial before you pay anything",
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">
          Simple, one-time pricing
        </h1>
        <p className="mt-4 text-base text-zinc-400">
          Pay once for lifetime software access. Ad credits are optional and only needed if you
          want to launch real Meta ad campaigns from inside the dashboard.
        </p>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        <div className="card flex flex-col p-7">
          <span className="chip w-fit border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            Software access
          </span>
          <div className="mt-4 flex items-baseline gap-1">
            <span className="font-heading text-4xl font-bold text-zinc-100">
              ${(ACCESS_FEE_CENTS / 100).toFixed(0)}
            </span>
            <span className="text-sm text-zinc-500">one-time</span>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            Unlock the full dashboard for good — no subscription, no renewal.
          </p>
          <ul className="mt-6 space-y-2.5">
            {ACCESS_INCLUDES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-zinc-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                {item}
              </li>
            ))}
          </ul>
          <Link href="/login" className="btn-primary mt-8 w-full py-2.5 text-base">
            Start your free trial
          </Link>
        </div>

        <div className="card flex flex-col p-7">
          <span className="chip w-fit border-ink-600 bg-ink-800 text-zinc-300">
            Ad credits (optional)
          </span>
          <div className="mt-4">
            <span className="font-heading text-4xl font-bold text-zinc-100">1 credit</span>
            <span className="ml-1 text-sm text-zinc-500">≈ $1 of ad budget</span>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            Credits authorize the platform to launch a paused campaign on your own connected ad
            account. Meta bills your ad spend directly to you — the platform never holds your ad
            money. Top up in packs whenever you need more:
          </p>
          <ul className="mt-6 space-y-2.5">
            {CREDIT_PACKS.map((pack) => (
              <li
                key={pack.credits}
                className="flex items-center justify-between rounded-lg border border-ink-700 px-4 py-3"
              >
                <span className="text-sm text-zinc-300">{pack.credits} credits</span>
                <span className="font-heading text-base font-semibold text-zinc-100">
                  ${(pack.cents / 100).toFixed(0)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-xs text-zinc-600">
            Credits are only spent when you explicitly activate a paused ad campaign — building
            and reviewing drafts is always free.
          </p>
        </div>
      </div>

      <p className="mx-auto mt-10 max-w-2xl text-center text-xs text-zinc-600">
        Facebook posting and ad launches require connecting your own Facebook Page and Meta ad
        account. See the <Link href="/faq" className="underline hover:text-zinc-400">FAQ</Link>{" "}
        for details.
      </p>
    </div>
  );
}
