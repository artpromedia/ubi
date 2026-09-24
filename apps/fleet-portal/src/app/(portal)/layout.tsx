"use client";

import { useState, type ReactNode } from "react";

import { FleetGate, FleetProvider } from "@/components/fleet/fleet-context";
import { FleetHeader, Sidebar } from "@/components/layout/navigation";
import { QueryProvider } from "@/components/providers/query-provider";

const PortalLayout = ({ children }: { readonly children: ReactNode }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <QueryProvider>
      <FleetProvider>
        <div className="min-h-screen bg-[#121212] text-zinc-100">
          <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="lg:ml-64">
            <FleetHeader onMenuClick={() => setSidebarOpen(true)} />
            <main className="p-4 lg:p-6">
              <FleetGate>{children}</FleetGate>
            </main>
          </div>
        </div>
      </FleetProvider>
    </QueryProvider>
  );
};

export default PortalLayout;
