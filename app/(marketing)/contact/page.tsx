import { Mail } from "lucide-react";

export const metadata = {
  title: "Contact",
  description: "Get in touch with the Affiliate Studio team.",
};

const SUPPORT_EMAIL = "support@clickbankstudio.app";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:py-20">
      <h1 className="text-3xl font-bold text-zinc-100 sm:text-4xl">Contact us</h1>
      <p className="mt-4 text-base leading-relaxed text-zinc-400">
        Questions about billing, connecting Facebook, or anything else — the fastest way to reach
        us is email. We typically reply within one business day.
      </p>

      <div className="card mt-8 flex items-center gap-4 p-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
          <Mail className="h-5 w-5" />
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">Email support</div>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-heading text-base font-semibold text-zinc-100 hover:text-emerald-400"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </div>

      <p className="mt-6 text-xs text-zinc-600">
        [Replace with your team's real support address before going live.]
      </p>
    </div>
  );
}
