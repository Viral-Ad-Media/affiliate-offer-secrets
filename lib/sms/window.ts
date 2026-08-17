// May we send RIGHT NOW? Quiet hours and throughput, evaluated before a message is dispatched.
//
// Separate from sendSmsToContact on purpose. That function answers "may we ever text this person"
// — a property of the CONTACT, whose answer is permanent and worth recording as a skipped send.
// This answers "may we text anyone this minute" — a property of the CLOCK, whose answer changes on
// its own and must produce a RETRY, not a skip. Conflating them would either burn a step's
// attempts waiting for 9am, or write a skip row for something that was only ever going to be true
// an hour later.

import type { SupabaseClient } from "@supabase/supabase-js";

export type SendWindow =
  | { ok: true }
  | { ok: false; reason: "quiet_hours" | "throughput" | "no_connection"; detail: string };

/**
 * The hour, 0-23, in a given IANA timezone.
 *
 * Intl rather than manual offset arithmetic: it handles DST, which is exactly the case a fixed
 * offset gets wrong twice a year — and getting it wrong means texting an hour outside the legal
 * window on the days either side of a transition. Falls back to UTC on an unusable zone rather
 * than throwing, since a bad stored timezone must not stop the whole sweep.
 */
export function hourInZone(date: Date, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(date);
    // "24" appears for midnight in some ICU versions.
    return Number(h) % 24;
  } catch {
    return date.getUTCHours();
  }
}

/**
 * Is `hour` inside [start, end)?
 *
 * Handles a window that wraps midnight (start 22, end 6) even though the default doesn't, because
 * nothing stops someone configuring one and a naive `start <= h && h < end` silently blocks every
 * hour of a wrapped window.
 */
export function withinWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return true; // degenerate: treated as "no restriction" rather than "never"
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export async function checkSendWindow(
  admin: SupabaseClient,
  workspaceId: string,
  now = new Date()
): Promise<SendWindow> {
  const { data: conn } = await admin
    .from("sms_connections")
    .select("quiet_hours_start, quiet_hours_end, quiet_hours_tz, messages_per_minute")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!conn) return { ok: false, reason: "no_connection", detail: "No SMS provider connected" };

  const hour = hourInZone(now, conn.quiet_hours_tz);
  if (!withinWindow(hour, conn.quiet_hours_start, conn.quiet_hours_end)) {
    return {
      ok: false,
      reason: "quiet_hours",
      detail: `Outside the sending window (${conn.quiet_hours_start}:00–${conn.quiet_hours_end}:00 ${conn.quiet_hours_tz}); it is ${hour}:00 there`,
    };
  }

  // Only messages actually handed to the provider count. A skip consumed no throughput and
  // counting it would throttle a workspace for refusing to text people, which is backwards.
  const since = new Date(now.getTime() - 60_000).toISOString();
  const { count } = await admin
    .from("sms_sends")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "sent")
    .gte("created_at", since);

  if ((count ?? 0) >= conn.messages_per_minute) {
    return {
      ok: false,
      reason: "throughput",
      detail: `${count} sent in the last minute, cap is ${conn.messages_per_minute}`,
    };
  }

  return { ok: true };
}
