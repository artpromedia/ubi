"use client";

import type { ReactNode } from "react";

import {
  FleetAuthShell,
  FleetSessionProvider,
} from "@/components/providers/fleet-session-provider";
import { QueryProvider } from "@/components/providers/query-provider";

const PortalLayout = ({ children }: { readonly children: ReactNode }) => (
  <QueryProvider>
    <FleetSessionProvider>
      <FleetAuthShell>{children}</FleetAuthShell>
    </FleetSessionProvider>
  </QueryProvider>
);

export default PortalLayout;
