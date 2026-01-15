"use client";

import * as React from "react";

import { Card, CardContent } from "./card";
import { cn } from "../lib/utils";

/**
 * RideCard - Display ride information
 *
 * @example
 * <RideCard
 *   pickup="123 Main St"
 *   dropoff="456 Oak Ave"
 *   status="in-transit"
 *   driverName="John D."
 *   estimatedArrival="5 min"
 * />
 */

export interface RideCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Pickup location */
  pickup: string;
  /** Dropoff location */
  dropoff: string;
  /** Ride status */
  status?: "pending" | "driver-assigned" | "in-transit" | "completed" | "cancelled";
  /** Driver name */
  driverName?: string;
  /** Estimated arrival time */
  estimatedArrival?: string;
  /** Price display */
  price?: string;
  /** Vehicle type */
  vehicleType?: string;
}

const statusLabels: Record<string, string> = {
  pending: "Finding driver...",
  "driver-assigned": "Driver assigned",
  "in-transit": "On the way",
  completed: "Completed",
  cancelled: "Cancelled",
};

const statusColors: Record<string, string> = {
  pending: "text-amber-600",
  "driver-assigned": "text-blue-600",
  "in-transit": "text-green-600",
  completed: "text-gray-600",
  cancelled: "text-red-600",
};

const RideCard = React.forwardRef<HTMLDivElement, RideCardProps>(
  (
    {
      className,
      pickup,
      dropoff,
      status = "pending",
      driverName,
      estimatedArrival,
      price,
      vehicleType,
      ...props
    },
    ref
  ) => {
    return (
      <Card ref={ref} className={cn("w-full", className)} {...props}>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3">
            {/* Status */}
            <div className="flex items-center justify-between">
              <span className={cn("text-sm font-medium", statusColors[status])}>
                {statusLabels[status]}
              </span>
              {estimatedArrival && (
                <span className="text-sm text-muted-foreground">
                  ETA: {estimatedArrival}
                </span>
              )}
            </div>

            {/* Locations */}
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <div className="mt-1.5 h-2 w-2 rounded-full bg-green-500" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Pickup</p>
                  <p className="text-sm font-medium">{pickup}</p>
                </div>
              </div>
              <div className="ml-1 h-4 w-px bg-border" />
              <div className="flex items-start gap-2">
                <div className="mt-1.5 h-2 w-2 rounded-full bg-red-500" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Dropoff</p>
                  <p className="text-sm font-medium">{dropoff}</p>
                </div>
              </div>
            </div>

            {/* Driver and Price */}
            {(driverName || price || vehicleType) && (
              <div className="flex items-center justify-between border-t pt-3">
                <div className="flex items-center gap-2">
                  {driverName && (
                    <span className="text-sm">
                      Driver: <span className="font-medium">{driverName}</span>
                    </span>
                  )}
                  {vehicleType && (
                    <span className="text-xs text-muted-foreground">
                      ({vehicleType})
                    </span>
                  )}
                </div>
                {price && (
                  <span className="text-sm font-semibold">{price}</span>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }
);
RideCard.displayName = "RideCard";

export { RideCard };
