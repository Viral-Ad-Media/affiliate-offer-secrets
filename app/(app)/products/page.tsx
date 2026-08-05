"use client";

import ProductsPanel from "@/components/ProductsPanel";

// The offers this workspace is tracking, on their own page — the same table Marketplace shows
// under its discovery form, without the discovery form. Marketplace answers "what should I
// promote"; this answers "what am I already working on".
export default function MyProductsPage() {
  return (
    <main className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-zinc-100">My Products</h1>
        <p className="text-sm text-zinc-400">
          Every offer you&apos;re tracking. Set a status, copy an affiliate link, or build a
          campaign kit.
        </p>
      </header>

      <ProductsPanel
        basePath="/products"
        emptyHint="Find offers on the Marketplace page, or add one by hand above."
      />
    </main>
  );
}
