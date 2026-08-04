"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import AuthForm, { type AuthMode } from "@/components/AuthForm";

// The marketing site's popup. Wraps the SAME AuthForm the /login page renders, so sign-in,
// sign-up, forgot-password and the remember-me behaviour can never drift between the two
// surfaces — one implementation, two mountings.
//
// Works either uncontrolled (pass `children` and it renders its own trigger button) or controlled
// (pass open/onOpenChange and no children), which is what the exit-intent watcher needs — nothing
// is clicked there, the dialog is opened by the pointer leaving the viewport.
export default function AuthModal({
  mode = "login",
  className,
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  mode?: AuthMode;
  className?: string;
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setUncontrolledOpen;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children ? <DialogTrigger className={className}>{children}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-lg">
            {mode === "signup" ? "Create your account" : "Sign in"}
          </DialogTitle>
        </DialogHeader>
        {/* key remounts the form when the mode differs, so opening "Get started" after "Sign in"
            doesn't inherit the previous mode's state. */}
        <AuthForm key={mode} initialMode={mode} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
