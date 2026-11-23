import { useState, type ReactNode } from "react";
import { SWRConfig, type State } from "swr";
import { swrOptions } from "@/lib/api";
// Mount with key=user.id. Logout unmounts the provider; private caches never cross sessions.
export function SessionCache({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new Map<string, State<unknown, unknown>>());
  return (
    <SWRConfig value={{ ...swrOptions, provider: () => cache }}>
      {children}
    </SWRConfig>
  );
}
