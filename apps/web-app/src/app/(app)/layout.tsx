/**
 * App Layout
 *
 * Authenticated app layout with providers and navigation.
 */

import { AppHeader, ServiceTabsCompact } from "@/components";
import { Providers } from "@/providers";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <div className="flex min-h-screen flex-col">
        <AppHeader />
        <main id="main-content" className="flex-1">
          {children}
        </main>
        {/* Mobile bottom nav */}
        <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden">
          <ServiceTabsCompact />
        </div>
      </div>
    </Providers>
  );
}
