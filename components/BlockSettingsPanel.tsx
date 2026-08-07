"use client";

import {
  FORM_FIELD_PRESETS,
  FORM_FIELD_TYPES,
  CHOICE_FIELD_TYPES,
  type Block,
  type ElementBlock,
  type FormInputBlock,
  type ButtonAction,
  type FormSubmitAction,
  type FormFieldType,
} from "@/lib/engine/renderPages";

/**
 * A block's CONTENT settings, as opposed to BlockStylePanel's look-and-feel ones.
 *
 * The split is deliberate and worth keeping: style keys are a uniform table (`STYLE_KEYS_BY_TYPE`)
 * driving generic number/colour controls, while content settings are per-type and change what the
 * block DOES — a field's meaning, a button's action. Folding them into one component would mean
 * one file that both loops over a key table and hand-writes a union editor.
 *
 * Renders null for every type that has nothing to configure, so the rail falls through to the
 * style panel exactly as before for those.
 */

const SELECT =
  "mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-200";
const LABEL = "block text-[11px] font-medium text-zinc-400";

export function hasContentSettings(block: Block | null): boolean {
  if (!block) return false;
  return (
    block.type === "form_input" ||
    block.type === "button" ||
    block.type === "form" ||
    block.type === "lead_capture_form"
  );
}

const INPUT =
  "mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-200";

export default function BlockSettingsPanel({
  block,
  onChange,
  targets,
  forms,
}: {
  block: Block;
  onChange: (blockId: string, patch: Record<string, unknown>) => void;
  /** Blocks a button could scroll to — `{id,label}`, resolved by the canvas. */
  targets: { id: string; label: string; isForm: boolean }[];
  forms: { id: string; label: string }[];
}) {
  const set = (patch: Record<string, unknown>) => onChange(block.id, patch);

  // The form's own submit button: its label, and what happens once the lead is saved. This is
  // what replaced the separate primary_cta block on an opt-in page — the destination belongs to
  // the button someone actually clicks, not to a second button revealed afterwards.
  if (block.type === "lead_capture_form" || block.type === "form") {
    const isOptIn = block.type === "lead_capture_form";
    const c = block.content as {
      ctaText?: string;
      submitText?: string;
      successText?: string;
      afterSubmit?: FormSubmitAction;
    };
    const action: FormSubmitAction = c.afterSubmit ?? { kind: isOptIn ? "offer" : "message" };
    // Never offer this form as its own popup target — opening yourself on submit does nothing
    // visible and reads as a broken setting.
    const popupTargets = forms.filter((f) => f.id !== block.id);

    return (
      <div className="space-y-3">
        <label className="block">
          <span className={LABEL}>Button label</span>
          <input
            className={INPUT}
            value={(isOptIn ? c.ctaText : c.submitText) ?? ""}
            maxLength={60}
            onChange={(e) => set(isOptIn ? { ctaText: e.target.value } : { submitText: e.target.value })}
          />
        </label>

        <label className="block">
          <span className={LABEL}>When someone submits</span>
          <select
            className={SELECT}
            value={action.kind}
            onChange={(e) => {
              const kind = e.target.value as FormSubmitAction["kind"];
              // Switching kind writes a COMPLETE action rather than patching one field, so a
              // half-set action (popup with no target) can never reach the validator.
              if (kind === "url") set({ afterSubmit: { kind: "url", href: "" } });
              else if (kind === "popup")
                set({ afterSubmit: { kind: "popup", formId: popupTargets[0]?.id ?? "" } });
              else set({ afterSubmit: { kind } });
            }}
          >
            {/* Only meaningful where there IS an offer to send them to. */}
            {isOptIn && <option value="offer">Send them to the offer</option>}
            <option value="url">Send them to a link</option>
            {popupTargets.length > 0 && <option value="popup">Open another form</option>}
            <option value="message">Stay here and show a message</option>
          </select>
        </label>

        {action.kind === "url" && (
          <label className="block">
            <span className={LABEL}>Link</span>
            <input
              className={INPUT}
              value={action.href}
              placeholder="https://..."
              onChange={(e) => set({ afterSubmit: { kind: "url", href: e.target.value } })}
            />
            <span className="mt-1 block text-[11px] text-zinc-500">
              Must start with http:// or https://. Anything else is dropped on save and the form
              shows its message instead.
            </span>
          </label>
        )}

        {action.kind === "popup" && (
          <label className="block">
            <span className={LABEL}>Form to open</span>
            <select
              className={SELECT}
              value={action.formId}
              onChange={(e) => set({ afterSubmit: { kind: "popup", formId: e.target.value } })}
            >
              {popupTargets.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {(action.kind === "message" || action.kind === "popup") && (
          <label className="block">
            <span className={LABEL}>Message shown after submitting</span>
            <input
              className={INPUT}
              value={c.successText ?? ""}
              maxLength={120}
              onChange={(e) => set({ successText: e.target.value })}
            />
          </label>
        )}

        {isOptIn && action.kind === "offer" && (
          <p className="text-[11px] text-zinc-500">
            Goes to the next step of this funnel if it has one, otherwise your offer link. You never
            paste the affiliate link here — it&apos;s built from your network connection at publish
            time.
          </p>
        )}
      </div>
    );
  }

  if (block.type === "form_input") {
    const c = (block as FormInputBlock).content;
    // Which preset this field currently IS — matched on the pair that defines it, so a field whose
    // label was edited still shows the right type rather than silently reading as "Something else".
    const current =
      FORM_FIELD_PRESETS.find((p) => p.fieldKey === c.fieldKey && p.fieldType === c.fieldType) ??
      FORM_FIELD_PRESETS.find((p) => p.fieldType === c.fieldType && p.id === "custom");

    return (
      <div className="space-y-3">
        <label className="block">
          <span className={LABEL}>What this collects</span>
          <select
            className={SELECT}
            value={current?.id ?? "custom"}
            onChange={(e) => {
              const p = FORM_FIELD_PRESETS.find((x) => x.id === e.target.value);
              if (!p) return;
              // Picking a preset sets the key, the input type AND the label together — they are
              // one decision ("this is a phone number"), not three, and letting them drift is how
              // a field ends up labelled Phone and stored under `budget`.
              set({
                fieldKey: p.fieldKey,
                fieldType: p.fieldType,
                label: p.label,
                placeholder: p.placeholder ?? "",
                ...(CHOICE_FIELD_TYPES.includes(p.fieldType) && !(c.options ?? []).length
                  ? { options: ["Option 1", "Option 2"] }
                  : {}),
              });
            }}
          >
            {FORM_FIELD_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={LABEL}>Label</span>
          <input
            className={SELECT}
            defaultValue={c.label}
            onBlur={(e) => set({ label: e.target.value })}
          />
        </label>

        <label className="block">
          <span className={LABEL}>Placeholder</span>
          <input
            className={SELECT}
            defaultValue={c.placeholder}
            onBlur={(e) => set({ placeholder: e.target.value })}
          />
        </label>

        <label className="block">
          <span className={LABEL}>Input type</span>
          <select
            className={SELECT}
            value={c.fieldType}
            onChange={(e) => set({ fieldType: e.target.value as FormFieldType })}
          >
            {FORM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={LABEL}>Width</span>
          <select
            className={SELECT}
            value={c.width ?? "full"}
            onChange={(e) => set({ width: e.target.value })}
          >
            <option value="full">Full row</option>
            <option value="half">Half — sits beside the next field</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input type="checkbox" checked={c.required} onChange={(e) => set({ required: e.target.checked })} />
          Required
        </label>

        <p className="text-[11px] leading-snug text-zinc-500">
          Saved as <code className="text-zinc-400">{c.fieldKey}</code> — the CSV column header and
          the key on the contact.
        </p>
      </div>
    );
  }

  // Button
  const content = (block as ElementBlock).content as { text: string; action?: ButtonAction; href?: string };
  const action: ButtonAction = content.action ?? { kind: "link", href: content.href ?? "" };
  const other = targets.filter((t) => t.id !== block.id);
  // A scroll/popup target that isn't a real id is a HARD reject in the validator — it fails the
  // whole page save, not just this block — so a kind with nothing to point at is never offered.
  const kinds: { value: ButtonAction["kind"]; label: string; enabled: boolean }[] = [
    { value: "link", label: "Go to a URL", enabled: true },
    { value: "scroll", label: "Scroll to a block", enabled: other.length > 0 },
    { value: "popup", label: "Open a form", enabled: forms.length > 0 },
    { value: "submit", label: "Submit the form it's in", enabled: true },
  ];

  function actionForKind(kind: ButtonAction["kind"]): ButtonAction {
    switch (kind) {
      case "scroll":
        return { kind: "scroll", targetId: other[0]?.id ?? "" };
      case "popup":
        return { kind: "popup", formId: forms[0]?.id ?? "" };
      case "submit":
        return { kind: "submit" };
      default:
        return { kind: "link", href: action.kind === "link" ? action.href : "https://example.com" };
    }
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className={LABEL}>Action</span>
        <select
          className={SELECT}
          value={action.kind}
          onChange={(e) => set({ action: actionForKind(e.target.value as ButtonAction["kind"]) })}
        >
          {kinds.map((k) => (
            <option key={k.value} value={k.value} disabled={!k.enabled}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      {action.kind === "link" && (
        <label className="block">
          <span className={LABEL}>URL</span>
          <input
            type="url"
            className={SELECT}
            defaultValue={action.href}
            placeholder="https://example.com"
            onBlur={(e) => set({ action: { kind: "link", href: e.target.value } })}
          />
        </label>
      )}

      {action.kind === "scroll" && (
        <label className="block">
          <span className={LABEL}>Scroll to</span>
          <select
            className={SELECT}
            value={action.targetId}
            onChange={(e) => set({ action: { kind: "scroll", targetId: e.target.value } })}
          >
            {other.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.kind === "popup" && (
        <label className="block">
          <span className={LABEL}>Form to open</span>
          <select
            className={SELECT}
            value={action.formId}
            onChange={(e) => set({ action: { kind: "popup", formId: e.target.value } })}
          >
            {forms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {action.kind === "submit" && (
        <p className="text-[11px] leading-snug text-zinc-500">
          Submits the form this button sits inside. On a page with no form it does nothing.
        </p>
      )}
    </div>
  );
}
