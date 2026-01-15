/**
 * Progress Component
 *
 * Linear and circular progress indicators.
 */

"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import * as React from "react";

import { cn } from "../lib/utils";

export interface ProgressProps
  extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Color variant */
  variant?: "default" | "success" | "warning" | "error";
  /** Show percentage label */
  showLabel?: boolean;
  /** Indeterminate loading state */
  indeterminate?: boolean;
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, size = "md", variant = "default", showLabel, indeterminate, ...props }, ref) => (
  <div className="relative">
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-secondary",
        {
          "h-1": size === "sm",
          "h-2": size === "md",
          "h-4": size === "lg",
        },
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full transition-all",
          {
            "bg-primary": variant === "default",
            "bg-success": variant === "success",
            "bg-warning": variant === "warning",
            "bg-error": variant === "error",
          },
          indeterminate && "animate-shimmer bg-gradient-to-r from-primary/50 via-primary to-primary/50 bg-[length:200%_100%]"
        )}
        style={{ 
          transform: indeterminate ? "translateX(0)" : `translateX(-${100 - (value || 0)}%)` 
        }}
      />
    </ProgressPrimitive.Root>
    {showLabel && !indeterminate && (
      <span className="absolute right-0 top-1/2 -translate-y-1/2 text-xs text-muted-foreground ml-2">
        {Math.round(value || 0)}%
      </span>
    )}
  </div>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

/**
 * Circular Progress Component
 */
export interface CircularProgressProps extends React.SVGAttributes<SVGSVGElement> {
  /** Progress value (0-100) */
  value?: number;
  /** Size in pixels */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
  /** Color variant */
  variant?: "default" | "success" | "warning" | "error";
  /** Indeterminate loading state */
  indeterminate?: boolean;
  /** Show percentage label */
  showLabel?: boolean;
}

const CircularProgress = React.forwardRef<SVGSVGElement, CircularProgressProps>(
  (
    {
      value = 0,
      size = 40,
      strokeWidth = 4,
      variant = "default",
      indeterminate,
      showLabel,
      className,
      ...props
    },
    ref
  ) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = radius * 2 * Math.PI;
    const offset = circumference - (value / 100) * circumference;

    const colorMap = {
      default: "stroke-primary",
      success: "stroke-success",
      warning: "stroke-warning",
      error: "stroke-error",
    };

    return (
      <div className="relative inline-flex items-center justify-center">
        <svg
          ref={ref}
          className={cn(
            indeterminate && "animate-spin-slow",
            className
          )}
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          {...props}
        >
          {/* Background circle */}
          <circle
            className="stroke-secondary"
            strokeWidth={strokeWidth}
            fill="none"
            cx={size / 2}
            cy={size / 2}
            r={radius}
          />
          {/* Progress circle */}
          <circle
            className={cn(
              colorMap[variant],
              "transition-all duration-300 ease-in-out"
            )}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: indeterminate ? circumference * 0.75 : offset,
              transformOrigin: "50% 50%",
              transform: "rotate(-90deg)",
            }}
          />
        </svg>
        {showLabel && !indeterminate && (
          <span className="absolute text-xs font-medium">
            {Math.round(value)}%
          </span>
        )}
      </div>
    );
  }
);
CircularProgress.displayName = "CircularProgress";

export { CircularProgress, Progress };

