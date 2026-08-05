"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// Where the "forgot password" email link lands. Necessarily a real page, not a modal — it is the
// target of a link in an email opened in whatever browser the person happens to be using.
//
// Supabase hands the recovery credential over in one of two shapes depending on the project's
// auth flow: a `?code=` query param (PKCE) or a `#access_token=…&type=recovery` fragment
// (implicit, which the browser client consumes itself via detectSessionInUrl). Both are handled,
// because which one arrives is a project setting rather than something this code controls, and
// guessing wrong would mean a reset link that silently does nothing.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<"checking" | "ok" | "invalid" | "wrong-browser">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const params = new URLSearchParams(window.location.search);

      // Preferred shape, and the only one that survives being opened in a DIFFERENT browser than
      // the one that asked for the reset — which is the normal case, not the edge case: a reset
      // link is opened from an email client, often on another device, often inside the mail app's
      // own in-app browser. verifyOtp carries the whole credential in the URL and needs nothing
      // from local storage.
      //
      // Requires the Supabase "Reset Password" email template to link to
      //   {{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery
      // rather than the default {{ .ConfirmationURL }}. With the default template this branch is
      // simply never taken and the two below still handle it.
      const tokenHash = params.get("token_hash");
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: (params.get("type") as EmailOtpType) ?? "recovery",
        });
        if (error) return setReady("invalid");
        return setReady("ok");
      }

      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          // PKCE stores a code_verifier in localStorage when the reset is REQUESTED; the exchange
          // fails without it. Supabase has already burned the token by this point, so retrying
          // this same link can never work — the person needs a fresh one, and telling them "the
          // link expired" sends them to check the clock instead of the browser.
          const missingVerifier = /verifier|code challenge|code_verifier/i.test(error.message);
          return setReady(missingVerifier ? "wrong-browser" : "invalid");
        }
        return setReady("ok");
      }
      // Implicit flow: the client picks the fragment up on construction, but that is async, so a
      // single immediate getSession() can race it. One short retry covers the gap without a
      // spinner that never resolves.
      const { data } = await supabase.auth.getSession();
      if (data.session) return setReady("ok");
      await new Promise((r) => setTimeout(r, 600));
      const retry = await supabase.auth.getSession();
      setReady(retry.data.session ? "ok" : "invalid");
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(true);
  }

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500";

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-zinc-100">
            Affiliate Offer <span className="text-emerald-400">Secrets</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-400">Choose a new password</p>
        </div>

        <div className="card p-5">
          {ready === "checking" && (
            <p className="flex items-center justify-center gap-2 text-sm text-zinc-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your link…
            </p>
          )}

          {ready === "invalid" && (
            <div className="space-y-3 text-center text-sm text-zinc-300">
              <p>This reset link is invalid or has expired.</p>
              <Link href="/login" className="block text-xs text-emerald-300 hover:underline">
                Request a new one
              </Link>
            </div>
          )}

          {ready === "wrong-browser" && (
            <div className="space-y-3 text-center text-sm text-zinc-300">
              <p>
                This link was opened in a different browser than the one that requested it, so it
                couldn&apos;t be verified.
              </p>
              <p className="text-xs text-zinc-400">
                Request a new link below, then open it in this same browser.
              </p>
              <Link href="/login" className="block text-xs text-emerald-300 hover:underline">
                Request a new one
              </Link>
            </div>
          )}

          {ready === "ok" && done && (
            <div className="space-y-3 text-center text-sm text-zinc-300">
              <p>Password updated. You&apos;re signed in.</p>
              <Button
                onClick={() => {
                  router.push("/dashboard");
                  router.refresh();
                }} className="w-full justify-center">
                Go to dashboard
              </Button>
            </div>
          )}

          {ready === "ok" && !done && (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">New password</label>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${field} pr-9`}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((v) => !v)}
                    tabIndex={-1}
                    aria-label={show ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center px-2.5 text-zinc-500 hover:text-zinc-300"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">
                  Confirm new password
                </label>
                <input
                  type={show ? "text" : "password"}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={field}
                />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full justify-center">
                {busy ? "Saving…" : "Update password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
