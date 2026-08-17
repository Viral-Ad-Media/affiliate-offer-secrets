// Does HTTPS actually work for this domain, right now?
//
// SERVER-ONLY (node:tls). Netlify exposes no per-domain certificate state — the site has one
// certificate covering its primary domain plus every attached alias as SANs, and the API reports
// nothing per name. So the honest answer comes from opening a TLS connection and reading what the
// edge presents, which is also the thing that actually matters: what a visitor's browser will do.
//
// Measured while building this, and it corrected an assumption worth recording: 1800mastercard.com
// presents a certificate whose COMMON NAME is affiliateoffersecrets.com. That is not a
// misconfiguration — the name is covered in the SAN list, which is what browsers check. Reading
// only the CN would have reported a working domain as broken.

import { connect, type PeerCertificate } from "node:tls";

export type CertificateState = {
  /** True only if the presented chain actually covers this hostname. */
  secured: boolean;
  issuer: string | null;
  /** ISO string, or null when nothing was presented. */
  expiresAt: string | null;
  daysRemaining: number | null;
  /** Why it isn't secured, in the operator's terms. Null when it is. */
  problem: string | null;
};

const UNREACHABLE: CertificateState = {
  secured: false,
  issuer: null,
  expiresAt: null,
  daysRemaining: null,
  problem: "No HTTPS response — the certificate hasn't been issued yet, or DNS isn't pointing here.",
};

/**
 * Does `names` (CN + SANs) cover `host`?
 *
 * Wildcards match ONE label and only at the leftmost position, per RFC 6125: `*.example.com`
 * covers `www.example.com` but neither `example.com` nor `a.b.example.com`. Getting this wrong in
 * the permissive direction would tell a tenant their www works when a browser will refuse it.
 */
export function certCoversHost(names: string[], host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return names.some((raw) => {
    const n = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!n) return false;
    if (n === h) return true;
    if (!n.startsWith("*.")) return false;
    const suffix = n.slice(1); // ".example.com"
    if (!h.endsWith(suffix)) return false;
    // Exactly one label may replace the wildcard.
    return !h.slice(0, h.length - suffix.length).includes(".");
  });
}

function namesFrom(cert: PeerCertificate): string[] {
  const cn = (cert.subject as { CN?: string } | undefined)?.CN;
  const alt = (cert.subjectaltname ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.toLowerCase().startsWith("dns:"))
    .map((s) => s.slice(4));
  return [...(cn ? [cn] : []), ...alt];
}

/**
 * Reads the certificate the edge presents for `domain`.
 *
 * `rejectUnauthorized: false` deliberately — we want to INSPECT a certificate that doesn't validate
 * (that is the interesting case: a domain attached but not yet issued presents the site's default
 * cert) rather than get a thrown error with nothing to show. Coverage is then judged here, so a
 * non-matching cert reports "not secured" with a reason instead of a stack trace.
 *
 * Fails closed and never throws: this runs per-domain and one unreachable name must not break the
 * page listing the others.
 */
export async function checkCertificate(domain: string, timeoutMs = 8000): Promise<CertificateState> {
  const host = domain.trim().toLowerCase();
  if (!host) return UNREACHABLE;

  return new Promise<CertificateState>((resolve) => {
    let settled = false;
    const done = (state: CertificateState) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
      resolve(state);
    };

    const socket = connect(
      { host, port: 443, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || !cert.valid_to) return done(UNREACHABLE);

        const names = namesFrom(cert);
        const expires = new Date(cert.valid_to);
        const daysRemaining = Math.floor((expires.getTime() - Date.now()) / 86_400_000);
        const covers = certCoversHost(names, host);
        const expired = daysRemaining < 0;

        done({
          secured: covers && !expired,
          issuer: (cert.issuer as { O?: string; CN?: string } | undefined)?.O ?? (cert.issuer as { CN?: string } | undefined)?.CN ?? null,
          expiresAt: Number.isNaN(expires.getTime()) ? null : expires.toISOString(),
          daysRemaining: Number.isNaN(expires.getTime()) ? null : daysRemaining,
          problem: expired
            ? "The certificate has expired."
            : covers
              ? null
              : // The www case: the edge answers, but with a certificate that doesn't name this
                // host, so a browser refuses the connection outright.
                `The certificate presented doesn't cover ${host} — it names ${names.slice(0, 3).join(", ") || "something else"}.`,
        });
      }
    );

    socket.on("timeout", () => done(UNREACHABLE));
    socket.on("error", () => done(UNREACHABLE));
  });
}
