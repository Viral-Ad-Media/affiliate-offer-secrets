"use client";

import { NETWORKS, networkInfo, type NetworkId } from "@/lib/networks";

import { useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const NETWORK_OPTIONS = [
  { value: "clickbank", label: "ClickBank" },
  { value: "digistore24", label: "Digistore24" },
] as const;

export default function ManualAddProduct({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [network, setNetwork] = useState<NetworkId>("digistore24");
  const [vendorId, setVendorId] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [niche, setNiche] = useState("");
  const [salesPageUrl, setSalesPageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setVendorId("");
    setProductTitle("");
    setNiche("");
    setSalesPageUrl("");
    setDescription("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/products/manual-add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        network,
        vendor_id: vendorId.trim(),
        product_title: productTitle.trim(),
        niche: niche.trim(),
        sales_page_url: salesPageUrl.trim(),
        description: description.trim(),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't add product");
      return;
    }
    reset();
    setOpen(false);
    onAdded();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" className="text-xs">
        <Plus className="h-3.5 w-3.5" /> Add product manually
      </Button>

      {/* A dialog rather than a panel that unfolds in place: this form is six fields tall, and
          expanding it inline pushed the products table — the thing you came to this page for —
          off the screen. Closing it keeps whatever was typed, so a mis-click doesn't discard the
          form; only a successful add resets it. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Add a product manually</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {NETWORK_OPTIONS.map((n) => (
                <button
                  key={n.value}
                  type="button"
                  onClick={() => setNetwork(n.value)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    network === n.value
                      ? "bg-emerald-600 text-white"
                      : "border border-ink-600 text-zinc-400 hover:bg-ink-700"
                  }`}
                >
                  {n.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Product ID</label>
                <input
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                  placeholder={network === "digistore24" ? "e.g. 220831" : "e.g. vendorname"}
                  required
                  className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-500">Niche</label>
                <input
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder="e.g. Weight Loss"
                  className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Product title</label>
              <input
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                required
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Sales page URL</label>
              <input
                value={salesPageUrl}
                onChange={(e) => setSalesPageUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add product
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
