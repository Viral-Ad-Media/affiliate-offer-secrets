"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Loader2, LogOut, KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const MIN_PASSWORD = 8;

export default function SecuritySettings({ email }: { email: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword() {
    setMsg(null);
    if (next.length < MIN_PASSWORD) {
      setMsg({ ok: false, text: `Use at least ${MIN_PASSWORD} characters.` });
      return;
    }
    if (next !== confirm) {
      setMsg({ ok: false, text: "The two new passwords don't match." });
      return;
    }
    if (next === current) {
      setMsg({ ok: false, text: "That's the password you already have." });
      return;
    }

    setBusy(true);
    const supabase = createClient();

    // Re-authenticate before changing. supabase.auth.updateUser() does NOT verify the current
    // password — it trusts the session — so without this step anyone with a hijacked session (a
    // borrowed laptop, a stolen token) could silently lock the real owner out by resetting the
    // password. Requiring the current password makes that materially harder and matches what
    // users expect from a change-password form.
    const { error: reauthError } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (reauthError) {
      setBusy(false);
      setMsg({ ok: false, text: "Current password is incorrect." });
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setMsg({ ok: true, text: "Password updated." });
  }

  async function signOutEverywhere() {
    if (
      !window.confirm(
        "Sign out of every device, including this one? You'll need to sign in again."
      )
    ) {
      return;
    }
    setSigningOut(true);
    // scope: "global" revokes every refresh token for this account, not just this browser's.
    await createClient().auth.signOut({ scope: "global" });
    router.push("/login");
    router.refresh();
  }

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500";

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <ShieldCheck className="h-4 w-4 text-emerald-400" /> Security
      </div>

      <div className="space-y-3">
        <span className="block text-xs font-medium text-zinc-400">Change password</span>
        {/* autoComplete hints let password managers do the right thing instead of saving the
            current password as the new one. */}
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          className={field}
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder={`New password (min ${MIN_PASSWORD} characters)`}
          autoComplete="new-password"
          className={field}
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          className={field}
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={changePassword}
            disabled={busy || !current || !next || !confirm} className="disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Update password
          </Button>
          {msg && (
            <span className={`text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-ink-700 pt-4">
        <span className="block text-xs font-medium text-zinc-400">Active sessions</span>
        <p className="mt-1 text-xs text-zinc-500">
          Signs you out on every device where you&apos;re logged in. Use this if you&apos;ve signed
          in somewhere you no longer control.
        </p>
        <button
          onClick={signOutEverywhere}
          disabled={signingOut}
          className="mt-3 flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-sm text-zinc-300 hover:border-red-500 hover:text-red-300 disabled:opacity-50"
        >
          {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Sign out everywhere
        </button>
      </div>
    </section>
  );
}
