import { isValidEmail } from "@/lib/validate";

// Lead-email deliverability assessment. ISOMORPHIC and SYNCHRONOUS — no network, no MX lookup.
// This runs on /api/public/leads, the anonymous hot path CLAUDE.md guards most carefully; a DNS/MX
// round trip there would add latency and a new failure mode on paid ad traffic. Syntax + a
// disposable-domain list + role-account detection catches the bulk of junk without any of that.
//
// It never REJECTS a lead — a false positive would drop a real conversion. It classifies: a
// flagged lead is still captured, just parked in the moderation queue (contacts.review_status =
// 'pending') for the operator to approve or bin, rather than flowing straight into a send.

// The common throwaway-inbox providers. Not exhaustive by design — an allowlist-of-badness that
// covers the high-volume ones; the operator's review handles the long tail. Lowercase, bare domain.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.info", "guerrillamail.biz",
  "10minutemail.com", "10minutemail.net", "tempmail.com", "temp-mail.org", "tempmail.net",
  "throwawaymail.com", "yopmail.com", "getnada.com", "nada.email", "dispostable.com",
  "trashmail.com", "trashmail.net", "sharklasers.com", "grr.la", "spam4.me", "maildrop.cc",
  "mailnesia.com", "mintemail.com", "mohmal.com", "emailondeck.com", "fakeinbox.com",
  "tempinbox.com", "mailcatch.com", "tempr.email", "discard.email", "spamgourmet.com",
  "mytemp.email", "burnermail.io", "33mail.com", "anonaddy.com", "mailsac.com",
]);

// Mailbox names that are usually a company alias, not a person — a weaker signal than disposable,
// so it flags for review rather than being treated as hard-bad on its own.
const ROLE_LOCALPARTS = new Set([
  "admin", "administrator", "info", "support", "sales", "billing", "contact", "hello",
  "help", "office", "team", "noreply", "no-reply", "donotreply", "postmaster", "webmaster",
  "abuse", "marketing", "hr", "jobs", "careers", "press", "media", "legal", "privacy",
]);

export type EmailAssessment = {
  ok: boolean; // syntactically a valid email at all
  disposable: boolean;
  role: boolean;
  // 'approved' => flows through normally; 'pending' => held in the moderation queue with a reason.
  reviewStatus: "approved" | "pending";
  reason: string | null;
};

export function assessEmail(email: unknown): EmailAssessment {
  if (!isValidEmail(email)) {
    return { ok: false, disposable: false, role: false, reviewStatus: "pending", reason: "invalid address" };
  }
  const addr = email.toLowerCase();
  const at = addr.lastIndexOf("@");
  const local = addr.slice(0, at);
  const domain = addr.slice(at + 1);

  const disposable = DISPOSABLE_DOMAINS.has(domain);
  const role = ROLE_LOCALPARTS.has(local);

  // Disposable is the strong signal and reads first. Role is a softer one — a real lead can be
  // "info@theirbusiness.com", so it earns a review, not a bin.
  if (disposable) return { ok: true, disposable, role, reviewStatus: "pending", reason: "disposable email domain" };
  if (role) return { ok: true, disposable, role, reviewStatus: "pending", reason: "role/generic mailbox" };
  return { ok: true, disposable, role, reviewStatus: "approved", reason: null };
}
