// Shared tag-field rules. Isomorphic (no I/O, no server-only imports) so the API routes and the
// client panels validate against the same constants rather than two drifting copies — the same
// reason lib/images/validate.ts and lib/validate.ts exist.

export const MAX_TAG_NAME = 60;
export const MAX_TAG_DESCRIPTION = 200;

// Fully anchored, exactly six hex digits. This mirrors the contact_tags_color_hex CHECK constraint
// (0062) on purpose — the constraint is the real boundary, since a tag colour ends up as a CSS
// value on a rendered chip and PostgREST is directly reachable. Keep the two in lockstep; loosening
// either to a startsWith/includes check is the gap that turns a colour field into CSS injection.
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isValidTagColor(value: unknown): value is string {
  return typeof value === "string" && value.length === 7 && HEX6.test(value);
}

// Offered as swatches in the UI. Not an allowlist — the field accepts any valid hex, since
// restricting an operator's own colour choices buys nothing security-wise once the format is
// pinned. Chosen to stay legible as chip backgrounds in both light and dark themes.
export const TAG_COLOR_PRESETS = [
  "#10B981", // emerald — the app accent
  "#3B82F6", // blue
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#F59E0B", // amber
  "#EF4444", // red
  "#14B8A6", // teal
  "#64748B", // slate
] as const;

export type ContactTag = {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
};

/**
 * Normalises the three editable tag fields from an untrusted request body.
 * Returns null for `name` when it's missing/blank so callers can 400 on it.
 * An invalid colour becomes null (cleared) rather than an error — a bad swatch shouldn't block
 * a rename — while the DB constraint still refuses anything malformed that got this far.
 */
export function normalizeTagFields(body: Record<string, unknown>): {
  name: string;
  color: string | null;
  description: string | null;
} {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_TAG_NAME) : "";
  const color = isValidTagColor(body.color) ? body.color : null;
  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, MAX_TAG_DESCRIPTION)
      : null;
  return { name, color, description };
}

/**
 * Readable foreground for a chip painted `hex`, via the W3C relative-luminance rule. A tag colour
 * is operator-chosen and can land anywhere on the spectrum, so a fixed text colour would be
 * unreadable on roughly half of them.
 */
export function readableTextOn(hex: string): string {
  const m = HEX6.test(hex) ? hex.slice(1) : "64748B";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? "#0b0f14" : "#ffffff";
}
