import { redirect } from "next/navigation";
import Link from "next/link";
import { MessageSquare, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import EmptyState from "@/components/EmptyState";
import LoadFailed from "@/components/LoadFailed";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// SMS drips and their delivery log.
//
// Sequences live in the SAME broadcast_sequences table as email, separated by `channel` (0098) —
// so this page is the channel='sms' view of the machinery /emails/sequences shows for email, not a
// parallel system. Read-only for now: a sequence is composed on its own detail page, and the one
// thing that would be destructive from a list (activating a drip to real phone numbers) belongs
// where the messages are in front of you.
export default async function SmsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ws = await currentWorkspaceId();
  if (!ws) redirect("/login");

  const [{ data: sequences, error: seqError }, { data: sends }, smsStatus, { count: eligible }] =
    await Promise.all([
      supabase
        .from("broadcast_sequences")
        .select("id, name, status, created_at")
        .eq("workspace_id", ws)
        .eq("channel", "sms")
        .order("created_at", { ascending: false }),
      supabase
        .from("sms_sends")
        .select("id, to_number, body, status, error_message, segments, created_at")
        .eq("workspace_id", ws)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .rpc("get_sms_connection_status", { p_workspace_id: ws })
        .then((r) => (r.data ?? { connected: false }) as { connected: boolean; from_number?: string; status?: string }),
      // How many contacts could actually be texted right now — the number that decides whether any
      // of this does anything. Consent is required, so this is usually 0 until an opt-in form
      // carrying the sms_consent checkbox has been live for a while.
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws)
        .not("phone", "is", null)
        .not("sms_consent_at", "is", null)
        .is("sms_opted_out_at", null),
    ]);

  return (
    <main className="space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
          <MessageSquare className="h-6 w-6 text-emerald-400" /> SMS
        </h1>
        <p className="text-sm text-zinc-400">
          Text drips to leads who explicitly opted in. Message copy is generated with a campaign kit;
          sending runs on the same schedule engine as email.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Sender</h2>
          {smsStatus.connected ? (
            <>
              <p className="mt-2 font-mono text-sm text-zinc-100">{smsStatus.from_number}</p>
              {smsStatus.status === "error" && (
                <p className="mt-1 text-xs text-amber-300">Credentials were rejected — reconnect.</p>
              )}
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-400">Not connected</p>
              <Link
                href="/settings/integrations"
                className={cn(buttonVariants({ variant: "outline" }), "mt-2 text-xs")}
              >
                Connect Twilio
              </Link>
            </>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <ShieldCheck className="h-3.5 w-3.5" /> Textable contacts
          </h2>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{eligible ?? 0}</p>
          {/* Stated rather than left to be discovered from an empty send log: a phone number on a
              contact is not permission to text it. */}
          <p className="mt-1 text-xs text-zinc-500">
            With a number <em>and</em> explicit SMS consent, minus anyone who replied STOP.
          </p>
        </Card>

        <Card className="p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Sent · last 25</h2>
          <p className="mt-2 text-2xl font-bold text-zinc-100">
            {(sends ?? []).filter((s) => s.status === "sent").length}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {(sends ?? []).filter((s) => s.status === "skipped").length} skipped ·{" "}
            {(sends ?? []).filter((s) => s.status === "failed").length} failed
          </p>
        </Card>
      </section>

      <Card as="section" className="overflow-hidden">
        <header className="border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Sequences</h2>
        </header>
        {seqError ? (
          <div className="p-4">
            <LoadFailed what="your SMS sequences" detail={seqError.message} />
          </div>
        ) : (sequences ?? []).length === 0 ? (
          <EmptyState icon={MessageSquare} title="No SMS sequences yet" compact>
            Tick <span className="text-zinc-400">SMS sequence</span> when you build a campaign kit to
            generate the messages, then create a drip to send them.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-ink-700">
            {(sequences ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <Link href={`/broadcast/${s.id}`} className="min-w-0 flex-1 truncate text-sm text-zinc-100 hover:underline">
                  {s.name}
                </Link>
                <Badge
                  className={cn(
                    "border",
                    s.status === "active"
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-ink-600 bg-ink-800 text-zinc-400"
                  )}
                >
                  {s.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" className="overflow-hidden">
        <header className="border-b border-ink-700 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">Delivery log</h2>
        </header>
        {(sends ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-ink-700">
            {(sends ?? []).map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-xs text-zinc-400">{s.to_number}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-600">
                      {s.segments} segment{s.segments === 1 ? "" : "s"}
                    </span>
                    <Badge
                      className={cn(
                        "border",
                        s.status === "sent"
                          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                          : s.status === "skipped"
                            ? "border-ink-600 bg-ink-800 text-zinc-400"
                            : "border-red-500/30 bg-red-500/15 text-red-300"
                      )}
                    >
                      {s.status}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-zinc-300">{s.body}</p>
                {/* A skip is not a failure and its reason is the useful part — "opted out" and
                    "no consent on file" are different problems with different fixes. */}
                {s.error_message && <p className="mt-1 text-xs text-zinc-500">{s.error_message}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
