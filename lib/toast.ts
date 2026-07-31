// Tiny pub/sub behind the toast API. Deliberately not React context: toasts get fired from event
// handlers, fetch callbacks and catch blocks all over the app, and threading a provider hook into
// each of those is more plumbing than the feature is worth. <Toaster /> is the only subscriber.
//
// Client-only by construction (it's just a module-level array), so never import this from a
// Server Component — call it from the client component that owns the action.

export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

type Listener = (toasts: Toast[]) => void;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

// Newest first, and capped: a burst (e.g. a loop of failed saves) should not paper over the page.
const MAX_VISIBLE = 4;
const DISMISS_MS = 5000;

function emit() {
  listeners.forEach((l) => l(toasts));
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string) {
  const text = (message ?? "").toString().trim();
  if (!text) return;
  const id = nextId++;
  toasts = [{ id, kind, message: text }, ...toasts].slice(0, MAX_VISIBLE);
  emit();
  // Errors stay until dismissed — they usually carry something the reader needs to act on, and a
  // message that vanishes before it's read is worse than no message.
  if (kind !== "error") setTimeout(() => dismissToast(id), DISMISS_MS);
}

export const toast = {
  success: (message: string) => push("success", message),
  error: (message: string) => push("error", message),
  info: (message: string) => push("info", message),
};
