import { escapeHtml } from "@/lib/engine/renderPages";

/**
 * Sender identity: where replies go, and who the sender legally is.
 *
 * Separate from mail_provider_connections, which is transport (API key, SMTP host, verified
 * from-address). Identity changes for marketing reasons and survives switching providers.
 *
 * Isomorphic — the settings page renders the same footer preview the Broadcast worker sends, so
 * what you see there is what actually goes out rather than an approximation of it.
 */

export type EmailSettings = {
  reply_to?: string | null;
  business_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country?: string | null;
  footer_note?: string | null;
};

export const EMAIL_SETTINGS_COLUMNS =
  "reply_to, business_name, address_line1, address_line2, city, region, postal_code, country, footer_note";

/** Every field is free text a person types; caps stop a pathological value reaching an email. */
export const MAX_EMAIL_SETTING_FIELD = 200;
export const MAX_FOOTER_NOTE = 300;

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Normalizes an incoming patch. Blank strings become NULL — "cleared" and "never set" are the
 *  same state here, and keeping both would mean two ways to render nothing. */
export function normalizeEmailSettings(body: Record<string, unknown>): EmailSettings {
  return {
    reply_to: clean(body.reply_to, MAX_EMAIL_SETTING_FIELD),
    business_name: clean(body.business_name, MAX_EMAIL_SETTING_FIELD),
    address_line1: clean(body.address_line1, MAX_EMAIL_SETTING_FIELD),
    address_line2: clean(body.address_line2, MAX_EMAIL_SETTING_FIELD),
    city: clean(body.city, MAX_EMAIL_SETTING_FIELD),
    region: clean(body.region, MAX_EMAIL_SETTING_FIELD),
    postal_code: clean(body.postal_code, MAX_EMAIL_SETTING_FIELD),
    country: clean(body.country, MAX_EMAIL_SETTING_FIELD),
    footer_note: clean(body.footer_note, MAX_FOOTER_NOTE),
  };
}

/** "123 Main St, Suite 4, Austin, TX 78701, US" — omitting whatever isn't filled in. */
export function formatPostalAddress(s: EmailSettings): string {
  return [s.address_line1, s.address_line2, s.city, s.region, s.postal_code, s.country]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * The sender-identity block that sits above the unsubscribe line.
 *
 * This is the reason the settings page exists rather than being a preferences bag: CAN-SPAM (US)
 * and CASL (CA) both require a valid physical mailing address in commercial email, and the
 * unsubscribe link this codebase already treats as non-negotiable is only half of that.
 *
 * Returns "" when nothing is filled in, so an account that has configured none of this sends
 * exactly what it sent before — this can't retroactively change existing accounts' mail.
 */
export function renderSenderIdentityHtml(s: EmailSettings | null): string {
  if (!s) return "";
  const address = formatPostalAddress(s);
  const lines = [s.business_name, address, s.footer_note]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .map((v) => escapeHtml(v));
  if (lines.length === 0) return "";
  return `<p style="font-size:12px;color:#888;margin:0 0 6px;">${lines.join("<br />")}</p>`;
}
