"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { REMEMBER_COOKIE } from "@/lib/supabase/cookieOptions";
import { Button } from "@/components/ui/button";

// One implementation of sign-in / sign-up / forgot-password, rendered both as the /login page and
// inside the marketing site's popup. /login has to keep existing as a real page whatever the popup
// does — ~15 server-side `redirect("/login")` calls target it and the auth gate in middleware
// redirects there — so this is shared rather than replaced.
export type AuthMode = "login" | "signup" | "forgot";

const field =
  "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500";

export default function AuthForm({
  initialMode = "login",
  onSuccess,
}: {
  initialMode?: AuthMode;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const signup = mode === "signup";
  const forgot = mode === "forgot";

  function switchTo(next: AuthMode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setConfirm("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();

    if (forgot) {
      setBusy(true);
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setBusy(false);
      // Deliberately the same message whether or not that address has an account. Supabase's own
      // response doesn't distinguish either, and saying "no such account" would turn this form
      // into a way to test which email addresses are registered.
      setNotice(`If an account exists for ${email}, a reset link is on its way.`);
      return;
    }

    if (signup) {
      // Checked here and only here: the confirm value never leaves the browser and has no
      // server-side meaning — the account is created from `password` either way. The point is
      // catching a typo before it becomes an account nobody can sign into.
      if (password !== confirm) return setError("Passwords don't match.");

      setBusy(true);
      // Name and phone travel as auth metadata, NOT a client write: profiles has been SELECT-only
      // for clients since 0002_trial.sql (a general update policy let users self-grant
      // access_granted). handle_new_user copies exactly these three keys server-side.
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { first_name: firstName, last_name: lastName, phone } },
      });
      setBusy(false);
      if (error) return setError(error.message);
      setNotice(`Check ${email} for a confirmation link, then come back and sign in.`);
      return;
    }

    // Written BEFORE signing in, so the cookie is already present when middleware processes the
    // auth cookies this request sets. Itself a session cookie: if the browser closes, the
    // preference dies alongside the session it applies to.
    document.cookie = `${REMEMBER_COOKIE}=${remember ? "1" : "0"}; Path=/; SameSite=Lax${
      window.location.protocol === "https:" ? "; Secure" : ""
    }`;

    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setError(error.message);
    onSuccess?.();
    router.push("/dashboard");
    router.refresh();
  }

  if (notice) {
    return (
      <div className="space-y-3 text-center text-sm text-zinc-300">
        <p>{notice}</p>
        <button
          type="button"
          onClick={() => {
            setNotice(null);
            setMode("login");
          }}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {signup && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">First name</label>
              <input
                required
                autoComplete="given-name"
                maxLength={60}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={field}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Last name</label>
              <input
                required
                autoComplete="family-name"
                maxLength={60}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={field}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Phone</label>
            <input
              type="tel"
              required
              autoComplete="tel"
              maxLength={32}
              placeholder="+1 (555) 010-9999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={`${field} placeholder:text-zinc-600`}
            />
          </div>
        </>
      )}

      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={field}
        />
      </div>

      {!forgot && (
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              autoComplete={signup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${field} pr-9`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex items-center px-2.5 text-zinc-500 hover:text-zinc-300"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {signup && (
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Confirm password</label>
          {/* Shares the reveal toggle above rather than carrying its own — revealing one field
              while the other stays masked is what makes a mismatch hard to spot. */}
          <input
            type={showPassword ? "text" : "password"}
            required
            minLength={6}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={field}
          />
          {confirm.length > 0 && confirm !== password && (
            <p className="mt-1 text-xs text-amber-300/80">Passwords don&apos;t match yet.</p>
          )}
        </div>
      )}

      {mode === "login" && (
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-900 accent-emerald-500"
            />
            Remember me
          </label>
          <button
            type="button"
            onClick={() => switchTo("forgot")}
            className="text-xs text-zinc-500 hover:text-emerald-300"
          >
            Forgot password?
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Button type="submit" disabled={busy} className="w-full justify-center">
        {busy ? "Please wait…" : forgot ? "Send reset link" : signup ? "Sign up" : "Sign in"}
      </Button>

      <button
        type="button"
        onClick={() => switchTo(signup || forgot ? "login" : "signup")}
        className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
      >
        {signup
          ? "Already have an account? Sign in"
          : forgot
            ? "Back to sign in"
            : "Don't have an account? Sign up"}
      </button>
    </form>
  );
}
