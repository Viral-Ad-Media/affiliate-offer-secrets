"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// The one irreversible action in the app. Three gates, deliberately: expand the panel, type your
// own email address, and enter your password — the password alone is muscle memory, and this
// removes every campaign, funnel, contact and connection the account owns.
//
// The server re-checks all of it (app/api/account/delete/route.ts); none of this is the boundary.
export default function DeleteAccountPanel({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm_email: confirmEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not delete the account");
      // Straight out — there's no account left to render a dashboard for.
      router.push("/");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-red-500";

  return (
    <section className="card space-y-3 border-red-500/30 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <TriangleAlert className="h-4 w-4 text-red-300" /> Delete account
      </div>
      <p className="text-xs text-zinc-500">
        Permanently removes your account and everything in it — products, campaigns, funnels,
        contacts, blog posts, email sequences and connected accounts. Published funnel and blog
        pages stop resolving. This cannot be undone, and your access fee isn&apos;t refunded
        automatically.
      </p>

      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-sm text-zinc-300 hover:border-red-500 hover:text-red-300"
        >
          <TriangleAlert className="h-4 w-4" /> I want to delete my account
        </button>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">
              Type <span className="text-zinc-200">{email}</span> to confirm
            </span>
            <input
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={email}
              autoComplete="off"
              className={field}
            />
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className={field}
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={deleteAccount}
              disabled={
                busy || !password || confirmEmail.trim().toLowerCase() !== email.toLowerCase()
              }
              className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TriangleAlert className="h-4 w-4" />}
              Delete my account permanently
            </button>
            <Button
              onClick={() => {
                setOpen(false);
                setConfirmEmail("");
                setPassword("");
                setError(null);
              }}
              disabled={busy} variant="outline" className="text-sm">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
