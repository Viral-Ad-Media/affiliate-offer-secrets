"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Loader2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Intl.supportedValuesOf is available in every browser this app targets; the fallback keeps the
// form usable rather than empty if it isn't. The server re-validates against pg_timezone_names
// regardless, so this list is convenience, not the boundary.
function timezones(): string[] {
  try {
    return (Intl as any).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export default function ProfileSettings({
  email,
  fullName,
  timezone,
  memberSince,
}: {
  email: string;
  fullName: string | null;
  timezone: string | null;
  memberSince: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(fullName ?? "");
  const [tz, setTz] = useState(timezone ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zones = timezones();

  async function save() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("update_profile", {
      p_full_name: name,
      p_timezone: tz,
    });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Profile saved." });
    if (!error) router.refresh();
  }

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <User className="h-4 w-4 text-emerald-400" /> Profile
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Your name"
          className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">Timezone</span>
        {zones.length > 0 ? (
          <select
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          >
            <option value="">Not set</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="e.g. Europe/London"
            className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500"
          />
        )}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-400">Email</span>
          <div className="rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2 text-sm text-zinc-400">
            {email}
          </div>
          {/* Changing the sign-in email needs a confirmation round trip to both the old and new
              address — a real flow, not a text field. Deliberately out of scope here rather than
              half-built. */}
          <span className="mt-1 block text-[11px] text-zinc-600">
            Email changes aren&apos;t supported yet.
          </span>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-400">Member since</span>
          <div className="rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2 text-sm text-zinc-400">
            {new Date(memberSince).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="btn-primary disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save profile
        </button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
