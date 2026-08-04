"use client";

import { useEffect, useState } from "react";
import AuthModal from "@/components/AuthModal";

const SEEN_KEY = "aos_exit_intent_seen";

// Opens the signup popup once when a signed-out visitor's pointer leaves the top of the viewport
// — the standard "heading for the back button or the tab bar" signal. Rendered only for signed-out
// visitors (MarketingNav decides), so it can never interrupt someone who already has an account.
//
// Three deliberate restraints, because an exit-intent popup is the easiest thing in this codebase
// to make obnoxious:
//   * once per browser SESSION (sessionStorage, not localStorage) — persistent suppression would
//     mean a visitor who dismisses it today never sees it again, session-scoped means it resets on
//     a genuinely new visit;
//   * pointer:fine only — `mouseout` toward the top of the viewport has no analogue on touch, and
//     firing it on a phone would just be a popup that appears at random;
//   * the listener removes itself after firing, so nothing re-triggers while the dialog is open.
export default function ExitIntentAuth() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
    } catch {
      // Safari private mode throws on sessionStorage. Without a way to remember that it fired,
      // the safer behaviour is not to fire at all rather than to fire on every mouse-out.
      return;
    }
    if (!window.matchMedia("(pointer: fine)").matches) return;

    function onMouseOut(e: MouseEvent) {
      // relatedTarget null means the pointer left the document entirely rather than moving
      // between elements; clientY <= 0 means it left upward, toward the browser chrome.
      if (e.relatedTarget || e.clientY > 0) return;
      if (cancelled) return;
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* already handled above; a failure here just means it may show again this session */
      }
      document.removeEventListener("mouseout", onMouseOut);
      setOpen(true);
    }

    document.addEventListener("mouseout", onMouseOut);
    return () => {
      cancelled = true;
      document.removeEventListener("mouseout", onMouseOut);
    };
  }, []);

  return <AuthModal mode="signup" open={open} onOpenChange={setOpen} />;
}
