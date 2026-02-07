"use client";

import { useTripHistory } from "@/lib/hooks";
import { Calendar, ChevronLeft, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

// Mock trip data (fallback when API unavailable)
const mockTrips = [
  {
    id: "trip-1",
    date: "2026-01-30",
    time: "14:30",
    pickupAddress: "Westlands Mall, Nairobi",
    dropoffAddress: "JKIA Terminal 1",
    distance: "24.5 km",
    duration: "45 min",
    earnings: 1850,
    status: "completed" as const,
    riderName: "Sarah M.",
    riderRating: 5,
    tripType: "ride" as const,
  },
  {
    id: "trip-2",
    date: "2026-01-30",
    time: "11:15",
    pickupAddress: "Kilimani, Nairobi",
    dropoffAddress: "CBD, Nairobi",
    distance: "8.2 km",
    duration: "25 min",
    earnings: 650,
    status: "completed" as const,
    riderName: "John K.",
    riderRating: 4,
    tripType: "ride" as const,
  },
  {
    id: "trip-3",
    date: "2026-01-30",
    time: "09:00",
    pickupAddress: "Java House Westlands",
    dropoffAddress: "Karen Estate",
    distance: "15.0 km",
    duration: "35 min",
    earnings: 450,
    status: "completed" as const,
    riderName: "Food Delivery",
    riderRating: 5,
    tripType: "delivery" as const,
  },
  {
    id: "trip-4",
    date: "2026-01-29",
    time: "18:45",
    pickupAddress: "The Hub Karen",
    dropoffAddress: "Langata",
    distance: "6.5 km",
    duration: "20 min",
    earnings: 520,
    status: "completed" as const,
    riderName: "Mary W.",
    riderRating: 5,
    tripType: "ride" as const,
  },
  {
    id: "trip-5",
    date: "2026-01-29",
    time: "15:20",
    pickupAddress: "Village Market",
    dropoffAddress: "Gigiri",
    distance: "4.2 km",
    duration: "15 min",
    earnings: 380,
    status: "cancelled" as const,
    riderName: "Peter O.",
    riderRating: 0,
    tripType: "ride" as const,
  },
];

type FilterType = "all" | "rides" | "deliveries" | "cancelled";

export default function TripsPage() {
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch trip history from API
  const { data: apiTrips } = useTripHistory();

  // Transform API trips or use mock data
  const trips = useMemo(() => {
    if (apiTrips?.trips && apiTrips.trips.length > 0) {
      return apiTrips.trips.map((trip) => ({
        id: trip.id,
        date: new Date(trip.createdAt).toISOString().split("T")[0],
        time: new Date(trip.createdAt).toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        pickupAddress: trip.pickupAddress,
        dropoffAddress: trip.dropoffAddress,
        distance: `${(trip.distance / 1000).toFixed(1)} km`,
        duration: `${Math.round(trip.duration / 60)} min`,
        earnings: trip.totalEarnings,
        status: trip.status as "completed" | "cancelled",
        riderName: trip.riderName || "Rider",
        riderRating: trip.riderRating || 0,
        tripType: (trip.type || "ride") as "ride" | "delivery",
      }));
    }
    return mockTrips;
  }, [apiTrips]);

  const filteredTrips = trips.filter((trip) => {
    if (filter === "rides" && trip.tripType !== "ride") return false;
    if (filter === "deliveries" && trip.tripType !== "delivery") return false;
    if (filter === "cancelled" && trip.status !== "cancelled") return false;
    if (
      searchQuery &&
      !trip.pickupAddress.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !trip.dropoffAddress.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  // Group trips by date
  const groupedTrips = filteredTrips.reduce(
    (acc, trip) => {
      const tripDate = trip.date;
      if (tripDate) {
        acc[tripDate] ??= [];
        acc[tripDate].push(trip as (typeof mockTrips)[number]);
      }
      return acc;
    },
    {} as Record<string, typeof mockTrips>,
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (dateStr === today.toISOString().split("T")[0]) return "Today";
    if (dateStr === yesterday.toISOString().split("T")[0]) return "Yesterday";

    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12 safe-area-top">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-bold text-white">Trip History</h1>
          </div>

          {/* Search */}
          <div className="mt-4 relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search trips..."
              className="w-full rounded-xl bg-white/10 py-3 pl-12 pr-4 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Filters */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {[
              { value: "all", label: "All" },
              { value: "rides", label: "Rides" },
              { value: "deliveries", label: "Deliveries" },
              { value: "cancelled", label: "Cancelled" },
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value as FilterType)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  filter === f.value
                    ? "bg-primary text-white"
                    : "bg-white/10 text-white/70 hover:bg-white/20"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Trip List */}
        <div className="px-4 py-6">
          {Object.entries(groupedTrips).length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="mx-auto h-12 w-12 text-gray-300" />
              <p className="mt-4 text-gray-500">No trips found</p>
            </div>
          ) : (
            Object.entries(groupedTrips).map(([date, trips]) => (
              <div key={date} className="mb-6">
                <h2 className="mb-3 text-sm font-semibold text-gray-500">
                  {formatDate(date)}
                </h2>
                <div className="space-y-3">
                  {trips.map((trip) => (
                    <TripCard key={trip.id} trip={trip} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TripCard({ trip }: Readonly<{ trip: (typeof mockTrips)[0] }>) {
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="block rounded-xl bg-white p-4 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-full ${
              trip.tripType === "ride" ? "bg-primary/10" : "bg-orange-100"
            }`}
          >
            <span className="text-lg">
              {trip.tripType === "ride" ? "🚗" : "📦"}
            </span>
          </div>
          <div>
            <p className="font-medium text-gray-900">{trip.time}</p>
            <p className="text-sm text-gray-500">
              {trip.distance} • {trip.duration}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p
            className={`font-bold ${
              trip.status === "cancelled" ? "text-red-500" : "text-primary"
            }`}
          >
            {trip.status === "cancelled"
              ? "Cancelled"
              : `KES ${trip.earnings.toLocaleString()}`}
          </p>
          {trip.status === "completed" && (
            <div className="flex items-center justify-end gap-1 text-sm text-yellow-500">
              {"★".repeat(trip.riderRating)}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-start gap-2">
          <div className="mt-1 h-2 w-2 rounded-full bg-green-500" />
          <p className="flex-1 text-sm text-gray-600 line-clamp-1">
            {trip.pickupAddress}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="mt-1 h-2 w-2 rounded-full bg-red-500" />
          <p className="flex-1 text-sm text-gray-600 line-clamp-1">
            {trip.dropoffAddress}
          </p>
        </div>
      </div>
    </Link>
  );
}
