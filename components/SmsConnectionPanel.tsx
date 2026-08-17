"use client";

import { useState } from "react";
import { MessageSquare, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export type SmsStatus = {
  connected: boolean;
  provider?: string;
  from_number?: string;
  account_sid?: string;
  status?: "active" | "error";
  error_message?: string | null;
};

/**
 * Connect a Twilio number for SMS.
 *
 * Credentials are verified live by the route before anything is stored, so a bad token is an error
 * on this form rather than a mystery on the first send — the same contract the mail providers have.
 * The auth token is write-only here: it goes to Vault and the sanitized status RPC never returns
 * it, so there is nothing to render back and no "reveal" affordance to build.
 */
export default function SmsConnectionPanel({ status }: { status: SmsStatus }) {
  const [sid, setSid] = useState("");
  const [token, setToken] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(status.connected);
  const [fromNumber, setFromNumber] = useState(status.from_number ?? "");

  async function connect() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sms/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_sid: sid, auth_token: token, from_number: from }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not connect");
      return;
    }
    setConnected(true);
    setFromNumber(data.from_number);
    // The token is never held longer than the request needs it.
    setToken("");
    setSid("");
    setFrom("");
  }

  async function disconnect() {
    setBusy(true);
    await fetch("/api/sms/connection", { method: "DELETE" });
    setBusy(false);
    setConnected(false);
    setFromNumber("");
  }

  return (
    <Card as="section" className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <MessageSquare className="h-4 w-4 text-emerald-400" /> SMS (Twilio)
        </h3>
        {connected ? (
          status.status === "error" ? (
            <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-300">
              <AlertTriangle className="h-3 w-3" /> Needs reconnect
            </Badge>
          ) : (
            <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
              <CheckCircle2 className="h-3 w-3" /> {fromNumber}
            </Badge>
          )
        ) : null}
      </div>

      {connected ? (
        <>
          <p className="mt-2 text-sm text-zinc-400">
            Sending from <span className="font-mono text-zinc-300">{fromNumber}</span>.
          </p>
          {status.error_message && (
            <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
              {status.error_message}
            </p>
          )}
          {/* The one setup step this app cannot do for the tenant, so it says it rather than
              leaving STOP quietly unhandled — an unhandled opt-out is the failure that gets a
              number shut off. */}
          <p className="mt-3 rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-xs text-zinc-400">
            In the Twilio console, set this number&apos;s <strong>“A message comes in”</strong> webhook
            to{" "}
            <span className="font-mono text-zinc-300">
              {process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/sms/inbound
            </span>{" "}
            (HTTP POST). That endpoint is how STOP replies reach us — without it, opt-outs are only
            honoured by Twilio and not recorded against your contacts.
          </p>
          <Button onClick={disconnect} disabled={busy} variant="outline" className="mt-3 text-xs">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Disconnect
          </Button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-400">
            Paste your Twilio credentials and the number you send from. Checked against Twilio before
            anything is saved.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="sms-sid">Account SID</Label>
              <Input id="sms-sid" value={sid} onChange={(e) => setSid(e.target.value)} placeholder="AC…" />
            </div>
            <div>
              <Label htmlFor="sms-token">Auth token</Label>
              <Input
                id="sms-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            <div>
              <Label htmlFor="sms-from">From number</Label>
              <Input id="sms-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="+15551234567" />
            </div>
          </div>
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
          <Button onClick={connect} disabled={busy || !sid || !token || !from} className="mt-3">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Connect
          </Button>
        </>
      )}
    </Card>
  );
}
