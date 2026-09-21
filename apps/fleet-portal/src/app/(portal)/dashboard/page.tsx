import { Car } from "lucide-react";

/**
 * Honest placeholder. The fleet portal has no working backend integration
 * yet — driver rosters, vehicle records, payouts and the live map shown in
 * earlier mockups were sample data, not real accounts. Rather than render
 * pretend numbers, this single screen says plainly what's true today.
 */
export default function DashboardPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-green-500/10 text-green-500">
        <Car className="h-7 w-7" />
      </div>
      <h1 className="text-2xl font-bold text-white">
        Fleet Portal isn&apos;t available yet
      </h1>
      <p className="mt-3 max-w-md text-sm text-gray-400">
        Managing several drivers and vehicles under one fleet account is still
        being built. Nothing on this page is connected to real drivers, vehicles
        or payouts. Until it launches, fleet arrangements are agreed directly
        with UBI.
      </p>
    </div>
  );
}
