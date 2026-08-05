// Brand-level constants that appear in more than one public page. Kept here rather than
// re-declared per page because the last rename proved the cost of duplication: the contact page's
// support address was still pointing at a placeholder domain long after every other mention of
// the old name had moved, purely because it lived alone in one file nobody thought to grep.
//
// SUPPORT_EMAIL must be a mailbox (or forwarder) that actually receives — it's printed on Contact,
// Privacy and Terms as the address for support and for GDPR/CCPA erasure requests, so a dead
// address here isn't cosmetic, it's a compliance claim the product can't honour.
//
// Deliberately the operator's own Gmail rather than support@affiliateoffersecrets.com: the domain
// has no MX record (see CLAUDE.md's mail-DNS note), so anything sent to support@ bounces. A
// personal address that receives beats a branded one that doesn't, and this is the address a real
// erasure request has to reach. Swap it back the moment MX exists — that is the only thing
// blocking it, and the branded address is the better public face.
export const SUPPORT_EMAIL = "viraladmediacontent@gmail.com";

// Shown as "Last updated" on Terms and Privacy. Bump this whenever either document's substance
// changes — not on a rename or a typo fix, which would falsely signal new terms to accept.
export const LEGAL_LAST_UPDATED = "2 August 2026";
