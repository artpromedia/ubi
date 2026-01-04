/**
 * Status Indicator Component
 *
 * Visual status indicators for orders, rides, deliveries, etc.
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
    AlertCircle,
    Car,
    CheckCircle2,
    Circle,
    CircleDot,
    Clock,
    Loader2,
    MapPin,
    Package,
    Utensils,
    XCircle
} from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";

// Status dot indicator
const statusDotVariants = cva("rounded-full", {
  variants: {
    status: {
      pending: "bg-warning",
      active: "bg-success animate-pulse",
      completed: "bg-success",
      cancelled: "bg-destructive",
      error: "bg-destructive",
      inactive: "bg-muted-foreground",
      processing: "bg-primary animate-pulse",
    },
    size: {
      sm: "h-2 w-2",
      default: "h-2.5 w-2.5",
      lg: "h-3 w-3",
    },
  },
  defaultVariants: {
    status: "inactive",
    size: "default",
  },
});

interface StatusDotProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusDotVariants> {}

const StatusDot = ({ status, size, className, ...props }: StatusDotProps) => (
  <span className={cn(statusDotVariants({ status, size }), className)} {...props} />
);

// Status badge with icon
const statusBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      status: {
        pending: "bg-warning/10 text-warning border border-warning/20",
        active: "bg-success/10 text-success border border-success/20",
        completed: "bg-success/10 text-success border border-success/20",
        cancelled: "bg-destructive/10 text-destructive border border-destructive/20",
        error: "bg-destructive/10 text-destructive border border-destructive/20",
        inactive: "bg-muted text-muted-foreground border border-border",
        processing: "bg-primary/10 text-primary border border-primary/20",
      },
    },
    defaultVariants: {
      status: "inactive",
    },
  }
);

interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  label: string;
  showIcon?: boolean;
  icon?: React.ReactNode;
}

const StatusBadge = ({
  status,
  label,
  showIcon = true,
  icon,
  className,
  ...props
}: StatusBadgeProps) => {
  const defaultIcons: Record<string, React.ReactNode> = {
    pending: <Clock className="h-3 w-3" />,
    active: <CircleDot className="h-3 w-3" />,
    completed: <CheckCircle2 className="h-3 w-3" />,
    cancelled: <XCircle className="h-3 w-3" />,
    error: <AlertCircle className="h-3 w-3" />,
    inactive: <Circle className="h-3 w-3" />,
    processing: <Loader2 className="h-3 w-3 animate-spin" />,
  };

  const Icon = icon || (status ? defaultIcons[status] : null);

  return (
    <span className={cn(statusBadgeVariants({ status }), className)} {...props}>
      {showIcon && Icon}
      {label}
    </span>
  );
};

// Order/Delivery status timeline
interface TimelineStep {
  status: "completed" | "active" | "pending";
  label: string;
  description?: string;
  timestamp?: string;
  icon?: React.ReactNode;
}

interface StatusTimelineProps {
  steps: TimelineStep[];
  orientation?: "horizontal" | "vertical";
  className?: string;
}

const StatusTimeline = ({
  steps,
  orientation = "vertical",
  className,
}: StatusTimelineProps) => {
  const isVertical = orientation === "vertical";

  return (
    <div
      className={cn(
        "flex",
        isVertical ? "flex-col" : "flex-row justify-between",
        className
      )}
    >
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isCompleted = step.status === "completed";
        const isActive = step.status === "active";

        return (
          <div
            key={index}
            className={cn(
              "flex",
              isVertical ? "flex-row" : "flex-col items-center",
              !isLast && (isVertical ? "pb-8" : "flex-1")
            )}
          >
            {/* Icon/dot */}
            <div className="relative flex items-center justify-center">
              <div
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                  isCompleted && "border-success bg-success text-success-foreground",
                  isActive && "border-primary bg-primary text-primary-foreground",
                  step.status === "pending" &&
                    "border-muted-foreground/30 bg-background text-muted-foreground"
                )}
              >
                {step.icon || (
                  isCompleted ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : isActive ? (
                    <CircleDot className="h-4 w-4" />
                  ) : (
                    <Circle className="h-4 w-4" />
                  )
                )}
              </div>
              {/* Connector line */}
              {!isLast && (
                <div
                  className={cn(
                    "absolute bg-border",
                    isVertical
                      ? "left-1/2 top-full h-8 w-0.5 -translate-x-1/2"
                      : "left-full top-1/2 h-0.5 w-full -translate-y-1/2"
                  )}
                  style={{
                    backgroundColor: isCompleted
                      ? "hsl(var(--success))"
                      : undefined,
                  }}
                />
              )}
            </div>

            {/* Content */}
            <div
              className={cn(
                isVertical ? "ml-4" : "mt-2 text-center",
                "flex flex-col"
              )}
            >
              <span
                className={cn(
                  "text-sm font-medium",
                  step.status === "pending" && "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
              {step.description && (
                <span className="text-xs text-muted-foreground">
                  {step.description}
                </span>
              )}
              {step.timestamp && (
                <span className="text-xs text-muted-foreground">
                  {step.timestamp}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// UBI Service-specific status indicators
type UBIServiceType = "move" | "bites" | "send";

interface ServiceStatusProps {
  service: UBIServiceType;
  status: string;
  className?: string;
}

const serviceIcons: Record<UBIServiceType, React.ReactNode> = {
  move: <Car className="h-4 w-4" />,
  bites: <Utensils className="h-4 w-4" />,
  send: <Package className="h-4 w-4" />,
};

const serviceColors: Record<UBIServiceType, string> = {
  move: "bg-ubi-move/10 text-ubi-move border-ubi-move/20",
  bites: "bg-ubi-bites/10 text-ubi-bites border-ubi-bites/20",
  send: "bg-ubi-send/10 text-ubi-send border-ubi-send/20",
};

const ServiceStatus = ({ service, status, className }: ServiceStatusProps) => (
  <div
    className={cn(
      "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border",
      serviceColors[service],
      className
    )}
  >
    {serviceIcons[service]}
    <span className="capitalize">{status}</span>
  </div>
);

// Live location indicator
interface LiveLocationProps {
  isLive?: boolean;
  label?: string;
  className?: string;
}

const LiveLocation = ({
  isLive = true,
  label = "Live",
  className,
}: LiveLocationProps) => (
  <div
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
      isLive
        ? "bg-success/10 text-success"
        : "bg-muted text-muted-foreground",
      className
    )}
  >
    {isLive ? (
      <>
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
        </span>
        {label}
      </>
    ) : (
      <>
        <MapPin className="h-3 w-3" />
        Last known location
      </>
    )}
  </div>
);

export {
    LiveLocation, ServiceStatus, StatusBadge, statusBadgeVariants, StatusDot, statusDotVariants, StatusTimeline, type TimelineStep,
    type UBIServiceType
};

