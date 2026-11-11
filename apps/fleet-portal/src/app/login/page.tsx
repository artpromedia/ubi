import { FleetLoginView } from "@/components/auth/FleetLoginView";

import type { ReactElement } from "react";

interface LoginPageProps {
  readonly searchParams?: Promise<{
    next?: string | string[];
    reason?: string | string[];
  }>;
}

export default async function FleetLoginPage({
  searchParams,
}: LoginPageProps): Promise<ReactElement> {
  const resolved = searchParams ? await searchParams : {};
  const nextRaw = Array.isArray(resolved.next)
    ? resolved.next[0]
    : resolved.next;
  const reasonRaw = Array.isArray(resolved.reason)
    ? resolved.reason[0]
    : resolved.reason;

  return (
    <FleetLoginView
      nextPath={nextRaw ?? "/dashboard"}
      reason={reasonRaw ?? null}
    />
  );
}
