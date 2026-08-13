"use client";

import { useEffect, useState } from "react";
import {
  FORM_FIELD_PRESETS,
  FORM_FIELD_TYPES,
  CHOICE_FIELD_TYPES,
  type Block,
  type ElementBlock,
  type FormInputBlock,
  type ButtonAction,
  type FormSubmitAction,
  type BranchTarget,
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
    block.type === "lead_capture_form" ||
    block.type === "custom_html"
  );
}

const INPUT =
  "mt-1 w-full rounded-lg border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-zinc-200";

export type FunnelStepOption = { id: string; label: string };

/**
 * Where one answer sends someone. Module scope, NOT defined inside the panel's render — a nested
 * component definition gets a fresh identity on every render, which remounts its inputs and eats
 * whatever is being typed. The same trap WysiwygCanvas documents for its own wrappers.
 *
 * Every choice is a picker over things that really exist: a step is chosen from the funnel's own
 * steps, never typed. The validator prunes a target naming nothing, so offering a dropdown is what
 * keeps the editor and the validator agreeing about what is selectable.
 */
function BranchTargetPicker({
  value,
  onChange,
  steps,
  allowOffer,
}: {
  value: BranchTarget;
  onChange: (t: BranchTarget) => void;
  steps: FunnelStepOption[];
  allowOffer: boolean;
}) {
  return (
    <div className="space-y-1">
      <select
        className={SELECT}
        value={value.kind}
        onChange={(e) => {
          const kind = e.target.value as BranchTarget["kind"];
          // A complete target every time, never a patch — a half-set one (step with no id) would
          // reach the validator and silently become "message".
          if (kind === "url") onChange({ kind: "url", href: "" });
          else if (kind === "step") onChange({ kind: "step", stepId: steps[0]?.id ?? "" });
          else onChange({ kind } as BranchTarget);
        }}
      >
        {allowOffer && <option value="offer">the offer</option>}
        {steps.length > 0 && <option value="step">a step in this funnel</option>}
        <option value="url">a link</option>
        <option value="message">nowhere — show the message</option>
      </select>
      {value.kind === "step" && (
        <select
          className={SELECT}
          value={value.stepId}
          onChange={(e) => onChange({ kind: "step", stepId: e.target.value })}
        >
          {steps.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      )}
      {value.kind === "url" && (
        <input
          className={INPUT}
          value={value.href}
          placeholder="https://..."
          onChange={(e) => onChange({ kind: "url", href: e.target.value })}
        />
      )}
    </div>
  );
}


type SavedAttribute = {
  key: string;
  label: string;
  field_type: FormFieldType;
  options?: string[] | null;
};

/**
 * The workspace's reusable field library (0082), fetched once per panel mount.
 *
 * Read through the route rather than the browser Supabase client so the workspace scoping lives
 * in one place — `contact_attributes` is workspace-scoped and the route already resolves that from
 * the request host. A failed load is silent and simply leaves the saved-fields group out: the
 * preset list still works, so a registry hiccup must not block editing a form.
 */
function useContactAttributes() {
  const [savedAttributes, setSavedAttributes] = useState<SavedAttribute[]>([]);
  const [savingAttribute, setSavingAttribute] = useState(false);
  const [attributeError, setAttributeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/contact-attributes")
      .then((r) => (r.ok ? r.json() : { attributes: [] }))
      .then((d) => {
        if (!cancelled) setSavedAttributes(Array.isArray(d.attributes) ? d.attributes : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveAsAttribute(fields: {
    key: string;
    label: string;
    field_type: FormFieldType;
    options?: string[];
  }) {
    setSavingAttribute(true);
    setAttributeError(null);
    const res = await fetch("/api/contact-attributes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    setSavingAttribute(false);
    if (!res.ok) {
      setAttributeError(data.error ?? "Couldn't save that field");
      return;
    }
    setSavedAttributes((prev) => [...prev, data.attribute]);
  }

  return { savedAttributes, savingAttribute, attributeError, saveAsAttribute };
}

export default function BlockSettingsPanel({
  block,
  onChange,
  targets,
  forms,
  siblingFields = [],
  funnelSteps = [],
}: {
  block: Block;
  onChange: (blockId: string, patch: Record<string, unknown>) => void;
  /** Blocks a button could scroll to — `{id,label}`, resolved by the canvas. */
  targets: { id: string; label: string; isForm: boolean }[];
  forms: { id: string; label: string }[];
  /**
   * The OTHER fields on the same form as the selected input — what a condition may point at.
   * Resolved by the canvas, which is the only thing that knows which form a field sits in.
   * A condition naming anything outside this list is pruned by the validator, so offering a
   * dropdown rather than a text box is what keeps the two in step.
   */
  siblingFields?: { fieldKey: string; label: string }[];
  /**
   * This funnel's steps, as branch destinations. Empty on a blog post and on a standalone funnel
   * with no steps — the picker simply doesn't offer "a step in this funnel" then.
   *
   * Ids, not indexes: a branch rule stores funnel_steps.id because move_funnel_step swaps indexes.
   */
  funnelSteps?: FunnelStepOption[];
}) {
  const set = (patch: Record<string, unknown>) => onChange(block.id, patch);
  // Called unconditionally: this component returns early for other block types, and a hook behind
  // a conditional return is the classic rules-of-hooks crash when the selection changes type.
  const { savedAttributes, savingAttribute, attributeError, saveAsAttribute } = useContactAttributes();

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

    // Only a field with a fixed set of answers can be branched on: the rules match answer VALUES,
    // and a free-text box has none to list. So the option is hidden entirely until the form has a
    // question worth branching on, rather than offered and then unusable.
    const fields = (block.children ?? []) as FormInputBlock[];
    const branchable = fields.filter((f) => (f.content.options ?? []).length > 0);
    const branchField =
      action.kind === "branch"
        ? branchable.find((f) => f.content.fieldKey === action.fieldKey) ?? branchable[0]
        : branchable[0];
    const answers = branchField?.content.options ?? [];
    const ruleFor = (v: string): BranchTarget =>
      (action.kind === "branch" ? action.rules.find((r) => r.value === v)?.then : undefined) ?? {
        kind: "message",
      };
    const setRule = (v: string, then: BranchTarget) => {
      if (action.kind !== "branch") return;
      const rest = action.rules.filter((r) => r.value !== v);
      set({ afterSubmit: { ...action, rules: [...rest, { value: v, then }] } });
    };

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
              else if (kind === "branch")
                set({
                  afterSubmit: {
                    kind: "branch",
                    fieldKey: branchable[0]?.content.fieldKey ?? "",
                    // Seeded with every answer pointing at the offer — the same place the form
                    // would have gone anyway. So switching to branching changes nothing until a
                    // destination is actually chosen, rather than silently stranding answers.
                    rules: (branchable[0]?.content.options ?? []).map((v) => ({
                      value: v,
                      then: { kind: isOptIn ? "offer" : "message" } as BranchTarget,
                    })),
                    otherwise: { kind: isOptIn ? "offer" : "message" },
                  },
                });
              else set({ afterSubmit: { kind } });
            }}
          >
            {/* Only meaningful where there IS an offer to send them to. */}
            {isOptIn && <option value="offer">Send them to the offer</option>}
            <option value="url">Send them to a link</option>
            {popupTargets.length > 0 && <option value="popup">Open another form</option>}
            {branchable.length > 0 && (
              <option value="branch">Send each answer somewhere different</option>
            )}
            <option value="message">Stay here and show a message</option>
          </select>
        </label>

        {action.kind === "branch" && (
          <div className="space-y-2 rounded-lg border border-ink-700 p-2">
            <label className="block">
              <span className={LABEL}>Question to sort on</span>
              <select
                className={SELECT}
                value={branchField?.content.fieldKey ?? ""}
                onChange={(e) => {
                  const f = branchable.find((x) => x.content.fieldKey === e.target.value);
                  // Changing the question rebuilds the rules against the NEW answers. Keeping the
                  // old ones would leave rules matching values nobody can pick, which the validator
                  // prunes on save — so the editor would show routes that quietly vanish.
                  set({
                    afterSubmit: {
                      ...action,
                      fieldKey: e.target.value,
                      rules: (f?.content.options ?? []).map((v) => ({
                        value: v,
                        then: { kind: isOptIn ? "offer" : "message" } as BranchTarget,
                      })),
                    },
                  });
                }}
              >
                {branchable.map((f) => (
                  <option key={f.id} value={f.content.fieldKey}>
                    {f.content.label || f.content.fieldKey}
                  </option>
                ))}
              </select>
            </label>

            {answers.map((v) => (
              <label className="block" key={v}>
                <span className={LABEL}>&ldquo;{v}&rdquo; goes to</span>
                <BranchTargetPicker
                  value={ruleFor(v)}
                  onChange={(t) => setRule(v, t)}
                  steps={funnelSteps}
                  allowOffer={isOptIn}
                />
              </label>
            ))}

            <label className="block">
              <span className={LABEL}>Anyone who skips it goes to</span>
              <BranchTargetPicker
                value={action.otherwise}
                onChange={(t) => set({ afterSubmit: { ...action, otherwise: t } })}
                steps={funnelSteps}
                allowOffer={isOptIn}
              />
            </label>

            {funnelSteps.length === 0 && (
              <p className="text-[11px] text-zinc-500">
                Add steps to this funnel and they&apos;ll show up here as destinations.
              </p>
            )}
          </div>
        )}

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={(c as { stepped?: boolean }).stepped === true}
            onChange={(e) => set({ stepped: e.target.checked })}
          />
          <span>
            <span className="block text-[11px] font-medium text-zinc-300">One question at a time</span>
            <span className="block text-[11px] text-zinc-500">
              Shows each field on its own with Next/Back, and asks for the name and email last. With
              JavaScript off it stays one plain form, so nobody sees a blank page.
            </span>
          </span>
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
            value={savedAttributes.some((a) => a.key === c.fieldKey) ? `attr:${c.fieldKey}` : current?.id ?? "custom"}
            onChange={(e) => {
              // A saved attribute sets key + type + label together for exactly the same reason a
              // preset does — one decision, not three — but the key comes from the library, so two
              // forms asking the same question land in the same column.
              if (e.target.value.startsWith("attr:")) {
                const a = savedAttributes.find((x) => x.key === e.target.value.slice(5));
                if (!a) return;
                set({
                  fieldKey: a.key,
                  fieldType: a.field_type,
                  label: a.label,
                  placeholder: a.label,
                  ...(CHOICE_FIELD_TYPES.includes(a.field_type) && a.options?.length ? { options: a.options } : {}),
                });
                return;
              }
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
            {savedAttributes.length > 0 && (
              <optgroup label="Your saved fields">
                {savedAttributes.map((a) => (
                  <option key={`attr:${a.key}`} value={`attr:${a.key}`}>
                    {a.label}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Common fields">
              {FORM_FIELD_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        {/* Promote this field into the workspace's library so the next form can pick it by name
            and every lead lands under the same key. The key is what makes reporting across funnels
            add up; without this, two forms asking the same question invent two different keys. */}
        {!savedAttributes.some((a) => a.key === c.fieldKey) && (
          <button
            type="button"
            onClick={() => saveAsAttribute({ key: c.fieldKey, label: c.label, field_type: c.fieldType, options: c.options })}
            disabled={savingAttribute}
            className="text-[11px] text-emerald-400 underline decoration-emerald-700 hover:text-emerald-300 disabled:opacity-50"
          >
            {savingAttribute ? "Saving…" : "Save as a reusable field"}
          </button>
        )}
        {attributeError && <p className="text-[11px] text-red-300">{attributeError}</p>}

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

        <label className="block">
          <span className={LABEL}>Label position</span>
          <select
            className={SELECT}
            value={c.labelPosition ?? "none"}
            onChange={(e) => set({ labelPosition: e.target.value })}
          >
            <option value="none">None — placeholder only</option>
            <option value="above">Above the field</option>
            <option value="border">On the border</option>
          </select>
        </label>

        <div className="space-y-2 rounded-lg border border-ink-700 p-2.5">
          <span className={LABEL}>Only show this field when…</span>
          {siblingFields.length === 0 ? (
            <p className="text-[11px] text-zinc-500">
              Add another field to this form first — a condition has to watch something.
            </p>
          ) : (
            <>
              <select
                className={SELECT}
                value={c.visibleWhen?.fieldKey ?? ""}
                onChange={(e) =>
                  set({
                    visibleWhen: e.target.value
                      ? { fieldKey: e.target.value, op: c.visibleWhen?.op ?? "filled", value: c.visibleWhen?.value ?? "" }
                      : undefined,
                  })
                }
              >
                <option value="">Always show it</option>
                {siblingFields.map((f) => (
                  <option key={f.fieldKey} value={f.fieldKey}>
                    {f.label || f.fieldKey}
                  </option>
                ))}
              </select>
              {c.visibleWhen && (
                <>
                  <select
                    className={SELECT}
                    value={c.visibleWhen.op}
                    onChange={(e) => set({ visibleWhen: { ...c.visibleWhen!, op: e.target.value } })}
                  >
                    <option value="filled">has any answer</option>
                    <option value="empty">is left blank</option>
                    <option value="equals">is exactly…</option>
                    <option value="not_equals">is anything except…</option>
                  </select>
                  {(c.visibleWhen.op === "equals" || c.visibleWhen.op === "not_equals") && (
                    <input
                      className={SELECT}
                      placeholder="Value to match"
                      defaultValue={c.visibleWhen.value ?? ""}
                      onBlur={(e) => set({ visibleWhen: { ...c.visibleWhen!, value: e.target.value } })}
                    />
                  )}
                  <p className="text-[11px] leading-snug text-zinc-500">
                    Hidden fields are switched off, not just hidden — a question nobody saw never
                    arrives as an answer.
                  </p>
                </>
              )}
            </>
          )}
        </div>

        <p className="text-[11px] leading-snug text-zinc-500">
          Saved as <code className="text-zinc-400">{c.fieldKey}</code> — the CSV column header and
          the key on the contact.
        </p>
      </div>
    );
  }

  if (block.type === "custom_html") {
    const c = (block as ElementBlock).content as { code: string };
    return (
      <div className="space-y-3">
        <label className="block">
          <span className={LABEL}>HTML / CSS / JavaScript</span>
          {/* Uncontrolled + commit on blur, like every other field in this panel — and doubly right
              here: committing per keystroke would re-key the canvas preview frame and reload the
              snippet on every character typed. */}
          <textarea
            className={`${SELECT} h-64 resize-y font-mono leading-relaxed`}
            defaultValue={c.code}
            spellCheck={false}
            placeholder={'<div class="my-widget">…</div>\n<script>…</script>'}
            onBlur={(e) => set({ code: e.target.value })}
          />
        </label>
        <p className="text-[11px] leading-snug text-zinc-500">
          Runs exactly as written, as part of the page — no rewriting, no escaping. Click outside the
          box to apply it to the preview.
        </p>
        <p className="text-[11px] leading-snug text-amber-300/90">
          Only paste code you wrote or trust. On the default page URL it runs on the same domain as
          your dashboard, so a hostile snippet can reach anything a signed-in visitor&apos;s browser
          can.
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
