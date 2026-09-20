"use client";

import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { Card, CardContent } from "./card";
import { cn } from "../lib/utils";

/**
 * DriverCard - Display driver information
 *
 * @example
 * <DriverCard
 *   name="John Doe"
 *   rating={4.8}
 *   vehicleModel="Toyota Camry"
 *   vehiclePlate="ABC 123"
 *   avatarUrl="/driver.jpg"
 * />
 */

export interface DriverCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Driver name */
  name: string;
  /** Driver rating (0-5) */
  rating?: number;
  /** Total trips completed */
  totalTrips?: number;
  /** Vehicle model */
  vehicleModel?: string;
  /** Vehicle license plate */
  vehiclePlate?: string;
  /** Vehicle color */
  vehicleColor?: string;
  /** Avatar image URL */
  avatarUrl?: string;
  /** Phone number (for contact) */
  phone?: string;
  /** Show compact version */
  compact?: boolean;
}

const DriverCard = React.forwardRef<HTMLDivElement, DriverCardProps>(
  (
    {
      className,
      name,
      rating,
      totalTrips,
      vehicleModel,
      vehiclePlate,
      vehicleColor,
      avatarUrl,
      phone: _phone,
      compact = false,
      ...props
    },
    ref,
  ) => {
    const initials = name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    if (compact) {
      return (
        <div
          ref={ref}
          className={cn("flex items-center gap-3", className)}
          {...props}
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatarUrl} alt={name} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{name}</p>
            {rating !== undefined && (
              <div className="flex items-center gap-1">
                <svg
                  className="h-3 w-3 fill-yellow-400 text-yellow-400"
                  viewBox="0 0 20 20"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="text-xs text-muted-foreground">
                  {rating.toFixed(1)}
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <Card ref={ref} className={cn("w-full", className)} {...props}>
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <Avatar className="h-14 w-14">
              <AvatarImage src={avatarUrl} alt={name} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold truncate">{name}</h3>
                {rating !== undefined && (
                  <div className="flex items-center gap-1">
                    <svg
                      className="h-4 w-4 fill-yellow-400 text-yellow-400"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span className="text-sm font-medium">
                      {rating.toFixed(1)}
                    </span>
                    {totalTrips && (
                      <span className="text-xs text-muted-foreground">
                        ({totalTrips} trips)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {vehicleModel && (
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {vehicleColor && `${vehicleColor} `}
                    {vehicleModel}
                  </p>
                  {vehiclePlate && (
                    <p className="text-sm font-mono font-medium bg-muted px-2 py-0.5 rounded inline-block">
                      {vehiclePlate}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  },
);
DriverCard.displayName = "DriverCard";

export { DriverCard };
