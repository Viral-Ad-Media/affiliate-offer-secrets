"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

// Contacts → Import. For a list the tenant already owns; the bridge-page opt-in form remains the
// path for leads captured from traffic.
export default function ContactImportPanel({
  tags,
  campaigns,
}: {
  tags: { id: string; name: string }[];
  campaigns: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [tagId, setTagId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; invalid: number } | null>(null);

  async function readFile(file: File) {
    setCsv(await file.text());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, tag_id: tagId || null, campaign_id: campaignId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult(data);
      toast.success(`${data.imported} ${data.imported === 1 ? "contact" : "contacts"} imported`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
      toast.error(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Upload className="h-5 w-5 text-emerald-400" /> Import contacts
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Paste or upload a CSV with an <code className="text-zinc-400">email</code> column — a{" "}
          <code className="text-zinc-400">first name</code> column is used if it&apos;s there.
          Addresses you already have are skipped, not duplicated.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-xl border border-ink-700 bg-ink-900 space-y-4 p-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">CSV</span>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            placeholder={"email,first name\njane@example.com,Jane\njoe@example.com,Joe"}
            className="w-full resize-y rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 font-mono text-xs outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
            className="text-xs text-zinc-400 file:mr-2 file:rounded-lg file:border file:border-ink-600 file:bg-ink-800 file:px-3 file:py-1.5 file:text-xs file:text-zinc-200"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Tag these contacts (optional)</span>
            <select
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
              className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
            >
              <option value="">No tag</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[12px] text-zinc-500">
              Applied to matching contacts you already have too, so you can tag an existing segment
              by re-importing its list.
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Attribute to a campaign (optional)</span>
            <select
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
            >
              <option value="">No campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}
        {result && (
          <p className="text-sm text-emerald-300">
            Imported {result.imported}. Skipped {result.duplicates} already on your list
            {result.invalid > 0 ? `, and ${result.invalid} without a valid email address` : ""}.
          </p>
        )}

        <Button type="submit" disabled={busy || !csv.trim()} className="text-xs">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Import
        </Button>
      </form>
    </div>
  );
}
