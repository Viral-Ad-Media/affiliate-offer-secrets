"use client";

import { useEffect, useState } from "react";
import { marked } from "marked";
import { Mail, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function SendEmail({
  campaignId,
  defaultBody,
}: {
  campaignId: string;
  defaultBody: string;
}) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(defaultBody);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    // "Can this account send email right now, via whatever its active sender is" — Gmail or a
    // connected Resend/SendGrid/Mailgun/SMTP provider (lib/mail/send.ts dispatches server-side).
    createClient()
      .rpc("get_active_mail_sender")
      .then(({ data }: { data: any }) => {
        setConnected(!!data?.connected);
        setLoading(false);
      });
  }, []);

  useEffect(() => setBody(defaultBody), [defaultBody]);

  if (loading) return null;

  if (!connected) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-4 text-sm text-zinc-400">
        Connect an email sender (Gmail, Resend, SendGrid, Mailgun, or SMTP) in{" "}
        <a href="/connections" className="text-emerald-400 underline">
          Connections
        </a>{" "}
        to send this directly.
      </div>
    );
  }

  async function send() {
    setBusy(true);
    setResult(null);
    const res = await fetch("/api/mail/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to,
        subject,
        html: marked.parse(body) as string,
        campaign_id: campaignId,
      }),
    });
    const data = await res.json();
    setBusy(false);
    setResult(res.ok ? { ok: true, text: "Sent!" } : { ok: false, text: data.error ?? "Failed to send" });
  }

  return (
    <div className="rounded-lg border border-ink-700 p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500">
        <Mail className="h-3.5 w-3.5" /> Trim this down to one email from the sequence before
        sending — this sends a single message, not a scheduled drip.
      </div>
      <input
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder="Recipient email"
        className="mb-2 w-full rounded-lg border border-ink-600 bg-ink-900 p-2.5 text-sm outline-none focus:border-emerald-500"
      />
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="mb-2 w-full rounded-lg border border-ink-600 bg-ink-900 p-2.5 text-sm outline-none focus:border-emerald-500"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={10}
        className="w-full rounded-lg border border-ink-600 bg-ink-900 p-3 text-sm outline-none focus:border-emerald-500"
      />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={send} disabled={busy || !to.trim() || !subject.trim() || !body.trim()} className="btn-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Send Email
        </button>
        {result && (
          <span className={`text-sm ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
            {result.text}
          </span>
        )}
      </div>
    </div>
  );
}
