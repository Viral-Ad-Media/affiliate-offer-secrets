import { marked } from "marked";
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

// Preview of one sequence step exactly as it will be sent: the send path is
// `marked.parse(body_md) + renderUnsubscribeFooterHtml(token)` (lib/engine/broadcast.ts), so this
// composes the same two pieces rather than approximating them.
//
// The footer carries a placeholder token, never a real contact's: a preview must not be able to
// unsubscribe anybody. The preview surface renders this inside a sandboxed frame, so the link
// can't be followed from there either.
export function renderEmailPreviewHtml(step: { subject: string; body_md: string }): string {
  const body = marked.parse(step.body_md ?? "", { async: false }) as string;
  const footer = renderUnsubscribeFooterHtml("preview-token-not-a-real-subscriber");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(step.subject || "(no subject)")}</title>
<style>
  body { margin:0; background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:#1a1a1a; line-height:1.6; }
  .shell { max-width:640px; margin:24px auto; background:#fff; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; }
  .subject { padding:14px 20px; border-bottom:1px solid #e5e7eb; background:#fafafa; }
  .subject-label { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#6b7280; }
  .subject-text { font-size:16px; font-weight:600; margin-top:2px; }
  .body { padding:20px; }
  .body img { max-width:100%; height:auto; }
  .body a { color:#047857; }
</style>
</head>
<body>
  <div class="shell">
    <div class="subject">
      <div class="subject-label">Subject</div>
      <div class="subject-text">${escapeHtml(step.subject || "(no subject)")}</div>
    </div>
    <div class="body">${body}${footer}</div>
  </div>
</body>
</html>`;
}
