"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Loader2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AvatarPicker, { initialsOf } from "@/components/AvatarPicker";
import { Button } from "@/components/ui/button";

// Intl.supportedValuesOf exists in every browser this app targets; the fallback keeps the form
// usable rather than empty if it doesn't. The server re-validates against pg_timezone_names, so
// this list is convenience, not the boundary.
function timezones(): string[] {
  try {
    return (Intl as any).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
}

export default function ProfileSettings({
  email,
  firstName,
  lastName,
  phone: initialPhone,
  timezone,
  avatarUrl,
  memberSince,
}: {
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  timezone: string | null;
  avatarUrl: string | null;
  memberSince: string;
}) {
  const router = useRouter();
  const [first, setFirst] = useState(firstName ?? "");
  const [last, setLast] = useState(lastName ?? "");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [tz, setTz] = useState(timezone ?? "");
  // null = "no avatar right now". Distinguishing "cleared" from "unchanged" matters: the RPC
  // leaves the stored avatar alone unless told otherwise, so saving the form without touching the
  // photo must not wipe it.
  const [avatar, setAvatar] = useState<string | null>(avatarUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zones = timezones();

  const avatarChanged = avatar !== avatarUrl;

  async function save() {
    setBusy(true);
    setMsg(null);
    const { error } = await createClient().rpc("update_profile", {
      p_first_name: first,
      p_last_name: last,
      p_timezone: tz,
      p_phone: phone,
      p_avatar_url: avatarChanged ? avatar : null,
      p_clear_avatar: avatarChanged && avatar === null,
    });
    setBusy(false);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: "Profile saved." });
    if (!error) router.refresh();
  }

  const field =
    "w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500";

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <User className="h-4 w-4 text-emerald-400" /> Profile
      </div>

      <AvatarPicker
        value={avatar}
        initials={initialsOf(first || firstName, last || lastName, email)}
        onChange={setAvatar}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">First name</span>
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            maxLength={60}
            placeholder="First name"
            className={field}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Last name</span>
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            maxLength={60}
            placeholder="Last name"
            className={field}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">Phone</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          maxLength={32}
          placeholder="+1 (555) 010-9999"
          className={field}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-400">Timezone</span>
        {zones.length > 0 ? (
          <select value={tz} onChange={(e) => setTz(e.target.value)} className={field}>
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
            className={field}
          />
        )}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Email</span>
          {/* truncate + title: a long address otherwise overflows the grid cell and collides with
              the adjacent column rather than clipping. */}
          <div
            className="truncate rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2 text-sm text-zinc-400"
            title={email}
          >
            {email}
          </div>
          <span className="mt-1 block text-[12px] text-zinc-600">
            Email changes aren&apos;t supported yet.
          </span>
        </div>
        <div className="min-w-0">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Member since</span>
          <div className="rounded-lg border border-ink-700 bg-ink-800/50 px-3 py-2 text-sm text-zinc-400">
            {new Date(memberSince).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy} className="disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Save profile
        </Button>
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </section>
  );
}
