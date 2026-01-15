"use client";

import { Check, Circle, Clock } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

/**
 * TripTimeline - Visual timeline for ride/delivery progress
 *
 * @example
 * <TripTimeline
 *   steps={[
 *     { status: "completed", label: "Ride requested", time: "10:30 AM" },
 *     { status: "completed", label: "Driver assigned", time: "10:32 AM" },
 *     { status: "current", label: "Driver en route", eta: "3 min" },
 *     { status: "upcoming", label: "Pickup" },
 *     { status: "upcoming", label: "Drop-off" },
 *   ]}
 * />
 */

interface TimelineStep {
  status: "completed" | "current" | "upcoming" | "error";
  label: string;
  description?: string;
  time?: string;
  eta?: string;
}

export interface TripTimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: TimelineStep[];
  variant?: "vertical" | "horizontal";
  service?: "move" | "bites" | "send";
}

const serviceColors = {
  move: {
    completed: "bg-ubi-move",
    current: "bg-ubi-move",
    line: "bg-ubi-move",
  },
  bites: {
    completed: "bg-ubi-bites",
    current: "bg-ubi-bites",
    line: "bg-ubi-bites",
  },
  send: {
    completed: "bg-ubi-send",
    current: "bg-ubi-send",
    line: "bg-ubi-send",
  },
};

const TripTimeline = React.forwardRef<HTMLDivElement, TripTimelineProps>(
  (
    { className, steps, variant = "vertical", service = "move", ...props },
    ref,
  ) => {
    const colors = serviceColors[service];

    if (variant === "horizontal") {
      return (
        <div
          ref={ref}
          className={cn("flex items-center w-full", className)}
          {...props}
        >
          {steps.map((step, index) => (
            <React.Fragment key={index}>
              {/* Step indicator */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full transition-colors",
                    step.status === "completed" && colors.completed,
                    step.status === "current" &&
                      cn(
                        "ring-4 ring-offset-2",
                        colors.current,
                        `ring-${service === "move" ? "ubi-move" : service === "bites" ? "ubi-bites" : "ubi-send"}/20`,
                      ),
                    step.status === "upcoming" && "bg-muted",
                    step.status === "error" && "bg-destructive",
                  )}
                >
                  {step.status === "completed" ? (
                    <Check className="h-4 w-4 text-white" />
                  ) : step.status === "current" ? (
                    <Circle className="h-3 w-3 text-white fill-white animate-pulse" />
                  ) : (
                    <Circle className="h-3 w-3 text-muted-foreground" />
                  )}
                </div>
                <span
                  className={cn(
                    "mt-2 text-xs text-center max-w-[80px]",
                    step.status === "current"
                      ? "font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
                {step.eta && step.status === "current" && (
                  <span className="text-xs text-muted-foreground">
                    {step.eta}
                  </span>
                )}
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div className="flex-1 h-0.5 mx-2">
                  <div
                    className={cn(
                      "h-full transition-all",
                      step.status === "completed" ? colors.line : "bg-muted",
                    )}
                  />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      );
    }

    // Vertical variant (default)
    return (
      <div ref={ref} className={cn("flex flex-col", className)} {...props}>
        {steps.map((step, index) => (
          <div key={index} className="flex gap-3">
            {/* Timeline indicator */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "flex items-center justify-center w-6 h-6 rounded-full transition-colors shrink-0",
                  step.status === "completed" && colors.completed,
                  step.status === "current" &&
                    cn(
                      "ring-4 ring-offset-2",
                      colors.current,
                      `ring-${service === "move" ? "ubi-move" : service === "bites" ? "ubi-bites" : "ubi-send"}/20`,
                    ),
                  step.status === "upcoming" &&
                    "bg-muted border-2 border-muted-foreground/20",
                  step.status === "error" && "bg-destructive",
                )}
              >
                {step.status === "completed" ? (
                  <Check className="h-3.5 w-3.5 text-white" />
                ) : step.status === "current" ? (
                  <div className="h-2 w-2 rounded-full bg-white animate-pulse" />
                ) : step.status === "error" ? (
                  <span className="text-white text-xs">!</span>
                ) : null}
              </div>

              {/* Connector line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "w-0.5 flex-1 min-h-[24px]",
                    step.status === "completed" ? colors.line : "bg-muted",
                  )}
                />
              )}
            </div>

            {/* Content */}
            <div className={cn("pb-4", index === steps.length - 1 && "pb-0")}>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-medium text-sm",
                    step.status === "upcoming" && "text-muted-foreground",
                    step.status === "error" && "text-destructive",
                  )}
                >
                  {step.label}
                </span>
                {step.time && (
                  <span className="text-xs text-muted-foreground">
                    {step.time}
                  </span>
                )}
                {step.eta && step.status === "current" && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {step.eta}
                  </span>
                )}
              </div>
              {step.description && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {step.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  },
);
TripTimeline.displayName = "TripTimeline";

export { TripTimeline };
export type { TimelineStep };
