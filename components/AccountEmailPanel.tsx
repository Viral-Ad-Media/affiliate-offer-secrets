"use client";

import { useState } from "react";
import { AtSign, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isValidEmail } from "@/lib/validate";
import { Button } from "@/components/ui/button";

// Changing the address you sign in with. Supabase handles the confirmation round trip itself —
// updateUser({email}) doesn't change anything until the link is clicked, and with the project's
// "Secure email change" setting on it sends to BOTH the old and new address, which is what makes
// this safe against a hijacked session quietly moving the account somewhere else.
//
// The current password is required first anyway, same reasoning as the change-password form: the
// session alone is not proof of identity for an account-level change.
export default function AccountEmailPanel({ email }: { email: string }) {
  const [nextEmail, setNextEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changeEmail() {
    setMsg(null);
    const target = nextEmail.trim().toLowerCase();
    if (!isValidEmail(target)) {
      setMsg({ ok: false, text: "That doesn't look like an email address." });
      return;
    }
    if (target === email.toLowerCase()) {
      setMsg({ ok: false, text: "That's the address you already use." });
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password });
    if (reauthError) {
      setBusy(false);
      setMsg({ ok: false, text: "Password is incorrect." });
      return;
    }

    const { error } = await supabase.auth.updateUser({ email: target });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    setNextEmail("");
    setPassword("");
    setMsg({
      ok: true,
      text: `Confirmation sent. Your address stays ${email} until you click the link — check both inboxes.`,
    });
  }

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500";

  return (
    <section className="card space-y-3 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <AtSign className="h-4 w-4 text-emerald-400" /> Sign-in email
      </div>
      <p className="text-xs text-zinc-500">
        Currently <span className="text-zinc-300">{email}</span>. Changing it needs confirmation by
        email — nothing changes until you click the link.
      </p>

      <input
        type="email"
        value={nextEmail}
        onChange={(e) => setNextEmail(e.target.value)}
        placeholder="New email address"
        autoComplete="email"
        className={field}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Current password"
        autoComplete="current-password"
        className={field}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={changeEmail}
          disabled={busy || !nextEmail.trim() || !password} className="disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AtSign className="h-4 w-4" />}
          Send confirmation
        </Button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</span>
        )}
      </div>
    </section>
  );
}
