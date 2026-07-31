"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ManualSendPanel, { type ManualContact } from "@/components/ManualSendPanel";
import { Send, Loader2, CheckCircle2, AlertTriangle, Users } from "lucide-react";

type HistoryRow = {
  id: string;
  name: string;
  status: string;
  audience_type: string;
  created_at: string;
  sent_count: number;
};

// Emails → Broadcast. Compose one email, pick an audience, send now. Everything below the "Send"
// button is the existing drip machinery: the server creates a kind='broadcast' sequence with a
// single delay_days=0 step and activates it, so the 1-minute sweep enrols the audience and the
// send_broadcast_email job delivers each one under the same pooled daily cap, with the same
// unsubscribe footer and broadcast_sends audit rows as a sequence step.
export default function BroadcastComposer({
  campaigns,
  history,
  activeProvider,
  contacts,
}: {
  campaigns: { id: string; title: string }[];
  history: HistoryRow[];
  activeProvider: string | null;
  contacts: ManualContact[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "campaign">("all");
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);

  // No active provider means nothing can be sent automatically — the manual path below still
  // works, since that only needs the composed text and the visitor's own mail client.
  const noSender = !activeProvider;
  const canSend = !busy && subject.trim() && body.trim() && (audience !== "campaign" || campaignId) && !noSender;

  async function send() {
    if (!window.confirm("Send this email to the selected audience now? This can't be undone.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/broadcast/send-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || subject.trim(),
          subject: subject.trim(),
          body_md: body,
          audience_type: audience,
          campaign_id: audience === "campaign" ? campaignId : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send");
      setSentAt(Date.now());
      setName("");
      setSubject("");
      setBody("");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Send className="h-5 w-5 text-emerald-400" /> Broadcast
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Send one email now to your contacts. For a multi-step drip that follows each contact&apos;s
          own signup date, use Sequences instead.
        </p>
      </div>

      {noSender && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            No email sender is connected, so automatic sending is off. Connect Resend, SendGrid,
            Mailgun or SMTP on Integrations — or use <strong>Send manually</strong> below, which
            needs no setup.
          </span>
        </div>
      )}

      <section className="card space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Audience</span>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as "all" | "campaign")}
              className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
            >
              <option value="all">All contacts</option>
              <option value="campaign">One campaign&apos;s contacts</option>
            </select>
          </label>
          {audience === "campaign" && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-zinc-400">Campaign</span>
              <select
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none focus:border-emerald-500"
              >
                <option value="">Choose a campaign…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Your subject line"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Message (Markdown)</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            placeholder="Write your email…"
            className="w-full resize-y rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 font-mono text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
          <span className="mt-1 block text-[11px] text-zinc-500">
            An unsubscribe link is appended automatically — it can&apos;t be removed.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Internal name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Defaults to the subject line"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 py-2 px-3 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
        </label>

        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={send} disabled={!canSend} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send now
          </button>
          {sentAt && Date.now() - sentAt < 8000 && (
            <span className="flex items-center gap-1 text-xs text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Queued — delivery starts within a minute
            </span>
          )}
          {activeProvider && (
            <span className="text-xs text-zinc-500">Sending via {activeProvider}</span>
          )}
        </div>
      </section>

      <ManualSendPanel
        contacts={audience === "campaign" && campaignId
          ? contacts.filter((c) => c.campaign_id === campaignId)
          : contacts}
        subject={subject}
        body={body}
      />

      <section className="card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Users className="h-4 w-4 text-emerald-400" /> Past broadcasts
        </div>
        {history.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Nothing sent yet.</p>
        ) : (
          <div className="divide-y divide-ink-800">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-zinc-100">{h.name}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {h.audience_type === "campaign" ? "One campaign" : "All contacts"} ·{" "}
                    {new Date(h.created_at).toLocaleString()}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-zinc-400">{h.sent_count} sent</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-px text-[11px] ${
                    h.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-ink-800 text-zinc-400"
                  }`}
                >
                  {h.status === "active" ? "Sending" : h.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
