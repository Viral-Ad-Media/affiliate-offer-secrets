"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await createClient().auth.signOut();
        router.push("/login");
        router.refresh();
      }}
      className="flex items-center gap-1.5 rounded-full border border-ink-600 px-2.5 py-1 hover:border-red-500 hover:text-red-300"
    >
      {children}
    </button>
  );
}
