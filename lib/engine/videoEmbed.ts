/**
 * Video sources for the page builder.
 *
 * The whole design exists to keep a tenant-typed string from ever reaching an `<iframe src>`.
 * A pasted URL is parsed into a PROVIDER + an ID matched against a strict charset, and the
 * renderer rebuilds the embed URL from a fixed template — so there is no code path from user
 * input to an arbitrary frame source. Same reasoning as styleToInlineCss's fixed key table: closed
 * by construction rather than sanitized after the fact.
 *
 * This matters more here than for a link. An `<a href>` a visitor must click is one thing; an
 * iframe loads whatever it points at, unprompted, on a page served to paid traffic.
 *
 * Isomorphic — the editor parses as you type and the renderer emits from the same table, so the
 * canvas can't accept something the published page then refuses.
 */

export type VideoProvider = "youtube" | "vimeo" | "file";

export type VideoSource =
  | { provider: "youtube"; videoId: string }
  | { provider: "vimeo"; videoId: string }
  /** A direct media URL (mp4/webm) played by the browser's own <video> element. */
  | { provider: "file"; url: string };

// YouTube ids are exactly 11 chars of an unreserved alphabet; Vimeo's are digits. Anchored, so a
// value that merely *contains* something id-shaped is rejected rather than partially matched.
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^[0-9]{6,12}$/;

/** Length cap before any regex work, mirroring lib/images/validate.ts's shape. */
export const MAX_VIDEO_URL = 500;

/**
 * Parses a pasted URL into a source, or null if it isn't one we can safely embed.
 *
 * Accepts the forms people actually paste — a watch link, a share link, an embed link, a bare
 * youtu.be — rather than demanding one canonical shape, because "paste the video link" is the
 * whole interaction and being fussy about which link would just look broken.
 */
export function parseVideoUrl(raw: unknown): VideoSource | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_VIDEO_URL) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Blocks javascript:, data: and every other scheme before host matching even runs.
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    // /watch?v=ID, /embed/ID, /shorts/ID, /live/ID
    const fromQuery = url.searchParams.get("v");
    const fromPath = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1];
    const id = (fromQuery || fromPath || "").trim();
    return YOUTUBE_ID.test(id) ? { provider: "youtube", videoId: id } : null;
  }

  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0]?.trim() ?? "";
    return YOUTUBE_ID.test(id) ? { provider: "youtube", videoId: id } : null;
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    // vimeo.com/123456789, player.vimeo.com/video/123456789. The last all-digit segment wins, so
    // /channels/staff/123456789 works too.
    const digits = url.pathname.split("/").filter((p) => /^[0-9]+$/.test(p));
    const id = digits[digits.length - 1] ?? "";
    return VIMEO_ID.test(id) ? { provider: "vimeo", videoId: id } : null;
  }

  // A direct media file, played by <video> — no third-party frame involved, so any https host is
  // fine. http is refused: a mixed-content video silently fails to load on an https page, which
  // looks like a broken block rather than a blocked one.
  if (/\.(mp4|webm|ogg|mov|m4v)$/i.test(url.pathname) && url.protocol === "https:") {
    return { provider: "file", url: url.toString() };
  }

  return null;
}

/** The URL the renderer puts in the frame — built from the id, never from what was pasted. */
export function embedUrl(source: VideoSource): string {
  switch (source.provider) {
    case "youtube":
      // -nocookie is the privacy-preserving host, and matches how this codebase treats consent
      // elsewhere (decline non-essential by default).
      return `https://www.youtube-nocookie.com/embed/${source.videoId}`;
    case "vimeo":
      return `https://player.vimeo.com/video/${source.videoId}`;
    case "file":
      return source.url;
  }
}

/** Round-trips a stored source back to a URL a person recognises, for the editor's input. */
export function sourceToDisplayUrl(source: VideoSource | null): string {
  if (!source) return "";
  switch (source.provider) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${source.videoId}`;
    case "vimeo":
      return `https://vimeo.com/${source.videoId}`;
    case "file":
      return source.url;
  }
}
