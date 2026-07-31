// Parses a campaign kit's generated email_md (a 3-email swipe sequence, Markdown) into the
// subject/body pairs a Broadcast drip sequence is made of.
//
// The markdown is model-written, so this is deliberately tolerant: it recognises the shape
// stageSocial's prompt actually produces —
//
//   ## Email Swipe Sequence — {product}
//   *Affiliate Disclosure: …*
//   ### Email 1
//   **Subject:** …
//   {body}
//   ### Email 2
//   …
//
// — and degrades to a single step carrying the whole document rather than throwing, because a
// swipe that imports as one editable email is far more useful than an import that fails.

export type SwipeEmail = { subject: string; body_md: string };

const EMAIL_HEADING = /^\s{0,3}#{1,6}\s*Email\s*\d+\b.*$/gim;
// "**Subject:** x", "Subject: x", "*Subject*: x" — the bold markers are what the generator emits,
// but none of them are guaranteed.
const SUBJECT_LINE = /^\s{0,3}(?:\*{1,2}|_{1,2})?\s*Subject\s*(?:\*{1,2}|_{1,2})?\s*:\s*(.+?)\s*$/im;

export const MAX_SWIPE_EMAILS = 10;
const MAX_SUBJECT = 200;

function cleanSubject(raw: string): string {
  return raw
    .replace(/^\*{1,2}|\*{1,2}$/g, "")
    .replace(/^["'“”]|["'“”]$/g, "")
    .trim()
    .slice(0, MAX_SUBJECT);
}

// Everything above the first "### Email 1" is the swipe's own preamble (title line, the affiliate
// disclosure). It belongs to no single email, and the disclosure is re-added by the sender's
// own footer, so it's dropped rather than glued onto email 1.
export function parseEmailSwipe(emailMd: string | null | undefined): SwipeEmail[] {
  const md = (emailMd ?? "").trim();
  if (!md) return [];

  const starts: number[] = [];
  EMAIL_HEADING.lastIndex = 0;
  for (let m = EMAIL_HEADING.exec(md); m; m = EMAIL_HEADING.exec(md)) starts.push(m.index);

  if (starts.length === 0) {
    // No recognisable per-email headings: one step with the lot, subject left for the tenant.
    const subject = SUBJECT_LINE.exec(md)?.[1];
    return [{ subject: subject ? cleanSubject(subject) : "", body_md: md }];
  }

  const emails: SwipeEmail[] = [];
  for (let i = 0; i < starts.length && emails.length < MAX_SWIPE_EMAILS; i++) {
    const chunk = md.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined);
    // Drop the "### Email N" heading itself — it's a label for the swipe document, not part of
    // the email a subscriber receives.
    const withoutHeading = chunk.replace(/^\s{0,3}#{1,6}\s*Email\s*\d+\b.*$/im, "").trim();
    const subjectMatch = SUBJECT_LINE.exec(withoutHeading);
    const body = (subjectMatch ? withoutHeading.replace(subjectMatch[0], "") : withoutHeading)
      // A leading "---" rule separating the header from the body reads as an empty block once the
      // subject line is gone.
      .replace(/^\s*-{3,}\s*$/m, "")
      .trim();
    emails.push({
      subject: subjectMatch ? cleanSubject(subjectMatch[1]) : "",
      body_md: body,
    });
  }
  return emails.filter((e) => e.subject || e.body_md);
}

// Classic drip cadence: the first email goes out on enrolment, then every third day. Editable per
// step in the sequence editor afterwards.
export function defaultDelayDays(stepIndex: number): number {
  return stepIndex * 3;
}
