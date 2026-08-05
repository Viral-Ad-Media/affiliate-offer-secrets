"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AuthForm, { type AuthMode } from "@/components/AuthForm";
import { Card } from "@/components/ui/card";

// Still a real page, and it has to stay one even though the marketing site now opens the same
// form in a popup: ~15 server-side `redirect("/login")` calls target this route, middleware's auth
// gate sends every signed-out request here, and /r/{code} lands here with ?signup=1. A modal
// cannot be the target of an HTTP redirect.
function LoginInner() {
  const params = useSearchParams();
  const initialMode: AuthMode = params.get("signup") ? "signup" : "login";

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-zinc-100">
            Affiliate Offer <span className="text-emerald-400">Secrets</span>
          </h1>
        </div>
        <Card className="p-5">
          <AuthForm initialMode={initialMode} />
        </Card>
      </div>
    </main>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of static rendering.
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
