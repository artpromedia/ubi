"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * Icon - An icon wrapper primitive
 * 
 * Provides consistent sizing and accessibility for icons.
 * Works with lucide-react or any SVG icon.
 * 
 * @example
 * import { Car } from "lucide-react";
 * <Icon size="lg" color="primary"><Car /></Icon>
 * <Icon label="Settings"><Settings /></Icon>
 */

const iconVariants = cva("inline-flex items-center justify-center shrink-0", {
  variants: {
    size: {
      xs: "h-3 w-3",
      sm: "h-4 w-4",
      md: "h-5 w-5",
      lg: "h-6 w-6",
      xl: "h-8 w-8",
      "2xl": "h-10 w-10",
      "3xl": "h-12 w-12",
    },
    color: {
      inherit: "text-inherit",
      current: "text-current",
      default: "text-foreground",
      muted: "text-muted-foreground",
      primary: "text-primary",
      secondary: "text-secondary-foreground",
      success: "text-green-600 dark:text-green-400",
      warning: "text-amber-600 dark:text-amber-400",
      error: "text-red-600 dark:text-red-400",
      info: "text-blue-600 dark:text-blue-400",
      // Service colors
      move: "text-ubi-move",
      bites: "text-ubi-bites",
      send: "text-ubi-send",
    },
  },
  defaultVariants: {
    size: "md",
    color: "current",
  },
});

export interface IconProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof iconVariants> {
  /** Accessible label for screen readers */
  label?: string;
  /** Children should be an SVG icon element */
  children: React.ReactNode;
}

const Icon = React.forwardRef<HTMLSpanElement, IconProps>(
  ({ className, size, color, label, children, ...props }, ref) => {
    // Clone the child to apply size classes to the SVG
    const child = React.Children.only(children);
    const styledChild = React.isValidElement(child)
      ? React.cloneElement(child as React.ReactElement<{ className?: string }>, {
          className: cn("h-full w-full", (child.props as { className?: string }).className),
        })
      : children;

    return (
      <span
        ref={ref}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={!label}
        className={cn(iconVariants({ size, color }), className)}
        {...props}
      >
        {styledChild}
      </span>
    );
  }
);
Icon.displayName = "Icon";

export { Icon, iconVariants };
