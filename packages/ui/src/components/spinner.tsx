/**
 * Spinner Component
 *
 * Loading spinner with multiple variants.
 */

import * as React from "react";

import { cn } from "../lib/utils";

export interface SpinnerProps extends React.SVGAttributes<SVGSVGElement> {
  /** Size variant */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Color variant */
  variant?: "default" | "primary" | "secondary" | "white";
}

const sizeMap = {
  xs: "h-3 w-3",
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
  xl: "h-12 w-12",
};

const colorMap = {
  default: "text-muted-foreground",
  primary: "text-primary",
  secondary: "text-secondary",
  white: "text-white",
};

const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, size = "md", variant = "default", ...props }, ref) => {
    return (
      <svg
        ref={ref}
        className={cn("animate-spin", sizeMap[size], colorMap[variant], className)}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        {...props}
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
    );
  }
);
Spinner.displayName = "Spinner";

/**
 * Dots Spinner - Three bouncing dots
 */
export interface DotsSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Color variant */
  variant?: "default" | "primary" | "secondary";
}

const DotsSpinner = React.forwardRef<HTMLDivElement, DotsSpinnerProps>(
  ({ className, size = "md", variant = "default", ...props }, ref) => {
    const dotSizeMap = {
      sm: "h-1.5 w-1.5",
      md: "h-2 w-2",
      lg: "h-3 w-3",
    };

    const dotColorMap = {
      default: "bg-muted-foreground",
      primary: "bg-primary",
      secondary: "bg-secondary",
    };

    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-1", className)}
        {...props}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={cn(
              "rounded-full animate-bounce",
              dotSizeMap[size],
              dotColorMap[variant]
            )}
            style={{
              animationDelay: `${i * 0.15}s`,
              animationDuration: "0.6s",
            }}
          />
        ))}
      </div>
    );
  }
);
DotsSpinner.displayName = "DotsSpinner";

/**
 * Pulse Spinner - Pulsing circle
 */
export interface PulseSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Color variant */
  variant?: "default" | "primary" | "secondary";
}

const PulseSpinner = React.forwardRef<HTMLDivElement, PulseSpinnerProps>(
  ({ className, size = "md", variant = "default", ...props }, ref) => {
    const sizeMap = {
      sm: "h-4 w-4",
      md: "h-8 w-8",
      lg: "h-12 w-12",
    };

    const colorMap = {
      default: "bg-muted-foreground",
      primary: "bg-primary",
      secondary: "bg-secondary",
    };

    return (
      <div ref={ref} className={cn("relative", sizeMap[size], className)} {...props}>
        <div
          className={cn(
            "absolute inset-0 rounded-full opacity-75 animate-ping",
            colorMap[variant]
          )}
        />
        <div className={cn("relative rounded-full", sizeMap[size], colorMap[variant])} />
      </div>
    );
  }
);
PulseSpinner.displayName = "PulseSpinner";

export { DotsSpinner, PulseSpinner, Spinner };

