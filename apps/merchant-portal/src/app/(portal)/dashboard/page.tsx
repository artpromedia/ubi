import { Package } from "lucide-react";

/**
 * Honest placeholder. UBI Send's delivery custody and returns have no
 * server-side implementation yet (the marketplace assignment adapter exists,
 * but nothing tracks a package end to end), so this portal has nothing real
 * to show. Earlier mockups here rendered sample shipments and revenue —
 * this page says plainly what's true instead.
 */
export default function DashboardPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-500">
        <Package className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-bold text-white">
        Merchant Portal isn&apos;t available yet
      </h1>
      <p className="mt-3 max-w-md text-sm text-gray-400">
        UBI Send package delivery is still being built out — nothing on this
        page is connected to real shipments, pickups or payouts. Merchant
        onboarding is arranged directly with UBI until this portal launches.
      </p>
    </div>
  );
}
