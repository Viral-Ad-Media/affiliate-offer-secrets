import { NextResponse } from "next/server";
import { currentWorkspaceId } from "@/lib/workspace";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Import contacts from pasted CSV. Complements the bridge-page capture path (which is anonymous
// and rate-capped): this one is the tenant bringing a list they already own.
//
// Deliberately NOT reusing /api/public/leads — that route's whole shape is built around an
// untrusted anonymous caller, and adding an authenticated bulk path to it would widen the surface
// of the one endpoint in this app that strangers can reach.

const MAX_ROWS = 5000;
const MAX_NAME = 120;

// Minimal RFC4180-ish parser: handles quoted fields containing commas, quotes and newlines. Rolled
// rather than pulled in — a dependency for one function that has to be read for correctness anyway
// is a poor trade.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Swallow \r\n as one break.
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// Finds the email and first-name columns by header name, falling back to "first column that looks
// like an email" so a headerless paste still works.
function pickColumns(rows: string[][]): { emailIdx: number; nameIdx: number; skipHeader: boolean } {
  const first = rows[0] ?? [];
  const lower = first.map((h) => h.trim().toLowerCase());
  const emailHeader = lower.findIndex((h) => h === "email" || h.includes("email"));
  const nameHeader = lower.findIndex(
    (h) => h === "first name" || h === "first_name" || h === "name" || h === "firstname"
  );
  if (emailHeader !== -1) return { emailIdx: emailHeader, nameIdx: nameHeader, skipHeader: true };

  const guess = first.findIndex((f) => isValidEmail(f.trim()));
  return { emailIdx: guess === -1 ? 0 : guess, nameIdx: -1, skipHeader: false };
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const ws = await currentWorkspaceId();

  const body = await req.json().catch(() => ({}));
  const csv = typeof body.csv === "string" ? body.csv : "";
  const tagId = typeof body.tag_id === "string" && body.tag_id ? body.tag_id : null;
  const campaignId = typeof body.campaign_id === "string" && body.campaign_id ? body.campaign_id : null;
  if (!csv.trim()) return NextResponse.json({ error: "Paste some CSV first" }, { status: 400 });

  const rows = parseCsv(csv);
  if (rows.length === 0) return NextResponse.json({ error: "No rows found" }, { status: 400 });
  const { emailIdx, nameIdx, skipHeader } = pickColumns(rows);
  const dataRows = (skipHeader ? rows.slice(1) : rows).slice(0, MAX_ROWS);

  const admin = createAdminClient();

  // Ownership checks before anything is written: a tag or campaign id from the body must belong to
  // this tenant, or the import would attach their leads to someone else's row.
  if (tagId) {
    const { data: tag } = await admin
      .from("contact_tags")
      .select("id")
      .eq("id", tagId)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (!tag) return NextResponse.json({ error: "tag not found" }, { status: 404 });
  }
  if (campaignId) {
    const { data: campaign } = await admin
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("workspace_id", ws)
      .maybeSingle();
    if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  }

  const seen = new Set<string>();
  const toInsert: { user_id: string; campaign_id: string | null; first_name: string | null; email: string }[] = [];
  let invalid = 0;

  for (const r of dataRows) {
    const email = (r[emailIdx] ?? "").trim().toLowerCase();
    if (!isValidEmail(email)) {
      invalid++;
      continue;
    }
    // Dedupe within the file itself; the DB index handles collisions against what's already there.
    if (seen.has(email)) continue;
    seen.add(email);
    const first_name = nameIdx >= 0 ? (r[nameIdx] ?? "").trim().slice(0, MAX_NAME) || null : null;
    toInsert.push({ user_id: user.id, campaign_id: campaignId, first_name, email });
  }

  if (toInsert.length === 0) {
    return NextResponse.json(
      { error: invalid > 0 ? "No valid email addresses found" : "Nothing to import" },
      { status: 400 }
    );
  }

  // The partial unique index on (campaign_id, lower(email)) only covers rows WITH a campaign, so
  // an unattached import can't rely on it — existing emails are filtered out explicitly instead.
  const { data: existing } = await admin
    .from("contacts")
    .select("id, email")
    .eq("workspace_id", ws)
    .in("email", toInsert.map((c) => c.email));
  const existingByEmail = new Map((existing ?? []).map((e) => [(e.email as string).toLowerCase(), e.id as string]));

  const fresh = toInsert.filter((c) => !existingByEmail.has(c.email));
  let insertedIds: string[] = [];
  if (fresh.length > 0) {
    const { data: inserted, error } = await admin.from("contacts").insert(fresh).select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    insertedIds = (inserted ?? []).map((r) => r.id as string);
  }

  // Tagging covers duplicates too: re-importing a list to tag an existing segment is a normal
  // thing to want, and silently skipping those would make the tag look broken.
  let tagged = 0;
  if (tagId) {
    const allIds = [...insertedIds, ...toInsert.map((c) => existingByEmail.get(c.email)).filter(Boolean as unknown as (v: string | undefined) => v is string)];
    if (allIds.length > 0) {
      const links = allIds.map((contact_id) => ({ contact_id, tag_id: tagId, user_id: user.id }));
      const { error: linkErr } = await admin
        .from("contact_tag_links")
        .upsert(links, { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
      if (!linkErr) tagged = allIds.length;
    }
  }

  return NextResponse.json({
    ok: true,
    imported: insertedIds.length,
    duplicates: toInsert.length - fresh.length,
    invalid,
    tagged,
  });
}
