"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/**
 * Logo - UBI brand logo component
 *
 * @example
 * <Logo size="lg" />
 * <Logo size={32} />
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

const sizeClasses: Record<string, string> = {
  sm: "h-6",
  md: "h-8",
  lg: "h-10",
  xl: "h-12",
};

const Logo = React.forwardRef<HTMLDivElement, LogoProps>(
  (
    { className, size = "md", showText = true, variant = "default", ...props },
    ref
  ) => {
    const isNumeric = typeof size === "number";
    const iconSizeClass = isNumeric ? undefined : sizeClasses[size as string];
    const iconStyle = isNumeric ? { height: size, width: size } : undefined;

    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-2", className)}
        {...props}
      >
        <LogoIcon
          className={iconSizeClass}
          style={iconStyle}
          variant={variant}
        />
        {showText && (
          <span
            className={cn(
              "font-bold",
              variant === "white" ? "text-white" : "text-foreground",
              !isNumeric && size === "sm" && "text-lg",
              !isNumeric && size === "md" && "text-xl",
              !isNumeric && size === "lg" && "text-2xl",
              !isNumeric && size === "xl" && "text-3xl",
              isNumeric && "text-xl"
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

export interface LogoIconProps extends React.SVGAttributes<SVGSVGElement> {
  /** Size in pixels */
  size?: number;
  /** Color variant for dark mode */
  variant?: "default" | "white";
}

const LogoIcon = React.forwardRef<SVGSVGElement, LogoIconProps>(
  ({ className, size, variant = "default", style, ...props }, ref) => {
    const sizeStyle = size ? { height: size, width: size, ...style } : style;
    const fillClass = variant === "white" ? "fill-white" : "fill-primary";
    const strokeColor = variant === "white" ? "#191414" : "white";

    return (
      <svg
        ref={ref}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(size ? undefined : "h-8 w-8", className)}
        style={sizeStyle}
        {...props}
      >
        <rect width="32" height="32" rx="8" className={fillClass} />
        <path
          d="M8 12V20C8 22.2091 9.79086 24 12 24H14C16.2091 24 18 22.2091 18 20V12"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M22 8V24"
          stroke={strokeColor}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
);
LogoIcon.displayName = "LogoIcon";

// Alias for brand consistency
const UbiLogo = Logo;
const UbiIcon = LogoIcon;

export { Logo, LogoIcon, UbiIcon, UbiLogo };
