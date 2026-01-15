"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  Bike,
  Car,
  Clock,
  MapPin,
  Package,
  Star,
  Truck,
  User,
} from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

/**
 * RideCard - Display ride/trip information
 *
 * Used in ride history, active rides, and driver matching screens.
 *
 * @example
 * <RideCard
 *   service="move"
 *   vehicleType="car"
 *   pickup={{ address: "123 Main St", time: "10:30 AM" }}
 *   dropoff={{ address: "456 Oak Ave" }}
 *   driver={{ name: "John D.", rating: 4.8 }}
 *   status="in-transit"
 *   fare="₦2,500"
 * />
 */

const rideCardVariants = cva(
  "rounded-xl border bg-card p-4 transition-shadow hover:shadow-md",
  {
    variants: {
      service: {
        move: "border-l-4 border-l-ubi-move",
        bites: "border-l-4 border-l-ubi-bites",
        send: "border-l-4 border-l-ubi-send",
        default: "border-l-4 border-l-primary",
      },
      interactive: {
        true: "cursor-pointer hover:bg-accent/50",
        false: "",
      },
    },
    defaultVariants: {
      service: "move",
      interactive: false,
    },
  },
);

const vehicleIcons = {
  car: Car,
  bike: Bike,
  truck: Truck,
  package: Package,
};

interface Location {
  address: string;
  time?: string;
}

interface Driver {
  name: string;
  rating?: number;
  avatar?: string;
  vehicleInfo?: string;
}

export interface RideCardProps
  extends
    Omit<React.HTMLAttributes<HTMLDivElement>, "onClick">,
    VariantProps<typeof rideCardVariants> {
  /** Service type */
  service?: "move" | "bites" | "send" | "default";
  /** Vehicle type for icon */
  vehicleType?: keyof typeof vehicleIcons;
  /** Pickup location */
  pickup: Location;
  /** Dropoff location */
  dropoff: Location;
  /** Driver info (optional) */
  driver?: Driver;
  /** Ride status */
  status?: string;
  /** Fare amount */
  fare?: string;
  /** Estimated time */
  eta?: string;
  /** Distance */
  distance?: string;
  /** Click handler */
  onClick?: () => void;
}

const RideCard = React.forwardRef<HTMLDivElement, RideCardProps>(
  (
    {
      className,
      service = "move",
      vehicleType = "car",
      pickup,
      dropoff,
      driver,
      status,
      fare,
      eta,
      distance,
      interactive,
      onClick,
      ...props
    },
    ref,
  ) => {
    const VehicleIcon = vehicleIcons[vehicleType];

    return (
      <div
        ref={ref}
        className={cn(
          rideCardVariants({ service, interactive: interactive || !!onClick }),
          className,
        )}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        {...props}
      >
        {/* Header with status and fare */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "p-1.5 rounded-lg",
                service === "move" && "bg-ubi-move/10 text-ubi-move",
                service === "bites" && "bg-ubi-bites/10 text-ubi-bites",
                service === "send" && "bg-ubi-send/10 text-ubi-send",
                service === "default" && "bg-primary/10 text-primary",
              )}
            >
              <VehicleIcon className="h-4 w-4" />
            </div>
            {status && (
              <span className="text-xs font-medium text-muted-foreground capitalize">
                {status.replace(/-/g, " ")}
              </span>
            )}
          </div>
          {fare && <span className="font-semibold">{fare}</span>}
        </div>

        {/* Locations */}
        <div className="space-y-2 mb-3">
          {/* Pickup */}
          <div className="flex items-start gap-2">
            <div className="flex flex-col items-center">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <div className="w-px h-4 bg-border" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{pickup.address}</p>
              {pickup.time && (
                <p className="text-xs text-muted-foreground">{pickup.time}</p>
              )}
            </div>
          </div>

          {/* Dropoff */}
          <div className="flex items-start gap-2">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{dropoff.address}</p>
              {dropoff.time && (
                <p className="text-xs text-muted-foreground">{dropoff.time}</p>
              )}
            </div>
          </div>
        </div>

        {/* Driver info or ETA */}
        {(driver || eta || distance) && (
          <div className="flex items-center justify-between pt-3 border-t">
            {driver ? (
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  {driver.avatar ? (
                    <img
                      src={driver.avatar}
                      alt=""
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    <User className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">{driver.name}</p>
                  {driver.rating && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {driver.rating.toFixed(1)}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {eta && (
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {eta}
                </div>
              )}
              {distance && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {distance}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);
RideCard.displayName = "RideCard";

export { RideCard, rideCardVariants };
