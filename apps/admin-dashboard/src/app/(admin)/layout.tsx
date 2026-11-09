"use client";

import type { ReactElement, ReactNode } from "react";

import {
  AdminSessionProvider,
  AdminShell,
} from "@/components/providers/admin-session-provider";

const DashboardLayout = ({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement => {
  return (
    <AdminSessionProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSessionProvider>
  );
};

export default DashboardLayout;
