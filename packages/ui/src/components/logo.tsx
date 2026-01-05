"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/**
 * Logo - UBI brand logo component
 *
 * @example
 * <Logo size="lg" />
 * <LogoIcon className="h-8 w-8" />
 */

export interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Show text alongside icon */
  showText?: boolean;
}

const sizeClasses = {
  sm: "h-6",
  md: "h-8",
  lg: "h-10",
  xl: "h-12",
};

const Logo = React.forwardRef<HTMLDivElement, LogoProps>(
  ({ className, size = "md", showText = true, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-2", className)}
        {...props}
      >
        <LogoIcon className={sizeClasses[size]} />
        {showText && (
          <span
            className={cn(
              "font-bold text-foreground",
              size === "sm" && "text-lg",
              size === "md" && "text-xl",
              size === "lg" && "text-2xl",
              size === "xl" && "text-3xl"
            )}
          >
            UBI
          </span>
        )}
      </div>
    );
  }
);
Logo.displayName = "Logo";

export interface LogoIconProps extends React.SVGAttributes<SVGSVGElement> {}

const LogoIcon = React.forwardRef<SVGSVGElement, LogoIconProps>(
  ({ className, ...props }, ref) => {
    return (
      <svg
        ref={ref}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("h-8 w-8", className)}
        {...props}
      >
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path
          d="M8 12V20C8 22.2091 9.79086 24 12 24H14C16.2091 24 18 22.2091 18 20V12"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M22 8V24"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
);
LogoIcon.displayName = "LogoIcon";

export { Logo, LogoIcon };
