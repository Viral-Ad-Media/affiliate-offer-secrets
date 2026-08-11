import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSignedRequest } from "@/lib/meta/signedRequest";

export const dynamic = "force-dynamic";

/**
 * Meta's **Data Deletion Request Callback** — the second of the two server-to-server callbacks
 * Meta calls directly, and a requirement for App Review. Deauthorize (the other one) says "this
 * person revoked access"; this one says "this person wants their data gone", which is a stronger
 * ask and needs a real deletion, not a status flag.
 *
 * The protocol Meta expects: verify the signed_request, delete that Facebook user's data, and
 * respond with `{url, confirmation_code}` so the person can check the request afterwards.
 *
 * **What "their data" means here is a judgement, and it is this**: everything this app holds
 * *because* that Facebook account connected — the access tokens, the connection row, the Pages
 * and Instagram accounts discovered through it. Those are deleted outright, secrets included.
 *
 * The tenant's own publishing history (`meta_posts`/`instagram_posts`) is REDACTED, not deleted:
 * the Facebook identifiers in those rows are replaced with a sentinel while the row survives.
 * That row is an affiliate's record that they published something, on a date, with copy they
 * wrote — their data, not the Facebook user's — and this codebase already made exactly this call
 * for `erase_contact_email`, which redacts an address in the send logs rather than destroying the
 * audit trail. Same reasoning, same shape.
 *
 * **Every workspace, not one.** `meta_connections` is UNIQUE (workspace_id) — one Meta connection
 * per workspace — but nothing stops the SAME Facebook account being connected in several
 * workspaces, and this lookup is by `fb_user_id`. A deletion request covers all of them; scoping
 * to one would leave live tokens behind. Verified against the live constraint, not assumed from
 * the schema notes.
 */

const REDACTED = "redacted";

function statusUrl(code: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/data-deletion?code=${encodeURIComponent(code)}`;
}

export async function POST(req: Request) {
  const parsed = await readSignedRequest(req);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const fbUserId = parsed.fbUserId;

  const admin = createAdminClient();
  const confirmationCode = crypto.randomBytes(8).toString("hex");

  // Recorded BEFORE any deletion. If the process dies halfway the row survives saying so, which
  // is the difference between a request we can chase and one nobody knows happened.
  const { data: request, error: insertError } = await admin
    .from("meta_data_deletion_requests")
    .insert({ confirmation_code: confirmationCode, fb_user_id: fbUserId, status: "pending" })
    .select("id")
    .single();
  if (insertError || !request) {
    // No record means no honest status page, so this is the one branch that refuses the request
    // outright rather than claiming a deletion it can't stand behind.
    return NextResponse.json({ error: "could not record deletion request" }, { status: 500 });
  }

  const counts = {
    connections_deleted: 0,
    pages_deleted: 0,
    instagram_accounts_deleted: 0,
    secrets_deleted: 0,
    posts_redacted: 0,
  };

  try {
    const { data: connections } = await admin
      .from("meta_connections")
      .select("id, user_token_secret_id")
      .eq("fb_user_id", fbUserId);

    const connectionIds = (connections ?? []).map((c) => c.id as string);

    // Children are read before anything is deleted: their rows carry the Vault secret ids, and a
    // cascade would take the pointers with them and strand the secrets in the vault forever.
    const { data: pages } = connectionIds.length
      ? await admin
          .from("meta_pages")
          .select("id, page_id, page_token_secret_id")
          .in("connection_id", connectionIds)
      : { data: [] as { id: string; page_id: string; page_token_secret_id: string | null }[] };

    const { data: igAccounts } = connectionIds.length
      ? await admin.from("meta_instagram_accounts").select("id, ig_user_id").in("connection_id", connectionIds)
      : { data: [] as { id: string; ig_user_id: string }[] };

    const secretIds = [
      ...(connections ?? []).map((c) => c.user_token_secret_id as string | null),
      ...(pages ?? []).map((p) => p.page_token_secret_id as string | null),
    ].filter((id): id is string => typeof id === "string" && id.length > 0);

    // Secrets first, while the rows that point at them still exist.
    for (const secretId of secretIds) {
      const { error } = await admin.rpc("delete_oauth_secret", { p_secret_id: secretId });
      if (!error) counts.secrets_deleted++;
    }

    // Redact the Facebook identifiers out of the audit trail, keeping the rows. Matched on the
    // ids we are deleting rather than on the tenant, so one affiliate's other Pages are untouched.
    const pageIds = (pages ?? []).map((p) => p.page_id as string).filter(Boolean);
    if (pageIds.length) {
      const { data: redacted } = await admin
        .from("meta_posts")
        .update({ page_id: REDACTED, fb_post_id: REDACTED })
        .in("page_id", pageIds)
        .select("id");
      counts.posts_redacted += (redacted ?? []).length;
    }

    const igUserIds = (igAccounts ?? []).map((a) => a.ig_user_id as string).filter(Boolean);
    if (igUserIds.length) {
      const { data: redacted } = await admin
        .from("instagram_posts")
        .update({ ig_user_id: REDACTED, ig_media_id: REDACTED })
        .in("ig_user_id", igUserIds)
        .select("id");
      counts.posts_redacted += (redacted ?? []).length;
    }

    // Children explicitly before parents. The FKs cascade, but deleting them by hand is what
    // produces honest counts for the status page rather than a number we assume.
    if (connectionIds.length) {
      const { data: delIg } = await admin
        .from("meta_instagram_accounts")
        .delete()
        .in("connection_id", connectionIds)
        .select("id");
      counts.instagram_accounts_deleted = (delIg ?? []).length;

      const { data: delPages } = await admin
        .from("meta_pages")
        .delete()
        .in("connection_id", connectionIds)
        .select("id");
      counts.pages_deleted = (delPages ?? []).length;

      const { data: delConns } = await admin
        .from("meta_connections")
        .delete()
        .in("id", connectionIds)
        .select("id");
      counts.connections_deleted = (delConns ?? []).length;
    }

    await admin
      .from("meta_data_deletion_requests")
      .update({ ...counts, status: "completed", completed_at: new Date().toISOString() })
      .eq("id", request.id);
  } catch (err: any) {
    // Meta retries a non-2xx, and a retry cannot fix a half-finished deletion — it would just
    // mint a second confirmation code for the same person. So the failure is recorded, the code
    // is still returned, and the status page says plainly that it needs a human.
    await admin
      .from("meta_data_deletion_requests")
      .update({ ...counts, status: "failed", error: String(err?.message ?? err).slice(0, 500) })
      .eq("id", request.id);
    console.error("[meta data-deletion] failed", err);
  }

  return NextResponse.json({ url: statusUrl(confirmationCode), confirmation_code: confirmationCode });
}
