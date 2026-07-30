"use client";

import { useState } from "react";
import { Copy, CheckCircle2, Download } from "lucide-react";
import type { Contact } from "@/lib/shared";

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Flattens a lead's user-added form fields (Phase O.5) into one "key: value; key: value" string —
// deliberate v1 scope cut, matching the plan's own call: no dynamic per-field columns, since the
// field set varies per campaign/variant and even changes over time as a tenant edits their form.
function flattenExtraFields(extraFields: Record<string, string>): string {
  return Object.entries(extraFields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

function exportCsv(contacts: Contact[]) {
  const header = ["First name", "Email", "Campaign", "Extra fields", "Captured at"];
  const rows = contacts.map((c) => [
    csvField(c.first_name ?? ""),
    csvField(c.email),
    csvField(c.campaign_title ?? ""),
    csvField(flattenExtraFields(c.extra_fields)),
    csvField(c.created_at),
  ]);
  const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ContactsTable({ contacts }: { contacts: Contact[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyEmail(id: string, email: string) {
    await navigator.clipboard.writeText(email);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Captured leads</h2>
          <p className="text-xs text-zinc-500">
            Every visitor who submitted a bridge page opt-in form.
          </p>
        </div>
        {contacts.length > 0 && (
          <button
            onClick={() => exportCsv(contacts)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        )}
      </div>
      {contacts.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-zinc-500">
          No leads captured yet — leads appear here once visitors submit a bridge page's opt-in
          form.
        </p>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-ink-900">
              <tr className="border-b border-ink-700 text-left text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2">When</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">Campaign</th>
                <th className="px-2 py-2">Extra</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-ink-800">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-zinc-500">
                    {new Date(c.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-2 py-2 text-zinc-300">{c.first_name || "—"}</td>
                  <td className="px-2 py-2 text-zinc-300">{c.email}</td>
                  <td className="px-2 py-2 text-zinc-400">{c.campaign_title ?? "—"}</td>
                  <td className="max-w-[16rem] truncate px-2 py-2 text-xs text-zinc-500" title={flattenExtraFields(c.extra_fields)}>
                    {Object.keys(c.extra_fields).length > 0 ? flattenExtraFields(c.extra_fields) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => copyEmail(c.id, c.email)}
                      className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                    >
                      {copiedId === c.id ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
