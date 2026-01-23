/**
 * Trip Status Card
 *
 * Mobile-optimized card showing current trip status with driver info,
 * ETA, and quick actions.
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
  Car,
  Clock,
  MapPin,
  MessageSquare,
  Navigation,
  Phone,
  Shield,
  Star,
} from "lucide-react";

import { cn } from "../../lib/utils";

import type * as React from "react";

const tripStatusCardVariants = cva(
  "relative rounded-2xl border bg-white dark:bg-gray-900 overflow-hidden",
  {
    variants: {
      status: {
        searching: "border-yellow-200 dark:border-yellow-800",
        driver_assigned: "border-blue-200 dark:border-blue-800",
        arriving: "border-green-200 dark:border-green-800",
        in_progress: "border-green-200 dark:border-green-800",
        completed: "border-gray-200 dark:border-gray-800",
        cancelled: "border-red-200 dark:border-red-800",
      },
    },
    defaultVariants: {
      status: "searching",
    },
  },
);

export interface TripStatusCardProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tripStatusCardVariants> {
  /** Current trip status */
  status:
    | "searching"
    | "driver_assigned"
    | "arriving"
    | "in_progress"
    | "completed"
    | "cancelled";
  /** Driver information */
  driver?: {
    name: string;
    photo?: string;
    rating: number;
    totalTrips: number;
    vehicleModel: string;
    vehicleColor: string;
    licensePlate: string;
  };
  /** Estimated time of arrival in minutes */
  etaMinutes?: number;
  /** Pickup location */
  pickup?: string;
  /** Destination location */
  destination?: string;
  /** Callback when call driver is pressed */
  onCallDriver?: () => void;
  /** Callback when message driver is pressed */
  onMessageDriver?: () => void;
  /** Callback when safety button is pressed */
  onSafetyPress?: () => void;
  /** Callback when share trip is pressed */
  onShareTrip?: () => void;
}

const statusConfig = {
  searching: {
    label: "Finding your driver",
    color: "bg-yellow-500",
    icon: Clock,
    animate: true,
  },
  driver_assigned: {
    label: "Driver assigned",
    color: "bg-blue-500",
    icon: Car,
    animate: false,
  },
  arriving: {
    label: "Driver is arriving",
    color: "bg-green-500",
    icon: Navigation,
    animate: true,
  },
  in_progress: {
    label: "Trip in progress",
    color: "bg-green-500",
    icon: Navigation,
    animate: false,
  },
  completed: {
    label: "Trip completed",
    color: "bg-gray-500",
    icon: MapPin,
    animate: false,
  },
  cancelled: {
    label: "Trip cancelled",
    color: "bg-red-500",
    icon: MapPin,
    animate: false,
  },
};

export const TripStatusCard = ({
  className,
  status,
  driver,
  etaMinutes,
  pickup,
  destination,
  onCallDriver,
  onMessageDriver,
  onSafetyPress,
  onShareTrip,
  ...props
}: TripStatusCardProps) => {
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
    <div
      className={cn(tripStatusCardVariants({ status }), className)}
      {...props}
    >
      {/* Status Header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-10 w-10 rounded-full flex items-center justify-center",
                config.color,
              )}
            >
              <StatusIcon className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">
                {config.label}
              </p>
              {etaMinutes !== undefined &&
                status !== "completed" &&
                status !== "cancelled" && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {status === "in_progress"
                      ? `${etaMinutes} min to destination`
                      : `${etaMinutes} min away`}
                  </p>
                )}
            </div>
          </div>
          {config.animate && (
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "h-2 w-2 rounded-full",
                    config.color,
                    "animate-pulse",
                  )}
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Driver Info */}
      {driver && (
        <div className="p-4">
          <div className="flex items-center gap-4">
            {/* Driver Photo */}
            <div className="relative">
              {driver.photo ? (
                <img
                  src={driver.photo}
                  alt={driver.name}
                  className="h-16 w-16 rounded-full object-cover"
                />
              ) : (
                <div className="h-16 w-16 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xl font-bold">
                  {driver.name.charAt(0)}
                </div>
              )}
              <div className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full bg-white dark:bg-gray-900 flex items-center justify-center shadow-sm">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
              </div>
            </div>

            {/* Driver Details */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 dark:text-white truncate">
                {driver.name}
              </p>
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                  {driver.rating.toFixed(1)}
                </span>
                <span>•</span>
                <span>{driver.totalTrips.toLocaleString()} trips</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                {driver.vehicleColor} {driver.vehicleModel}
              </p>
              <p className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                {driver.licensePlate}
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={onCallDriver}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-colors"
            >
              <Phone className="h-4 w-4" />
              Call
            </button>
            <button
              onClick={onMessageDriver}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <MessageSquare className="h-4 w-4" />
              Message
            </button>
            <button
              onClick={onSafetyPress}
              className="flex items-center justify-center p-2.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              aria-label="Safety"
            >
              <Shield className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Searching State */}
      {status === "searching" && !driver && (
        <div className="p-6 text-center">
          <div className="relative mx-auto w-20 h-20 mb-4">
            <div className="absolute inset-0 rounded-full border-4 border-green-200 dark:border-green-800" />
            <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-green-500 animate-spin" />
            <Car className="absolute inset-0 m-auto h-8 w-8 text-green-500" />
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Looking for nearby drivers...
          </p>
        </div>
      )}

      {/* Route Info */}
      {(pickup || destination) && (
        <div className="px-4 pb-4">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-2">
            {pickup && (
              <div className="flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-green-500 flex items-center justify-center mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-white" />
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">
                  {pickup}
                </p>
              </div>
            )}
            {destination && (
              <div className="flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-red-500 flex items-center justify-center mt-0.5">
                  <MapPin className="h-3 w-3 text-white" />
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">
                  {destination}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export { tripStatusCardVariants };
