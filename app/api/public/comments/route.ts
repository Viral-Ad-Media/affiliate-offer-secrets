import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail } from "@/lib/validate";

export const dynamic = "force-dynamic";

// Mirrors /api/public/leads' caps: per-POST, not per-IP, because a valid post UUID is already
// this app's entire public access-control model. Silently dropped with the same redirect as a
// success — a capped comment must be invisible to a real reader, and only blocks likely spam.
const BURST_LIMIT = 10; // per post per 10 minutes
const DAILY_LIMIT = 100; // per post per 24h

/**
 * The blog's comment box — the app's second anonymous public write, after /api/public/leads.
 *
 * ZERO-JS BY DESIGN: blog posts ship no JavaScript (the property the carousel is CSS-only to
 * protect), so this is a plain HTML <form method="POST"> target that answers with a 303 back to
 * the post. Everything the leads route learned applies:
 *
 *  - `workspace_id` comes only from the POST row — there is no tenant field in the form and there
 *    must never be one.
 *  - An unknown/unpublished post redirects to the blog root rather than describing itself; the
 *    honeypot, the caps, and validation failures all answer the SAME redirect a success does. An
 *    anonymous caller can learn nothing from the response about why nothing happened.
 *  - EVERY stored comment is `pending`. Nothing here can put words on a public page.
 *
 * The redirect target is rebuilt from the request's own Referer ONLY when it is same-origin;
 * anything else falls back to the canonical /b path. The form deliberately carries no redirect
 * field — a caller-supplied destination is an open redirect.
 */
function withCommented(path: string): string {
  // Only ever a path we built or a same-origin referer path — append the flag the GET route reads
  // to show "awaiting review". Dropped from canonical URLs by the router (it is a query param on a
  // page whose canonical tag carries none).
  return path.includes("?") ? `${path}&commented=1` : `${path}?commented=1`;
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const postId = String(form?.get("post_id") ?? "");
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const admin = createAdminClient();

  // Same-origin Referer or bust. Path + hash only — never an absolute URL from the caller.
  const back = (fallbackPath: string): Response => {
    let location = fallbackPath;
    try {
      const ref = new URL(req.headers.get("referer") ?? "");
      const self = new URL(req.url);
      if (ref.host === (req.headers.get("host") ?? self.host)) {
        location = ref.pathname + ref.search;
      }
    } catch {
      // no/invalid referer — the canonical fallback stands
    }
    return new Response(null, {
      status: 303,
      headers: { Location: `${withCommented(location.split("#")[0])}#comments` },
    });
  };

  if (!form || !UUID_RE.test(postId)) return back("/");

  const { data: post } = await admin
    .from("blog_posts")
    .select("id, workspace_id, slug")
    .eq("id", postId)
    .eq("status", "published")
    .maybeSingle();
  // Generic even here: an invalid post gets the same redirect shape as everything else.
  if (!post) return back("/");

  const { data: settings } = await admin
    .from("blog_settings")
    .select("slug, comments_enabled, ratings_enabled")
    .eq("workspace_id", post.workspace_id as string)
    .maybeSingle();
  const fallback = settings?.slug ? `/b/${settings.slug}` : "/";
  if (!settings?.comments_enabled) return back(fallback);

  // Honeypot: a visually-hidden "website" field no person fills in. The classic zero-JS spam
  // filter, and the drop is indistinguishable from success on purpose.
  if (String(form.get("website") ?? "").trim() !== "") return back(fallback);

  const name = String(form.get("author_name") ?? "").trim().slice(0, 80);
  const emailRaw = String(form.get("author_email") ?? "").trim().toLowerCase();
  const body = String(form.get("body") ?? "").trim().slice(0, 2000);
  const ratingRaw = Number(form.get("rating"));
  const rating =
    settings.ratings_enabled && Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
      ? ratingRaw
      : null;

  if (!name || body.length < 2) return back(fallback);
  const email = emailRaw && isValidEmail(emailRaw) ? emailRaw : null;

  // Rate caps, checked cheapest-first. Exceeded → the same redirect as success.
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const { count: burst } = await admin
    .from("blog_comments")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId)
    .gte("created_at", since(10 * 60_000));
  if ((burst ?? 0) >= BURST_LIMIT) return back(fallback);
  const { count: daily } = await admin
    .from("blog_comments")
    .select("id", { count: "exact", head: true })
    .eq("post_id", postId)
    .gte("created_at", since(24 * 3600_000));
  if ((daily ?? 0) >= DAILY_LIMIT) return back(fallback);

  await admin.from("blog_comments").insert({
    workspace_id: post.workspace_id,
    post_id: postId,
    author_name: name,
    author_email: email,
    body,
    rating,
    // Explicit even though it is the default: this line is the moderation-first guarantee, and it
    // should survive someone changing the column default without reading this route.
    status: "pending",
  });

  return back(fallback);
}
