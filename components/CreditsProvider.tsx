"use client";

import { createContext, useCallback, useContext, useState } from "react";

type CreditsContextValue = {
  /** Current workspace balance. Seeded server-side so it's correct on first paint, no flash. */
  balance: number;
  /** Re-read the balance after something spent credits. */
  refresh: () => Promise<void>;
  /** Can this workspace afford `cost` right now? */
  canAfford: (cost: number) => boolean;
};

// Defaults chosen so a component rendered outside the provider degrades to "don't block anything"
// rather than claiming everything is unaffordable. A cost badge that wrongly greys out a working
// button is worse than one that shows a price and lets the server's 402 be the real answer — the
// server is the boundary either way; this context is only ever a hint.
const CreditsContext = createContext<CreditsContextValue>({
  balance: Number.POSITIVE_INFINITY,
  refresh: async () => {},
  canAfford: () => true,
});

export const useCredits = () => useContext(CreditsContext);

export default function CreditsProvider({
  initialBalance,
  children,
}: {
  initialBalance: number;
  children: React.ReactNode;
}) {
  const [balance, setBalance] = useState(initialBalance);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/credits/balance", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (typeof json.balance === "number") setBalance(json.balance);
    } catch {
      // A stale number is fine — the server re-checks on every charge regardless.
    }
  }, []);

  const canAfford = useCallback((cost: number) => cost <= 0 || balance >= cost, [balance]);

  return (
    <CreditsContext.Provider value={{ balance, refresh, canAfford }}>
      {children}
    </CreditsContext.Provider>
  );
}
