/**
 * Badge Component
 *
 * Small labels for status, categories, and counts.
 */

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        // UBI Service badges
        move: "border-transparent bg-ubi-move text-white",
        bites: "border-transparent bg-ubi-bites text-white",
        send: "border-transparent bg-ubi-teal-500 text-white",
        // Status badges
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/10 text-warning",
        error: "border-transparent bg-error/10 text-error",
        info: "border-transparent bg-info/10 text-info",
        // Subtle variants
        "default-subtle": "border-transparent bg-primary/10 text-primary",
        "secondary-subtle": "border-transparent bg-secondary/10 text-secondary",
      },
      size: {
        sm: "h-5 text-[10px] px-2",
        md: "h-6 text-xs px-2.5",
        lg: "h-7 text-sm px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  /** Optional icon to show before text */
  icon?: React.ReactNode;
  /** Show a dot indicator */
  dot?: boolean;
  /** Dot color override */
  dotColor?: string;
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  (
    { className, variant, size, icon, dot, dotColor, children, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "mr-1.5 h-1.5 w-1.5 rounded-full",
            dotColor || "bg-current",
          )}
          style={dotColor ? { backgroundColor: dotColor } : undefined}
        />
      )}
      {icon && <span className="mr-1">{icon}</span>}
      {children}
    </div>
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
