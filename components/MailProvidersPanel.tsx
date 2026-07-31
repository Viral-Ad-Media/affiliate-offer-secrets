"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Send, Zap, Server, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { RadioGroup, RadioCard } from "@/components/ui/radio-group-card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ProviderRow = {
  provider: "resend" | "sendgrid" | "mailgun" | "smtp";
  from_address: string;
  from_name: string | null;
  status: "connected" | "error";
  error: string | null;
  smtp_host: string | null;
  mailgun_domain: string | null;
};

export type MailProvidersStatus = {
  active_provider: "resend" | "sendgrid" | "mailgun" | "smtp" | null;
  providers: ProviderRow[];
};

const PROVIDER_LABELS: Record<string, string> = {
  resend: "Resend",
  sendgrid: "SendGrid",
  mailgun: "Mailgun",
  smtp: "SMTP",
};

// The "Email sending" section of the Integrations page: which providers are connected (each's
// own OAuth panel stays separate above this), per-provider connect forms, and the active-sender
// picker — exactly one provider sends at a time; every send surface (SendEmail, Broadcast)
// dispatches through it server-side (lib/mail/send.ts).
export default function MailProvidersPanel({
  status,
}: {
  status: MailProvidersStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-provider connect form state — flat keyed fields keep this one component instead of four.
  const [fields, setFields] = useState<Record<string, string>>({});
  const f = (k: string) => fields[k] ?? "";
  const setF = (k: string, v: string) => setFields((s) => ({ ...s, [k]: v }));

  const byProvider = new Map(status.providers.map((p) => [p.provider, p]));

  async function setActive(provider: string) {
    setBusy("active");
    setError(null);
    const { error: err } = await createClient().rpc("set_active_mail_provider", { p_provider: provider });
    setBusy(null);
    if (err) {
      setError(err.message);
      return;
    }
    router.refresh();
  }

  async function connect(provider: ProviderRow["provider"]) {
    setBusy(provider);
    setError(null);
    setNotice(null);
    const body: Record<string, unknown> = {
      provider,
      credential: f(`${provider}_credential`),
      from_address: f(`${provider}_from_address`),
      from_name: f(`${provider}_from_name`) || undefined,
    };
    if (provider === "mailgun") {
      body.mailgun_domain = f("mailgun_domain");
      body.mailgun_region = f("mailgun_region") === "eu" ? "eu" : "us";
    }
    if (provider === "smtp") {
      body.smtp_host = f("smtp_host");
      body.smtp_port = Number(f("smtp_port"));
      body.smtp_username = f("smtp_username");
      body.smtp_secure = f("smtp_port") === "465";
    }
    const res = await fetch("/api/mail-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "Failed to connect");
      return;
    }
    setNotice(`${PROVIDER_LABELS[provider]} connected — credential verified.`);
    setFields((s) => ({ ...s, [`${provider}_credential`]: "" }));
    router.refresh();
  }

  async function disconnect(provider: string) {
    setBusy(provider);
    setError(null);
    await fetch("/api/mail-providers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    setBusy(null);
    router.refresh();
  }

  function connectForm(provider: ProviderRow["provider"], credentialLabel: string, extra?: React.ReactNode) {
    const existing = byProvider.get(provider);
    return (
      <div className="space-y-3">
        {existing && (
          <div className="flex items-center justify-between rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2">
            <div className="text-xs text-zinc-300">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-400" />
              Connected — sends as {existing.from_address}
              {existing.status === "error" && (
                <span className="ml-2 text-amber-400" title={existing.error ?? undefined}>
                  needs reconnect
                </span>
              )}
            </div>
            <button onClick={() => disconnect(provider)} disabled={busy === provider} className="btn-ghost !py-1 text-xs">
              Disconnect
            </button>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${provider}_credential`}>{credentialLabel}</Label>
            <Input
              id={`${provider}_credential`}
              type="password"
              value={f(`${provider}_credential`)}
              onChange={(e) => setF(`${provider}_credential`, e.target.value)}
              placeholder={existing ? "Enter to replace the stored credential" : credentialLabel}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${provider}_from_address`}>From address</Label>
            <Input
              id={`${provider}_from_address`}
              type="email"
              value={f(`${provider}_from_address`) || existing?.from_address || ""}
              onChange={(e) => setF(`${provider}_from_address`, e.target.value)}
              placeholder="you@yourdomain.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${provider}_from_name`}>From name (optional)</Label>
            <Input
              id={`${provider}_from_name`}
              value={f(`${provider}_from_name`) || existing?.from_name || ""}
              onChange={(e) => setF(`${provider}_from_name`, e.target.value)}
              placeholder="Your brand"
            />
          </div>
          {extra}
        </div>
        <p className="text-xs text-zinc-500">
          The from address must be verified with the provider (a verified domain/sender) or sends will be rejected.
        </p>
        <button onClick={() => connect(provider)} disabled={busy === provider} className="btn-primary">
          {busy === provider ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {existing ? "Update connection" : "Verify & connect"}
        </button>
      </div>
    );
  }

  return (
    <div className="card space-y-5 p-5">
      <div>
        <h2 className="mb-1 text-sm font-semibold text-zinc-100">Email providers</h2>
        <p className="text-sm text-zinc-400">
          Connect a transactional provider to send from your own domain — one sender is active at a
          time, and every send (one-off emails and Broadcast sequences) uses it.
        </p>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}

      <Tabs defaultValue="resend">
        <TabsList>
          <TabsTrigger value="resend">Resend</TabsTrigger>
          <TabsTrigger value="sendgrid">SendGrid</TabsTrigger>
          <TabsTrigger value="mailgun">Mailgun</TabsTrigger>
          <TabsTrigger value="smtp">SMTP</TabsTrigger>
        </TabsList>
        <TabsContent value="resend" className="pt-3">
          {connectForm("resend", "Resend API key")}
        </TabsContent>
        <TabsContent value="sendgrid" className="pt-3">
          {connectForm("sendgrid", "SendGrid API key")}
        </TabsContent>
        <TabsContent value="mailgun" className="pt-3">
          {connectForm(
            "mailgun",
            "Mailgun API key",
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mailgun_domain">Sending domain</Label>
                <Input
                  id="mailgun_domain"
                  value={f("mailgun_domain") || byProvider.get("mailgun")?.mailgun_domain || ""}
                  onChange={(e) => setF("mailgun_domain", e.target.value)}
                  placeholder="mg.yourdomain.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mailgun_region">Region</Label>
                <select
                  id="mailgun_region"
                  value={f("mailgun_region") || "us"}
                  onChange={(e) => setF("mailgun_region", e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                >
                  <option value="us">US</option>
                  <option value="eu">EU</option>
                </select>
              </div>
            </>
          )}
        </TabsContent>
        <TabsContent value="smtp" className="pt-3">
          {connectForm(
            "smtp",
            "SMTP password",
            <>
              <div className="space-y-1.5">
                <Label htmlFor="smtp_host">SMTP host</Label>
                <Input
                  id="smtp_host"
                  value={f("smtp_host") || byProvider.get("smtp")?.smtp_host || ""}
                  onChange={(e) => setF("smtp_host", e.target.value)}
                  placeholder="smtp.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp_port">Port (465 TLS / 587 STARTTLS)</Label>
                <Input
                  id="smtp_port"
                  type="number"
                  value={f("smtp_port")}
                  onChange={(e) => setF("smtp_port", e.target.value)}
                  placeholder="587"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smtp_username">Username</Label>
                <Input
                  id="smtp_username"
                  value={f("smtp_username")}
                  onChange={(e) => setF("smtp_username", e.target.value)}
                  placeholder="postmaster@example.com"
                />
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Active sender</h3>
        <RadioGroup
          value={status.active_provider ?? ""}
          onValueChange={(v) => setActive(v)}
          disabled={busy === "active"}
          className="sm:grid-cols-3"
        >
          {(["resend", "sendgrid", "mailgun", "smtp"] as const).map((p) => {
            const row = byProvider.get(p);
            return (
              <RadioCard
                key={p}
                value={p}
                title={PROVIDER_LABELS[p]}
                description={row ? `Sends as ${row.from_address}` : "Not connected yet."}
                icon={p === "smtp" ? <Server size={18} /> : p === "resend" ? <Zap size={18} /> : <Send size={18} />}
                disabled={!row}
              />
            );
          })}
        </RadioGroup>
      </div>
    </div>
  );
}
