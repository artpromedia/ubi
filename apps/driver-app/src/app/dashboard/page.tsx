"use client";

import { useDriverStats, useDriverStatus, useTripActions } from "@/lib/hooks";
import { useDriverStore, type DriverStatus } from "@/store/driver-store";
import {
  Bell,
  Car,
  ChevronRight,
  Clock,
  FileText,
  LogOut,
  MapPin,
  Menu,
  Settings,
  Star,
  TrendingUp,
  User,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

// Helper function for status-based border color
function getStatusBorderColor(status: DriverStatus): string {
  switch (status) {
    case "online":
      return "#1DB954";
    case "busy":
      return "#F59E0B";
    case "break":
      return "#3B82F6";
    default:
      return "#6B7280";
  }
}

// Helper function for status-based text color class
function getStatusTextClass(status: DriverStatus): string {
  switch (status) {
    case "online":
      return "text-driver-online";
    case "busy":
      return "text-driver-busy";
    case "break":
      return "text-driver-break";
    default:
      return "text-driver-offline";
  }
}

// Helper function for toggle button label
function getToggleButtonLabel(
  status: DriverStatus,
  isUpdating: boolean,
): string {
  if (isUpdating) return "Updating...";
  switch (status) {
    case "online":
      return "Go Offline";
    case "busy":
      return "On Active Trip";
    default:
      return "Go Online";
  }
}

// Mock trip request for demo
interface TripRequest {
  id: string;
  pickupAddress: string;
  dropoffAddress: string;
  distance: string;
  estimatedEarnings: number;
  riderName: string;
  riderRating: number;
  expiresIn: number;
}

export default function DashboardPage() {
  const { profile, status, setStatus, todayEarnings, todayTrips, todayHours } =
    useDriverStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [tripRequest, setTripRequest] = useState<TripRequest | null>(null);
  const [requestTimer, setRequestTimer] = useState(0);

  // API hooks
  const { data: driverStats } = useDriverStats();
  const { updateStatus: apiUpdateStatus, isUpdating } = useDriverStatus();
  const { acceptTrip, declineTrip } = useTripActions();

  // Use API stats if available (from today's data)
  const displayEarnings = driverStats?.today?.earnings ?? todayEarnings;
  const displayTrips = driverStats?.today?.trips ?? todayTrips;
  const displayHours = driverStats?.today?.hours ?? todayHours;

  // Simulate trip requests when online
  useEffect(() => {
    if (status !== "online") return;

    const requestInterval = setInterval(() => {
      // 20% chance of getting a request every 10 seconds
      if (Math.random() < 0.2) {
        setTripRequest({
          id: `trip-${Date.now()}`,
          pickupAddress: "Westlands Mall, Nairobi",
          dropoffAddress: "JKIA Terminal 1",
          distance: "24.5 km",
          estimatedEarnings: 1850,
          riderName: "Sarah M.",
          riderRating: 4.9,
          expiresIn: 20,
        });
        setRequestTimer(20);
      }
    }, 10000);

    return () => clearInterval(requestInterval);
  }, [status]);

  // Countdown for trip request
  useEffect(() => {
    if (!tripRequest || requestTimer <= 0) return;

    const timer = setInterval(() => {
      setRequestTimer((prev) => {
        if (prev <= 1) {
          setTripRequest(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [tripRequest, requestTimer]);

  const handleAcceptTrip = async () => {
    if (tripRequest) {
      // Try API first
      const result = await acceptTrip(tripRequest.id);
      if (result.success || !result) {
        setStatus("busy");
        setTripRequest(null);
        // Navigate to active trip page
      }
    }
  };

  const handleDeclineTrip = async () => {
    if (tripRequest) {
      await declineTrip(tripRequest.id, "driver_busy");
    }
    setTripRequest(null);
  };

  const toggleStatus = async () => {
    if (status === "offline") {
      // Try API first, then update local state
      await apiUpdateStatus(true);
      setStatus("online");
    } else if (status === "online") {
      await apiUpdateStatus(false);
      setStatus("offline");
    } else if (status === "busy") {
      // Can't toggle when busy
    }
  };

  const getStatusConfig = (s: DriverStatus) => {
    switch (s) {
      case "online":
        return {
          color: "bg-driver-online",
          text: "You're Online",
          subtitle: "Waiting for trip requests...",
          icon: "📡",
        };
      case "busy":
        return {
          color: "bg-driver-busy",
          text: "On a Trip",
          subtitle: "Complete your current trip",
          icon: "🚗",
        };
      case "break":
        return {
          color: "bg-driver-break",
          text: "On Break",
          subtitle: "Take your time",
          icon: "☕",
        };
      default:
        return {
          color: "bg-driver-offline",
          text: "You're Offline",
          subtitle: "Go online to receive trips",
          icon: "💤",
        };
    }
  };

  const statusConfig = getStatusConfig(status);

  return (
    <div className="flex min-h-screen flex-col bg-gray-100">
      {/* Responsive wrapper for larger screens */}
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Map Placeholder */}
        <div className="relative h-[50vh] min-h-[300px] max-h-[400px] bg-gray-200">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <MapPin className="mx-auto h-16 w-16" />
              <p className="mt-4 text-lg">Map View</p>
              <p className="text-sm">Your location will appear here</p>
            </div>
          </div>

          {/* Top Bar */}
          <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4">
            <button
              onClick={() => setMenuOpen(true)}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-lg"
            >
              <Menu className="h-6 w-6 text-gray-700" />
            </button>

            <Link
              href="/earnings"
              className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 shadow-lg"
            >
              <Wallet className="h-5 w-5 text-primary" />
              <span className="font-bold text-gray-900">
                KES {displayEarnings.toLocaleString()}
              </span>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </Link>
          </div>

          {/* Online Indicator */}
          {status === "online" && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2">
              <div className="relative">
                <div className="h-4 w-4 rounded-full bg-driver-online" />
                <div className="absolute inset-0 animate-ping rounded-full bg-driver-online opacity-75" />
              </div>
            </div>
          )}
        </div>

        {/* Bottom Sheet */}
        <div className="flex-1 -mt-8 rounded-t-3xl bg-white shadow-lg">
          <div className="flex justify-center py-3">
            <div className="h-1 w-12 rounded-full bg-gray-300" />
          </div>

          <div className="px-6 pb-8">
            {/* Status Card */}
            <div
              className={`rounded-2xl ${statusConfig.color} bg-opacity-10 border border-opacity-30 p-5`}
              style={{
                borderColor: getStatusBorderColor(status),
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-full ${statusConfig.color}`}
                >
                  <span className="text-2xl">{statusConfig.icon}</span>
                </div>
                <div className="flex-1">
                  <h2
                    className={`text-xl font-bold ${getStatusTextClass(status)}`}
                  >
                    {statusConfig.text}
                  </h2>
                  <p className="text-gray-600">{statusConfig.subtitle}</p>
                </div>
                {status === "online" && (
                  <div className="relative">
                    <div className="h-3 w-3 rounded-full bg-driver-online" />
                    <div className="absolute inset-0 animate-ping rounded-full bg-driver-online opacity-75" />
                  </div>
                )}
              </div>
            </div>

            {/* Toggle Button */}
            <button
              onClick={toggleStatus}
              disabled={status === "busy"}
              className={`mt-6 w-full rounded-2xl py-5 text-lg font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                status === "online"
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-primary hover:bg-primary-600"
              }`}
            >
              {getToggleButtonLabel(status, isUpdating)}
            </button>

            {/* Stats */}
            {(status === "online" || status === "busy") && (
              <div className="mt-6 grid grid-cols-3 gap-4">
                <div className="rounded-xl bg-gray-50 p-4 text-center">
                  <TrendingUp className="mx-auto h-6 w-6 text-primary" />
                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {displayTrips}
                  </p>
                  <p className="text-sm text-gray-500">Trips</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4 text-center">
                  <Clock className="mx-auto h-6 w-6 text-primary" />
                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {displayHours.toFixed(1)}
                  </p>
                  <p className="text-sm text-gray-500">Hours</p>
                </div>
                <div className="rounded-xl bg-gray-50 p-4 text-center">
                  <Wallet className="mx-auto h-6 w-6 text-primary" />
                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {(displayEarnings / (displayHours || 1)).toFixed(0)}
                  </p>
                  <p className="text-sm text-gray-500">KES/hr</p>
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="mt-6 flex flex-col sm:flex-row gap-3">
              <Link
                href="/trips"
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gray-100 py-4 font-medium text-gray-700 hover:bg-gray-200 active:bg-gray-300 transition-colors"
              >
                <Car className="h-5 w-5" />
                Trip History
              </Link>
              <Link
                href="/earnings"
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gray-100 py-4 font-medium text-gray-700 hover:bg-gray-200 active:bg-gray-300 transition-colors"
              >
                <Wallet className="h-5 w-5" />
                Earnings
              </Link>
            </div>
          </div>
        </div>
      </div>{" "}
      {/* Close responsive wrapper */}
      {/* Side Menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 w-full h-full bg-black/50 cursor-default"
            onClick={() => setMenuOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
            aria-label="Close menu"
          />
          <div className="absolute left-0 top-0 bottom-0 w-80 animate-slide-up bg-white shadow-xl">
            <div className="flex h-full flex-col">
              {/* Profile Header */}
              <div className="bg-ubi-black px-6 py-8">
                <button
                  onClick={() => setMenuOpen(false)}
                  className="absolute top-4 right-4 text-white/70 hover:text-white"
                >
                  <X className="h-6 w-6" />
                </button>
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
                    {profile?.photoUrl ? (
                      <img
                        src={profile.photoUrl}
                        alt={profile.firstName}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <User className="h-8 w-8 text-white" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {profile?.firstName} {profile?.lastName}
                    </h3>
                    <div className="flex items-center gap-1 text-yellow-400">
                      <Star className="h-4 w-4 fill-current" />
                      <span>{profile?.rating || 0}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="flex-1 overflow-y-auto py-4">
                <nav className="space-y-1 px-3">
                  <MenuItem
                    href="/profile"
                    icon={<User className="h-5 w-5" />}
                    label="Profile"
                    onClick={() => setMenuOpen(false)}
                  />
                  <MenuItem
                    href="/earnings"
                    icon={<Wallet className="h-5 w-5" />}
                    label="Earnings"
                    onClick={() => setMenuOpen(false)}
                  />
                  <MenuItem
                    href="/trips"
                    icon={<Car className="h-5 w-5" />}
                    label="Trip History"
                    onClick={() => setMenuOpen(false)}
                  />
                  <MenuItem
                    href="/documents"
                    icon={<FileText className="h-5 w-5" />}
                    label="Documents"
                    onClick={() => setMenuOpen(false)}
                  />
                  <MenuItem
                    href="/ratings"
                    icon={<Star className="h-5 w-5" />}
                    label="Ratings"
                    onClick={() => setMenuOpen(false)}
                  />
                  <MenuItem
                    href="/notifications"
                    icon={<Bell className="h-5 w-5" />}
                    label="Notifications"
                    badge="3"
                    onClick={() => setMenuOpen(false)}
                  />
                  <MenuItem
                    href="/settings"
                    icon={<Settings className="h-5 w-5" />}
                    label="Settings"
                    onClick={() => setMenuOpen(false)}
                  />
                </nav>
              </div>

              {/* Logout */}
              <div className="border-t p-4">
                <button className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-red-500 hover:bg-red-50">
                  <LogOut className="h-5 w-5" />
                  <span className="font-medium">Logout</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Trip Request Modal */}
      {tripRequest && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50">
          <div className="w-full max-w-lg animate-slide-up rounded-t-3xl bg-white p-6 shadow-xl">
            {/* Timer */}
            <div className="mb-4 flex items-center justify-between">
              <span className="font-bold text-gray-900">New Trip Request</span>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-primary/10">
                  <svg className="h-8 w-8 -rotate-90">
                    <circle
                      cx="16"
                      cy="16"
                      r="14"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="4"
                    />
                    <circle
                      cx="16"
                      cy="16"
                      r="14"
                      fill="none"
                      stroke="#1DB954"
                      strokeWidth="4"
                      strokeDasharray={88}
                      strokeDashoffset={88 - (88 * requestTimer) / 20}
                    />
                  </svg>
                </div>
                <span className="font-bold text-primary">{requestTimer}s</span>
              </div>
            </div>

            {/* Rider Info */}
            <div className="flex items-center gap-4 rounded-xl bg-gray-50 p-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-gray-900">
                  {tripRequest.riderName}
                </p>
                <div className="flex items-center gap-1 text-sm text-yellow-500">
                  <Star className="h-4 w-4 fill-current" />
                  <span>{tripRequest.riderRating}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-primary">
                  KES {tripRequest.estimatedEarnings.toLocaleString()}
                </p>
                <p className="text-sm text-gray-500">{tripRequest.distance}</p>
              </div>
            </div>

            {/* Route */}
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Pickup</p>
                  <p className="font-medium text-gray-900">
                    {tripRequest.pickupAddress}
                  </p>
                </div>
              </div>
              <div className="ml-4 h-8 border-l-2 border-dashed border-gray-300" />
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Dropoff</p>
                  <p className="font-medium text-gray-900">
                    {tripRequest.dropoffAddress}
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 grid grid-cols-2 gap-4">
              <button
                onClick={handleDeclineTrip}
                className="rounded-xl border-2 border-gray-200 py-4 font-bold text-gray-700 hover:bg-gray-50"
              >
                Decline
              </button>
              <button
                onClick={handleAcceptTrip}
                className="rounded-xl bg-primary py-4 font-bold text-white hover:bg-primary-600"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  href,
  icon,
  label,
  badge,
  onClick,
}: Readonly<{
  href: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  onClick?: () => void;
}>) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl px-4 py-3 text-gray-700 hover:bg-gray-100"
    >
      {icon}
      <span className="flex-1 font-medium">{label}</span>
      {badge && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
          {badge}
        </span>
      )}
    </Link>
  );
}
