import { FORM_FIELD_TYPES, type FormFieldType } from "@/lib/engine/blockTree";

/**
 * The workspace's library of custom contact fields — ClickFunnels' "Contact Attributes" model.
 *
 * The KEY is the permanent thing: it is the `name` attribute on the rendered input, the key in
 * `contacts.extra_fields`, and the CSV column header. The LABEL is what people edit. Separating
 * those two is the whole point — before this, renaming a field meant renaming its key, which
 * stranded every value already collected under the old one.
 *
 * These rules are re-stated from `0082_contact_attributes.sql`'s CHECK constraints on purpose, the
 * same way `lib/contactTags.ts` re-states the colour pattern: the database is the boundary (the
 * table is reachable through PostgREST), and this is the fast, specific error at the route.
 */

/** Must satisfy validatePageBlockTree's FIELD_KEY_RE — a key no page could use would be a trap. */
export const ATTRIBUTE_KEY_RE = /^[a-z0-9_-]{1,60}$/;

/**
 * Rendered by the lead-capture form itself and impossible to remove, so an attribute for either
 * would produce a second input that silently overwrites the real one on submit.
 */
export const BUILTIN_FIELD_KEYS = ["first_name", "email"] as const;

const CHOICE_TYPES: FormFieldType[] = ["radio", "select"];
const MAX_OPTIONS = 20;

export type AttributeFields = {
  key: string;
  label: string;
  field_type: FormFieldType;
  options: string[] | null;
  description: string | null;
};

export function normalizeAttributeFields(body: unknown): { ok: true; fields: AttributeFields } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const key = typeof b.key === "string" ? b.key.trim().toLowerCase() : "";
  if (!ATTRIBUTE_KEY_RE.test(key)) {
    return { ok: false, error: "Field key must be lowercase letters, numbers, dashes or underscores (no spaces)." };
  }
  if ((BUILTIN_FIELD_KEYS as readonly string[]).includes(key)) {
    return { ok: false, error: `"${key}" is collected by every form already — pick another key.` };
  }

  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!label || label.length > 120) return { ok: false, error: "Label is required (120 characters max)." };

  const field_type = (FORM_FIELD_TYPES as readonly string[]).includes(b.field_type as string)
    ? (b.field_type as FormFieldType)
    : "text";

  // Options belong to radio/select alone. Dropped rather than rejected for other types: a stored
  // list nothing renders is the kind of dead data that later reads as a bug.
  const rawOptions = Array.isArray(b.options) ? b.options : [];
  const options = CHOICE_TYPES.includes(field_type)
    ? rawOptions
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim())
        .filter((o) => o !== "")
        .slice(0, MAX_OPTIONS)
    : null;
  if (options && options.length === 0) {
    return { ok: false, error: "A choice field needs at least one option." };
  }

  const rawDescription = typeof b.description === "string" ? b.description.trim() : "";
  const description = rawDescription ? rawDescription.slice(0, 300) : null;

  return { ok: true, fields: { key, label, field_type, options, description } };
}
