import { Download } from "lucide-react";

export const dynamic = "force-dynamic";

// Contacts → Export. The download itself is /api/contacts/export, which pages through every
// contact server-side — this page exists so "export" is a place in the nav rather than a button
// buried in the leads table.
export default function ContactExportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100">
          <Download className="h-5 w-5 text-emerald-400" /> Export contacts
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Download every contact as CSV — not just the page you happen to be looking at.
        </p>
      </div>

      <section className="card space-y-3 p-4">
        <div className="text-sm text-zinc-300">The file has one row per contact, with:</div>
        <ul className="list-inside list-disc space-y-1 text-xs text-zinc-500">
          <li>First name and email</li>
          <li>The campaign that captured them, if any</li>
          <li>Any extra form fields you added to that funnel, flattened into one column</li>
          <li>When they were captured</li>
        </ul>
        <a href="/api/contacts/export" className="btn-primary inline-flex w-fit items-center gap-1.5 text-xs">
          <Download className="h-3.5 w-3.5" /> Download CSV
        </a>
        <p className="text-[11px] text-zinc-500">
          Unsubscribed contacts are included — your sending tools decide who to mail, and dropping
          them here would quietly lose data you may still need for suppression lists.
        </p>
      </section>
    </div>
  );
}
