"use client";

import Link from "next/link";
import ProductsPanel from "@/components/ProductsPanel";

// The offers this workspace is working on, on their own page — the same table Marketplace shows
// under its discovery form, without the discovery form. Marketplace answers "what should I
// promote"; this answers "what am I already working on".
//
// Which is why it opens FILTERED. Discovery writes every marketplace hit as `New`, so an unfiltered
// list is mostly other people's suggestions: measured here at 95 products, of which 77 were `New`
// with no kit and only 18 were being promoted. Defaulting the filter to the statuses that mean "I
// acted on this" makes the page match its own heading. It is a default, not a lock — clearing the
// status chips shows everything, including `New` and `Dead`.
export default function MyProductsPage() {
  return (
    <main className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">My Products</h1>
          <p className="text-sm text-zinc-400">
            The offers you&apos;re promoting. Set a status, paste an affiliate link, or build a
            campaign kit — clear the status filter to see every product you&apos;ve ever discovered.
          </p>
        </div>
        <Link href="/marketplace" className="shrink-0 text-sm text-emerald-300 hover:text-emerald-200">
          Find more in the Marketplace &rarr;
        </Link>
      </header>

      <ProductsPanel
        basePath="/products"
        defaultStatuses={["Selected", "Promoting", "Paused"]}
        emptyHint="Nothing in progress yet — promote an offer from the Marketplace, or clear the status filter to see everything you've discovered."
      />
    </main>
  );
}
