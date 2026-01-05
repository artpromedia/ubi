"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { Input } from "./input";

/**
 * LocationInput - Input for location/address with icon
 *
 * @example
 * <LocationInput
 *   label="Pickup"
 *   placeholder="Enter pickup location"
 *   variant="pickup"
 * />
 * <LocationInput
 *   label="Dropoff"
 *   placeholder="Where to?"
 *   variant="dropoff"
 * />
 */

export interface LocationInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Label text */
  label?: string;
  /** Variant determines the icon color */
  variant?: "pickup" | "dropoff" | "stop";
  /** Error message */
  error?: string;
  /** Show loading state */
  loading?: boolean;
}

const variantColors = {
  pickup: "bg-green-500",
  dropoff: "bg-red-500",
  stop: "bg-blue-500",
};

const LocationInput = React.forwardRef<HTMLInputElement, LocationInputProps>(
  (
    {
      className,
      label,
      variant = "pickup",
      error,
      loading = false,
      ...props
    },
    ref
  ) => {
    return (
      <div className="w-full">
        {label && (
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            {label}
          </label>
        )}
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                variantColors[variant]
              )}
            />
          </div>
          <Input
            ref={ref}
            type="text"
            className={cn(
              "pl-8 pr-8",
              error && "border-destructive focus-visible:ring-destructive",
              className
            )}
            {...props}
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg
                className="animate-spin h-4 w-4 text-muted-foreground"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            </div>
          )}
        </div>
        {error && (
          <p className="text-xs text-destructive mt-1">{error}</p>
        )}
      </div>
    );
  }
);
LocationInput.displayName = "LocationInput";

export { LocationInput };
