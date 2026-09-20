"use client";

import * as React from "react";

import { cn } from "../../lib/utils";

/**
 * DriverMarker - Map marker for driver/vehicle position
 *
 * Used on maps to show driver location with rotation support.
 *
 * @example
 * <DriverMarker
 *   type="car"
 *   heading={45}
 *   status="available"
 *   onClick={() => selectDriver(id)}
 * />
 */

export interface DriverMarkerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Vehicle type */
  type?: "car" | "bike" | "truck";
  /** Heading angle in degrees (0-360, 0 = North) */
  heading?: number;
  /** Driver status */
  status?: "available" | "busy" | "offline";
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show pulse animation */
  pulse?: boolean;
  /** Service type for color */
  service?: "move" | "bites" | "send";
}

const statusColors = {
  available: "bg-green-500",
  busy: "bg-amber-500",
  offline: "bg-gray-400",
};

const serviceColors = {
  move: "bg-ubi-move text-white",
  bites: "bg-ubi-bites text-white",
  send: "bg-ubi-send text-white",
};

const sizeClasses = {
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
};

const iconSizes = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

// SVG icons for vehicles
const VehicleIcons = {
  car: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z" />
    </svg>
  ),
  bike: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M15.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM5 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5zm5.8-10l2.4-2.4.8.8c1.3 1.3 3 2.1 5.1 2.1V9c-1.5 0-2.7-.6-3.6-1.5l-1.9-1.9c-.5-.4-1-.6-1.6-.6s-1.1.2-1.4.6L7.8 8.4c-.4.4-.6.9-.6 1.4 0 .6.2 1.1.6 1.4L11 14v5h2v-6.2l-2.2-2.3zM19 12c-2.8 0-5 2.2-5 5s2.2 5 5 5 5-2.2 5-5-2.2-5-5-5zm0 8.5c-1.9 0-3.5-1.6-3.5-3.5s1.6-3.5 3.5-3.5 3.5 1.6 3.5 3.5-1.6 3.5-3.5 3.5z" />
    </svg>
  ),
  truck: (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
    </svg>
  ),
};

const DriverMarker = React.forwardRef<HTMLDivElement, DriverMarkerProps>(
  (
    {
      className,
      type = "car",
      heading = 0,
      status = "available",
      size = "md",
      pulse,
      service = "move",
      onClick,
      ...props
    },
    ref,
  ) => {
    const Icon = VehicleIcons[type];

    return (
      <div
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center",
          className,
        )}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        {...props}
      >
        {/* Pulse effect */}
        {pulse && (
          <span
            className={cn(
              "absolute inset-0 rounded-full animate-ping opacity-75",
              serviceColors[service],
            )}
          />
        )}

        {/* Marker background */}
        <div
          className={cn(
            "relative rounded-full shadow-lg flex items-center justify-center transition-transform",
            sizeClasses[size],
            serviceColors[service],
            onClick && "cursor-pointer hover:scale-110",
          )}
        >
          {/* Vehicle icon with rotation */}
          <Icon
            className={iconSizes[size]}
            style={{ transform: `rotate(${heading}deg)` }}
          />
        </div>

        {/* Status indicator */}
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white",
            statusColors[status],
            size === "sm" ? "w-2 h-2" : "w-3 h-3",
          )}
        />
      </div>
    );
  },
);
DriverMarker.displayName = "DriverMarker";

/**
 * LocationMarker - Map marker for pickup/dropoff locations
 */

export interface LocationMarkerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Marker type */
  type: "pickup" | "dropoff" | "stop";
  /** Label text */
  label?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

const markerColors = {
  pickup: "bg-green-500",
  dropoff: "bg-red-500",
  stop: "bg-blue-500",
};

const LocationMarker = React.forwardRef<HTMLDivElement, LocationMarkerProps>(
  ({ className, type, label, size = "md", onClick, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("relative inline-flex flex-col items-center", className)}
        onClick={onClick}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        {...props}
      >
        {/* Label */}
        {label && (
          <span className="mb-1 px-2 py-0.5 rounded bg-background/90 text-xs font-medium shadow-sm whitespace-nowrap">
            {label}
          </span>
        )}

        {/* Marker pin */}
        <svg
          className={cn(
            "drop-shadow-md",
            size === "sm" && "w-6 h-8",
            size === "md" && "w-8 h-10",
            size === "lg" && "w-10 h-12",
          )}
          viewBox="0 0 24 32"
          fill="none"
        >
          <path
            d="M12 0C5.373 0 0 5.373 0 12c0 9 12 20 12 20s12-11 12-20c0-6.627-5.373-12-12-12z"
            className={cn(markerColors[type], "[fill:currentColor]")}
          />
          <circle cx="12" cy="12" r="4" fill="white" />
        </svg>
      </div>
    );
  },
);
LocationMarker.displayName = "LocationMarker";

export { DriverMarker, LocationMarker };
