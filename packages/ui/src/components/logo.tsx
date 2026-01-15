"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Logo - UBI brand logo component (Bouncy wordmark)
 *
 * The UBI logo features a bouncy wordmark where:
 * - U sits lower
 * - b bounces up
 * - i bounces down with a green dot
 *
 * @example
 * <Logo size="lg" />
 * <UbiLogo size={32} />
 * <LogoIcon className="h-8 w-8" />
 */

export interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size variant or pixel number */
  size?: "sm" | "md" | "lg" | "xl" | number;
  /** Show text alongside icon */
  showText?: boolean;
  /** Color variant for dark mode */
  variant?: "default" | "white";
}

const Logo = React.forwardRef<HTMLDivElement, LogoProps>(
  (
    {
      className,
      size = "md",
      showText: _showText = true,
      variant = "default",
      ...props
    },
    ref
  ) => {
    const isNumeric = typeof size === "number";

    // Calculate SVG height based on size
    const getHeight = () => {
      if (isNumeric) {return size as number;}
      switch (size) {
        case "sm":
          return 24;
        case "md":
          return 32;
        case "lg":
          return 40;
        case "xl":
          return 48;
        default:
          return 32;
      }
    };

    const height = getHeight();
    // Logo aspect ratio is 2:1 (width:height)
    const width = height * 2;

    const strokeColor = variant === "white" ? "#FFFFFF" : "#191414";
    const dotColor = "#1DB954"; // UBI Green

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
          {/* Green dot */}
          <circle cx="84" cy="12" r="6" fill={dotColor} />
        </svg>
      </div>
    );
  }
);
Logo.displayName = "Logo";

export interface LogoIconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Size in pixels */
  size?: number;
  /** Color variant for dark mode */
  variant?: "default" | "white";
}

/**
 * LogoIcon - UBI app icon (stylized "U" with green dot)
 */
const LogoIcon = React.forwardRef<SVGSVGElement, LogoIconProps>(
  ({ className, size = 32, variant = "default", style, ...props }, ref) => {
    const sizeStyle = { height: size, width: size, ...style };
    const strokeColor = variant === "white" ? "#FFFFFF" : "#191414";
    const dotColor = "#1DB954"; // UBI Green

    return (
      <svg
        ref={ref}
        viewBox="0 0 60 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={sizeStyle}
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
        <circle cx="45" cy="8" r="6" fill={dotColor} />
      </svg>
    );
  }
);
LogoIcon.displayName = "LogoIcon";

/**
 * UbiLogo - Full bouncy wordmark logo
 */
export interface UbiLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Height in pixels */
  size?: number;
  /** Color variant */
  variant?: "default" | "white";
}

const UbiLogo = React.forwardRef<HTMLDivElement, UbiLogoProps>(
  ({ className, size = 32, variant = "default", ...props }, ref) => {
    const width = size * 2;
    const strokeColor = variant === "white" ? "#FFFFFF" : "#191414";
    const dotColor = "#1DB954";

    return (
      <div ref={ref} className={cn("flex items-center", className)} {...props}>
        <svg
          width={width}
          height={size}
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
          {/* Green dot */}
          <circle cx="84" cy="12" r="6" fill={dotColor} />
        </svg>
      </div>
    );
  }
);
UbiLogo.displayName = "UbiLogo";

/**
 * UbiIcon - App icon with stylized U and green dot
 */
const UbiIcon = React.forwardRef<SVGSVGElement, LogoIconProps>(
  ({ className, size = 32, variant = "default", style, ...props }, ref) => {
    const sizeStyle = { height: size, width: size, ...style };
    const strokeColor = variant === "white" ? "#FFFFFF" : "#191414";
    const dotColor = "#1DB954";

    return (
      <svg
        ref={ref}
        viewBox="0 0 60 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={sizeStyle}
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
        <circle cx="45" cy="8" r="6" fill={dotColor} />
      </svg>
    );
  }
);
UbiIcon.displayName = "UbiIcon";

export { Logo, LogoIcon, UbiIcon, UbiLogo };
