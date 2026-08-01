"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, CheckCircle2, Download, Trash2, Loader2 } from "lucide-react";
import type { Contact } from "@/lib/shared";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/lib/toast";

// Flattens a lead's user-added form fields (Phase O.5) into one "key: value; key: value" string —
// deliberate v1 scope cut, matching the plan's own call: no dynamic per-field columns, since the
// field set varies per campaign/variant and even changes over time as a tenant edits their form.
function flattenExtraFields(extraFields: Record<string, string>): string {
  return Object.entries(extraFields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
}

export default function ContactsTable({ contacts }: { contacts: Contact[] }) {
  const router = useRouter();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function copyEmail(id: string, email: string) {
    await navigator.clipboard.writeText(email);
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  }

  // Deleting a lead is irreversible and it's someone else's data, so it asks first — and names the
  // address, since one row in a long table is easy to mis-click.
  async function deleteContact(c: Contact) {
    if (!window.confirm(`Delete ${c.email}? This can't be undone.`)) return;
    setDeletingId(c.id);
    const { data, error } = await createClient().rpc("delete_contact", { p_contact_id: c.id });
    setDeletingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data) {
      toast.error("That contact no longer exists");
      return;
    }
    toast.success(`Deleted ${c.email}`);
    router.refresh();
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
          <a
            href="/api/contacts/export"
            title="Download every contact, not just this page"
            className="btn-ghost text-xs"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </a>
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
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => copyEmail(c.id, c.email)}
                        title="Copy email"
                        className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                      >
                        {copiedId === c.id ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => deleteContact(c)}
                        disabled={deletingId === c.id}
                        title="Delete this lead"
                        className="rounded p-1 text-zinc-500 hover:text-red-400"
                      >
                        {deletingId === c.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
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
