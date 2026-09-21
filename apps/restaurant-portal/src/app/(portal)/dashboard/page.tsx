import { UtensilsCrossed } from "lucide-react";

/**
 * Honest placeholder. UBI Bites food delivery isn't live, and this portal
 * has no working order/menu backend behind it. Earlier mockups here
 * rendered sample orders and revenue — this page says plainly what's true
 * instead of pretending a restaurant account is connected.
 */
export default function DashboardPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-500">
        <UtensilsCrossed className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-bold text-white">
        Restaurant Portal isn&apos;t available yet
      </h1>
      <p className="mt-3 max-w-md text-sm text-gray-400">
        UBI Bites isn&apos;t live yet, and order, menu and payout management for
        restaurants is still being built. Nothing on this page is connected to
        real orders. Restaurant onboarding is arranged directly with UBI until
        this portal launches.
      </p>
    </div>
  );
}
