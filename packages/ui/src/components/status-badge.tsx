"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * StatusBadge - Visual indicator for entity status
 *
 * Used to show the status of rides, orders, deliveries, etc.
 *
 * @example
 * <StatusBadge status="active">Driver en route</StatusBadge>
 * <StatusBadge status="pending" pulse>Finding driver...</StatusBadge>
 * <StatusBadge status="completed">Delivered</StatusBadge>
 */

const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      status: {
        // General statuses
        active:
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
        pending:
          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        completed:
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
        cancelled:
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
        inactive:
          "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",

        // Ride-specific statuses
        "looking-for-driver":
          "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
        "driver-assigned":
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
        "driver-arrived": "bg-ubi-move/20 text-ubi-move",
        "in-transit": "bg-ubi-move/20 text-ubi-move",

        // Order statuses (Bites)
        "order-placed":
          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        preparing:
          "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
        "ready-for-pickup": "bg-ubi-bites/20 text-ubi-bites",
        "out-for-delivery": "bg-ubi-bites/20 text-ubi-bites",

        // Delivery statuses (Send)
        "pickup-scheduled":
          "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
        "picked-up": "bg-ubi-send/20 text-ubi-send",
        "in-delivery": "bg-ubi-send/20 text-ubi-send",
        delivered:
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",

        // Payment statuses
        "payment-pending":
          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        "payment-failed":
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
        "payment-completed":
          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
        refunded:
          "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
      },
      size: {
        sm: "text-[10px] px-2 py-px",
        md: "text-xs px-2.5 py-0.5",
        lg: "text-sm px-3 py-1",
      },
    },
    defaultVariants: {
      status: "active",
      size: "md",
    },
  },
);

// Status dot colors
const dotColors: Record<string, string> = {
  active: "bg-green-500",
  pending: "bg-amber-500",
  completed: "bg-blue-500",
  cancelled: "bg-red-500",
  inactive: "bg-gray-500",
  "looking-for-driver": "bg-purple-500",
  "driver-assigned": "bg-blue-500",
  "driver-arrived": "bg-ubi-move",
  "in-transit": "bg-ubi-move",
  "order-placed": "bg-amber-500",
  preparing: "bg-orange-500",
  "ready-for-pickup": "bg-ubi-bites",
  "out-for-delivery": "bg-ubi-bites",
  "pickup-scheduled": "bg-cyan-500",
  "picked-up": "bg-ubi-send",
  "in-delivery": "bg-ubi-send",
  delivered: "bg-green-500",
  "payment-pending": "bg-amber-500",
  "payment-failed": "bg-red-500",
  "payment-completed": "bg-green-500",
  refunded: "bg-gray-500",
};

export interface StatusBadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  /** Show pulsing dot for active states */
  pulse?: boolean;
  /** Show status dot */
  showDot?: boolean;
}

const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  (
    {
      className,
      status = "active",
      size,
      pulse,
      showDot = true,
      children,
      ...props
    },
    ref,
  ) => {
    const dotColor = status ? dotColors[status] : "bg-gray-500";

    return (
      <span
        ref={ref}
        className={cn(statusBadgeVariants({ status, size }), className)}
        {...props}
      >
        {showDot && (
          <span className="relative flex h-2 w-2">
            {pulse && (
              <span
                className={cn(
                  "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                  dotColor,
                )}
              />
            )}
            <span
              className={cn(
                "relative inline-flex rounded-full h-2 w-2",
                dotColor,
              )}
            />
          </span>
        )}
        {children}
      </span>
    );
  },
);
StatusBadge.displayName = "StatusBadge";

export { StatusBadge, statusBadgeVariants };
