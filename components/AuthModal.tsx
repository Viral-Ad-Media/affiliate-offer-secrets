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
// sign-up, forgot-password, and the remember-me behaviour can never drift between the two
// surfaces — there is one implementation and two mountings.
export default function AuthModal({
  mode = "login",
  className,
  children,
}: {
  mode?: AuthMode;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={className}>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-center text-lg">
            {mode === "signup" ? "Create your account" : "Sign in"}
          </DialogTitle>
        </DialogHeader>
        {/* key remounts the form when the trigger's mode differs, so opening "Get started" after
            "Sign in" doesn't reuse the previous mode's state. */}
        <AuthForm key={mode} initialMode={mode} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
