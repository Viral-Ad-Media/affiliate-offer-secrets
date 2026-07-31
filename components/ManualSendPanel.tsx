"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Mail, Users } from "lucide-react";

export type ManualContact = {
  id: string;
  email: string;
  first_name: string | null;
  // Carried so the composer can narrow the list to the chosen campaign's contacts, matching what
  // the automatic send would target.
  campaign_id: string | null;
};

// Manual sending — the zero-setup path, modelled on visibility-studio's EmailQueue.
//
// Nothing here touches the server: the composed subject/body are turned into a mailto: link (or
// copied to the clipboard) and the user's own mail client does the send. That means it works with
// no provider connected, no API key, and no deliverability setup — the trade-off is no unsubscribe
// footer, no broadcast_sends audit row, and no delivery tracking, which is why it stays clearly
// separated from "Send now" rather than dressed up as the same action.
//
// mailto: has a practical URL-length ceiling (browsers/clients vary, ~2000 chars is the safe
// floor), so long bodies get a "copy instead" hint rather than silently producing a truncated
// draft — a real failure mode of naive mailto builders.
const MAILTO_SAFE_CHARS = 1800;

function mailtoHref(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

function personalize(text: string, c: ManualContact): string {
  // Same {{first_name}} token the sequence steps use, so a draft written once reads correctly
  // whether it's sent automatically or by hand.
  return text.replace(/\{\{\s*first_name\s*\}\}/g, c.first_name?.trim() || "there");
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export default function ManualSendPanel({
  contacts,
  subject,
  body,
}: {
  contacts: ManualContact[];
  subject: string;
  body: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === contacts.length ? new Set() : new Set(contacts.map((c) => c.id))
    );
  }

  const selectedContacts = useMemo(
    () => contacts.filter((c) => selected.has(c.id)),
    [contacts, selected]
  );

  // One block per recipient, personalized — paste-ready for a mail client that can't take a
  // mailto:, and the only sane option once the list is longer than a handful.
  const combined = useMemo(
    () =>
      selectedContacts
        .map(
          (c) =>
            `To: ${c.email}\nSubject: ${personalize(subject, c)}\n\n${personalize(body, c)}`
        )
        .join("\n\n" + "-".repeat(48) + "\n\n"),
    [selectedContacts, subject, body]
  );

  const ready = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Mail className="h-4 w-4 text-emerald-400" /> Send manually
      </div>
      <p className="text-xs text-zinc-500">
        Opens the draft in your own mail client, or copies it to paste anywhere. Works with no
        provider connected — but there&apos;s no unsubscribe footer and nothing is logged, so use
        the automatic send for real broadcasts once a provider is set up.
      </p>

      {!ready ? (
        <p className="text-xs text-zinc-500">Write a subject and message above to enable this.</p>
      ) : contacts.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No contacts yet — they arrive from your funnels&apos; opt-in forms.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === contacts.length}
                onChange={toggleAll}
                className="h-4 w-4 rounded border-ink-600 bg-ink-800"
              />
              Select all {contacts.length}
            </label>
            {selected.size > 0 && (
              <>
                <span className="flex items-center gap-1 text-xs text-emerald-300">
                  <Users className="h-3.5 w-3.5" /> {selected.size} selected
                </span>
                <CopyButton text={combined} label={`Copy all ${selected.size}`} />
              </>
            )}
          </div>

          <div className="max-h-80 divide-y divide-ink-700 overflow-y-auto rounded-lg border border-ink-700">
            {contacts.map((c) => {
              const subj = personalize(subject, c);
              const text = personalize(body, c);
              const href = mailtoHref(c.email, subj, text);
              const tooLong = href.length > MAILTO_SAFE_CHARS;
              return (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="h-4 w-4 shrink-0 rounded border-ink-600 bg-ink-800"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-200">{c.email}</div>
                    {c.first_name && (
                      <div className="truncate text-xs text-zinc-500">{c.first_name}</div>
                    )}
                  </div>
                  {tooLong ? (
                    <span
                      className="shrink-0 text-xs text-zinc-500"
                      title="This draft is too long for a mailto: link — copy it instead."
                    >
                      too long to open
                    </span>
                  ) : (
                    <a
                      href={href}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-600 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-emerald-500 hover:text-emerald-300"
                    >
                      <Mail className="h-3.5 w-3.5" /> Open in mail
                    </a>
                  )}
                  <CopyButton text={`To: ${c.email}\nSubject: ${subj}\n\n${text}`} label="Copy" />
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
