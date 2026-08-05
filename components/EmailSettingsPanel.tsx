"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import {
  renderSenderIdentityHtml,
  formatPostalAddress,
  MAX_EMAIL_SETTING_FIELD,
  MAX_FOOTER_NOTE,
  type EmailSettings,
} from "@/lib/emailSettings";

const FIELDS: { key: keyof EmailSettings; label: string; hint?: string; wide?: boolean }[] = [
  { key: "business_name", label: "Business name", hint: "Shown above the address in the footer", wide: true },
  { key: "address_line1", label: "Address", wide: true },
  { key: "address_line2", label: "Address line 2 (optional)", wide: true },
  { key: "city", label: "City" },
  { key: "region", label: "State / region" },
  { key: "postal_code", label: "Postal code" },
  { key: "country", label: "Country" },
];

export default function EmailSettingsPanel({ initial }: { initial: EmailSettings }) {
  const [form, setForm] = useState<EmailSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const set = (k: keyof EmailSettings, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const val = (k: keyof EmailSettings) => (form[k] as string | null | undefined) ?? "";

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/emails/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not save");
        return;
      }
      setSavedAt(Date.now());
      toast.success("Email settings saved");
    } catch {
      toast.error("Could not save");
    } finally {
      setBusy(false);
    }
  }

  const address = formatPostalAddress(form);
  // The same function the Broadcast worker calls, so this preview is the real footer rather than
  // a mock-up of it.
  const identityHtml = renderSenderIdentityHtml(form);

  const inputClass =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500";
  const labelClass = "mb-1 block text-xs text-zinc-400";

  return (
    <div className="space-y-6">
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Replies</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Where replies land. Leave this empty and replies go to your sending address — which is
            often a verified domain nobody reads.
          </p>
        </div>
        <label className="block max-w-md">
          <span className={labelClass}>Reply-to address</span>
          <input
            type="email"
            value={val("reply_to")}
            onChange={(e) => set("reply_to", e.target.value)}
            maxLength={MAX_EMAIL_SETTING_FIELD}
            placeholder="you@yourdomain.com"
            className={inputClass}
          />
        </label>
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-100">Business details</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Added to the footer of every broadcast. A real physical mailing address is required in
            commercial email by CAN-SPAM (US) and CASL (Canada) — the unsubscribe link is only half
            of it. A PO box or registered agent address is acceptable; a fake one is not.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className={f.wide ? "block sm:col-span-2" : "block"}>
              <span className={labelClass}>{f.label}</span>
              <input
                value={val(f.key)}
                onChange={(e) => set(f.key, e.target.value)}
                maxLength={MAX_EMAIL_SETTING_FIELD}
                className={inputClass}
              />
              {f.hint && <span className="mt-1 block text-[11px] text-zinc-600">{f.hint}</span>}
            </label>
          ))}
          <label className="block sm:col-span-2">
            <span className={labelClass}>Footer note (optional)</span>
            <input
              value={val("footer_note")}
              onChange={(e) => set("footer_note", e.target.value)}
              maxLength={MAX_FOOTER_NOTE}
              placeholder="You signed up at example.com"
              className={inputClass}
            />
          </label>
        </div>

        {!address && (
          <p className="text-xs text-amber-300">
            No mailing address set — broadcasts will send without one, which most jurisdictions
            treat as non-compliant for commercial email.
          </p>
        )}
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="text-sm font-semibold text-zinc-100">Footer preview</h2>
        <p className="text-xs text-zinc-500">
          Exactly what gets appended to every broadcast — rendered by the same function the sender
          uses, not a mock-up.
        </p>
        <div className="rounded-lg bg-white p-4 text-[#1a1a1a]">
          <div
            // Trusted: this is the tenant's own text, escaped by renderSenderIdentityHtml before
            // it ever becomes markup, and the same string is what the real email carries.
            dangerouslySetInnerHTML={{
              __html:
                `<hr style="margin:0 0 12px;border:none;border-top:1px solid #ddd;" />` +
                identityHtml +
                `<p style="font-size:12px;color:#888;margin:0;">You're receiving this because you opted in on one of our pages. <a href="#">Unsubscribe</a>.</p>`,
            }}
          />
        </div>
      </section>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="btn-primary text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </button>
        {savedAt && Date.now() - savedAt < 4000 && (
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
