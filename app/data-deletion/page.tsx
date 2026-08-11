import Link from "next/link";
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { SUPPORT_EMAIL } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Data deletion request",
  // Nobody should reach this from search — it is only ever opened from the link Facebook shows
  // the person who asked, and each URL is about one individual's request.
  robots: { index: false, follow: false },
};

/**
 * The status URL returned by the Meta Data Deletion Request Callback.
 *
 * Standalone, outside both route groups, for the same reason `/login` is: it must render for
 * somebody with no account here at all — the person asking is a Facebook user, not necessarily a
 * tenant. Reads on the admin client because there is no session to scope by; the unguessable
 * confirmation code is the whole access control, exactly as the unsubscribe link's token is.
 *
 * **It deliberately shows almost nothing.** A code, a state, a date. No Facebook user id, no
 * tenant email, no Page names — the page exists to confirm a deletion, and printing the deleted
 * identifiers back at whoever holds the URL would undo part of the point.
 */
export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: { code?: string };
}) {
  const code = typeof searchParams.code === "string" ? searchParams.code.trim() : "";

  const admin = createAdminClient();
  const { data: request } = code
    ? await admin
        .from("meta_data_deletion_requests")
        .select("status, created_at, completed_at")
        .eq("confirmation_code", code)
        .maybeSingle()
    : { data: null };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-bold text-zinc-100">Data deletion request</h1>

      {!code && (
        <p className="mt-3 text-sm text-zinc-400">
          Open this page using the link Facebook gave you — it carries the confirmation code for
          your request.
        </p>
      )}

      {code && !request && (
        <>
          <p className="mt-3 text-sm text-zinc-400">
            We have no request matching that confirmation code. Check the link from Facebook is
            complete, or contact us and we&apos;ll look it up.
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
              {SUPPORT_EMAIL}
            </a>
          </p>
        </>
      )}

      {request && (
        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {request.status === "completed" && (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-emerald-300">Completed</span>
              </>
            )}
            {request.status === "pending" && (
              <>
                <Clock className="h-4 w-4 text-amber-400" />
                <span className="text-amber-300">In progress</span>
              </>
            )}
            {request.status === "failed" && (
              <>
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <span className="text-red-300">Needs attention</span>
              </>
            )}
          </div>

          <p className="mt-3 text-sm text-zinc-400">
            {request.status === "completed" &&
              "Your Facebook connection and the access tokens, Pages and Instagram accounts it gave us have been deleted."}
            {request.status === "pending" &&
              "We received your request and are working through it. Refresh this page shortly."}
            {request.status === "failed" &&
              "We received your request but hit a problem completing it. Email us with the confirmation code below and we'll finish it by hand."}
          </p>

          <dl className="mt-4 space-y-1.5 text-xs text-zinc-500">
            <div className="flex justify-between gap-4">
              <dt>Confirmation code</dt>
              <dd className="font-mono text-zinc-300">{code}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Requested</dt>
              <dd>{new Date(request.created_at as string).toISOString().slice(0, 10)}</dd>
            </div>
            {request.completed_at && (
              <div className="flex justify-between gap-4">
                <dt>Completed</dt>
                <dd>{new Date(request.completed_at as string).toISOString().slice(0, 10)}</dd>
              </div>
            )}
          </dl>

          {request.status === "failed" && (
            <p className="mt-3 text-xs text-zinc-500">
              <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">
                {SUPPORT_EMAIL}
              </a>
            </p>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-zinc-600">
        <Link href="/privacy" className="underline">
          Privacy policy
        </Link>
      </p>
    </main>
  );
}
