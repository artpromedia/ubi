"use client";

import {
  ArrowLeft,
  Calendar,
  Car,
  Clock,
  CreditCard,
  MessageCircle,
  Navigation,
  Phone,
  Star,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

// Helper function for status background color
function getStatusBgClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-green-100";
    case "cancelled":
      return "bg-red-100";
    default:
      return "bg-yellow-100";
  }
}

// Mock trip detail - in production, fetch from API
const mockTripDetail = {
  id: "trip-1",
  type: "ride" as const,
  status: "completed" as const,
  date: "2026-01-30",
  time: "14:30",
  pickupAddress: "Westlands Mall, Nairobi",
  pickupTime: "14:32",
  dropoffAddress: "JKIA Terminal 1",
  dropoffTime: "15:17",
  distance: "24.5 km",
  duration: "45 min",
  route: [
    { lat: -1.2635, lng: 36.8039 },
    { lat: -1.3191, lng: 36.9258 },
  ],
  rider: {
    name: "Sarah M.",
    phone: "+254712345678",
    rating: 4.9,
    photo: null,
  },
  earnings: {
    baseFare: 350,
    distanceFare: 1200,
    timeFare: 180,
    tip: 120,
    total: 1850,
    platformFee: 277.5,
    netEarnings: 1572.5,
  },
  payment: {
    method: "M-Pesa",
    status: "completed",
    reference: "QK7XY9Z123",
  },
  rating: {
    fromRider: 5,
    toRider: 5,
  },
};

export default function TripDetailPage() {
  const params = useParams();
  const tripId = params.id as string;
  const [trip] = useState(mockTripDetail);

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12">
          <div className="flex items-center gap-4">
            <Link
              href="/trips"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-xl font-bold text-white">Trip Details</h1>
              <p className="text-sm text-white/70">#{tripId}</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-6 space-y-4">
          {/* Status Badge */}
          <div className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full ${getStatusBgClass(trip.status)}`}
              >
                {trip.type === "ride" ? (
                  <Car className="h-5 w-5 text-gray-600" />
                ) : (
                  <span className="text-xl">📦</span>
                )}
              </div>
              <div>
                <p className="font-bold text-gray-900 capitalize">
                  {trip.type} - {trip.status}
                </p>
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Calendar className="h-4 w-4" />
                  {new Date(trip.date).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                  <span>•</span>
                  {trip.time}
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-primary">
                KES {trip.earnings.total.toLocaleString()}
              </p>
              <p className="text-sm text-gray-500">{trip.distance}</p>
            </div>
          </div>

          {/* Rider Info */}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-bold text-gray-900">Rider</h2>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <User className="h-6 w-6 text-gray-400" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{trip.rider.name}</p>
                  <div className="flex items-center gap-1 text-sm text-yellow-500">
                    <Star className="h-4 w-4 fill-current" />
                    <span>{trip.rider.rating}</span>
                  </div>
                </div>
              </div>
              {trip.status !== "completed" && (
                <div className="flex gap-2">
                  <button className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Phone className="h-5 w-5" />
                  </button>
                  <button className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MessageCircle className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Route */}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-bold text-gray-900">Route</h2>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-500">
                    Pickup • {trip.pickupTime}
                  </p>
                  <p className="font-medium text-gray-900">
                    {trip.pickupAddress}
                  </p>
                </div>
              </div>
              <div className="ml-4 h-8 border-l-2 border-dashed border-gray-300" />
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-500">
                    Dropoff • {trip.dropoffTime}
                  </p>
                  <p className="font-medium text-gray-900">
                    {trip.dropoffAddress}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Navigation className="h-4 w-4" />
                {trip.distance}
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Clock className="h-4 w-4" />
                {trip.duration}
              </div>
            </div>
          </div>

          {/* Earnings Breakdown */}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-bold text-gray-900">Earnings Breakdown</h2>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Base fare</span>
                <span className="font-medium">
                  KES {trip.earnings.baseFare.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Distance fare</span>
                <span className="font-medium">
                  KES {trip.earnings.distanceFare.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Time fare</span>
                <span className="font-medium">
                  KES {trip.earnings.timeFare.toLocaleString()}
                </span>
              </div>
              {trip.earnings.tip > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Tip</span>
                  <span className="font-medium text-green-600">
                    +KES {trip.earnings.tip.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="my-2 border-t border-gray-100" />
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-medium">
                  KES {trip.earnings.total.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Platform fee (15%)</span>
                <span className="font-medium text-red-500">
                  -KES {trip.earnings.platformFee.toLocaleString()}
                </span>
              </div>
              <div className="my-2 border-t border-gray-200" />
              <div className="flex justify-between">
                <span className="font-bold text-gray-900">Net earnings</span>
                <span className="font-bold text-primary">
                  KES {trip.earnings.netEarnings.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          {/* Payment Info */}
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-bold text-gray-900">Payment</h2>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                  <CreditCard className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {trip.payment.method}
                  </p>
                  <p className="text-sm text-gray-500">
                    Ref: {trip.payment.reference}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  trip.payment.status === "completed"
                    ? "bg-green-100 text-green-600"
                    : "bg-yellow-100 text-yellow-600"
                }`}
              >
                {trip.payment.status}
              </span>
            </div>
          </div>

          {/* Rating */}
          {trip.rating && (
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 font-bold text-gray-900">Ratings</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="text-sm text-gray-500">From rider</p>
                  <div className="mt-1 flex items-center justify-center gap-1 text-yellow-500">
                    {"★".repeat(trip.rating.fromRider)}
                  </div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 text-center">
                  <p className="text-sm text-gray-500">To rider</p>
                  <div className="mt-1 flex items-center justify-center gap-1 text-yellow-500">
                    {"★".repeat(trip.rating.toRider)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Support */}
          <Link
            href={`/support?tripId=${tripId}`}
            className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 py-4 font-medium text-gray-700"
          >
            <MessageCircle className="h-5 w-5" />
            Report an issue
          </Link>
        </div>
      </div>
    </div>
  );
}
