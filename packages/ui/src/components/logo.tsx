"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/**
 * Logo - UBI brand logo component (Official Bouncy Wordmark)
 *
 * The UBI logo features a playful "bouncy" design:
 * - U sits lower
 * - b bounces up
 * - i bounces down with a green dot (#1DB954)
 *
 * @example
 * <Logo size="lg" />
 * <LogoIcon className="h-8 w-8" />
 */

export interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Color variant */
  variant?: "default" | "white";
}

const sizeMap = {
  sm: { width: 60, height: 30 },
  md: { width: 80, height: 40 },
  lg: { width: 120, height: 60 },
  xl: { width: 160, height: 80 },
};

const Logo = React.forwardRef<HTMLDivElement, LogoProps>(
  ({ className, size = "md", variant = "default", ...props }, ref) => {
    const { width, height } = sizeMap[size];
    const strokeColor = variant === "white" ? "#FFFFFF" : "#191414";

    return (
      <div ref={ref} className={cn("flex items-center", className)} {...props}>
        <svg
          width={width}
          height={height}
          viewBox="0 0 120 60"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* U - sitting lower */}
          <path
            d="M8 18 L8 42 Q8 54 20 54 Q32 54 32 42 L32 18"
            stroke={strokeColor}
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          {/* b - bounced up */}
          <path
            d="M46 4 L46 44 M46 26 Q46 18 56 18 Q68 18 68 31 Q68 44 56 44 Q46 44 46 36"
            stroke={strokeColor}
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* i - bounced down */}
          <line
            x1="84"
            y1="24"
            x2="84"
            y2="52"
            stroke={strokeColor}
            strokeWidth="9"
            strokeLinecap="round"
          />
          {/* Green dot - UBI brand accent */}
          <circle cx="84" cy="12" r="6" fill="#1DB954" />
        </svg>
      </div>
    );
  },
);
Logo.displayName = "Logo";

export interface LogoIconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Color variant */
  variant?: "default" | "white";
}

/**
 * LogoIcon - Compact UBI icon (stylized U with green dot)
 * Used for app icons, favicons, and compact spaces
 */
const LogoIcon = React.forwardRef<SVGSVGElement, LogoIconProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const strokeColor = variant === "white" ? "#FFFFFF" : "#191414";

    return (
      <svg
        ref={ref}
        viewBox="0 0 60 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("h-8 w-8", className)}
        {...props}
      >
        {/* Stylized U with bounce */}
        <path
          d="M15 12 L15 38 Q15 52 30 52 Q45 52 45 38 L45 12"
          stroke={strokeColor}
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />
        {/* Green dot accent */}
        <circle cx="45" cy="8" r="6" fill="#1DB954" />
      </svg>
    );
  },
);
LogoIcon.displayName = "LogoIcon";

export { Logo, LogoIcon };
