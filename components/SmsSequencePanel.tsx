"use client";

import { useState } from "react";
import { Copy, CheckCircle2, MessageSquare, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { composeSms, smsSegments, SMS_OPT_OUT, MAX_SMS_BODY } from "@/lib/sms";

/**
 * The kit's SMS sequence, shown as it would actually send.
 *
 * Each message is rendered through composeSms() — the same function any future sending path must
 * use — so the opt-out line is visible in the preview rather than being a surprise appended later.
 * Same "what you see is what publishes" guarantee the page editor gets from calling the real
 * renderBridgeHtml.
 *
 * Segment count is shown per message because SMS bills per segment: 161 characters costs double
 * 160, and that is invisible unless something says so.
 */
export default function SmsSequencePanel({ messages }: { messages: { body: string }[] | null }) {
  const [copied, setCopied] = useState<number | null>(null);

  if (!messages?.length) {
    return (
      <Card className="p-6 text-center">
        <MessageSquare className="mx-auto h-6 w-6 text-zinc-600" />
        <p className="mt-2 text-sm text-zinc-400">No SMS sequence in this kit</p>
        <p className="mt-1 text-xs text-zinc-600">
          Tick <span className="text-zinc-400">SMS sequence</span> when you build or regenerate a kit.
        </p>
      </Card>
    );
  }

  async function copy(text: string, i: number) {
    await navigator.clipboard.writeText(text);
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
        Only text people who explicitly opted in to messages — SMS consent is separate from email
        consent, and a lead who ticked your opt-in form has not necessarily given it.{" "}
        <span className="text-amber-300/80">
          &ldquo;{SMS_OPT_OUT}&rdquo; is added to the first message automatically and can&apos;t be edited out.
        </span>
      </p>

      <ul className="space-y-2">
        {messages.map((m, i) => {
          const full = composeSms(m.body, i);
          const { segments, chars, hasUnicode } = smsSegments(full);
          return (
            <li key={i} className="rounded-xl border border-ink-700 bg-ink-900 p-3">
              <div className="flex items-center justify-between gap-2">
                <Badge className="border-ink-600 bg-ink-800 text-zinc-400">Message {i + 1}</Badge>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[11px] tabular-nums",
                      segments > 1 ? "text-amber-300" : "text-zinc-600"
                    )}
                    title={
                      segments > 1
                        ? "Over one segment — this message bills as multiple texts"
                        : "Fits in a single segment"
                    }
                  >
                    {chars}/{MAX_SMS_BODY + SMS_OPT_OUT.length + 1} · {segments} segment
                    {segments === 1 ? "" : "s"}
                  </span>
                  <Button onClick={() => copy(full, i)} variant="outline" className="!px-2" title="Copy message">
                    {copied === i ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>

              {/* The composed text, not the stored body — including our opt-out on the first one. */}
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-200">{full}</p>

              {hasUnicode && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/90">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  Contains an emoji or a curly quote, which switches the whole message to unicode
                  encoding and cuts the per-segment limit to 70 characters.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
