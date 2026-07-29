import { escapeHtml } from "./renderPages";

// Code-owned, non-negotiable — same shape as renderPages.ts's DISCLOSURE/LEAD_CONSENT_TEXT.
// Appended to every Broadcast send (lib/engine/broadcast.ts's "send" stage) and never exposed as
// an editable field in the step editor UI. The unsubscribe link is a real compliance requirement
// for automated/recurring marketing email, not optional decoration.
export function renderUnsubscribeFooterHtml(unsubToken: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  const unsubUrl = `${appUrl}/api/public/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  return `<hr style="margin:32px 0 12px;border:none;border-top:1px solid #ddd;" /><p style="font-size:12px;color:#888;">You're receiving this because you opted in on one of our pages. <a href="${escapeHtml(unsubUrl)}">Unsubscribe</a>.</p>`;
}
