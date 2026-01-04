"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * Spacer - A flexible spacing primitive
 * 
 * Creates space between flex/grid items.
 * In flex containers, expands to fill available space.
 * 
 * @example
 * <HStack>
 *   <Logo />
 *   <Spacer />
 *   <Button>Login</Button>
 * </HStack>
 */

const spacerVariants = cva("", {
  variants: {
    axis: {
      horizontal: "w-full",
      vertical: "h-full",
      both: "flex-1",
    },
    size: {
      auto: "", // Uses flex-grow
      xs: "", // 4px
      sm: "", // 8px
      md: "", // 16px
      lg: "", // 24px
      xl: "", // 32px
      "2xl": "", // 48px
    },
  },
  compoundVariants: [
    { axis: "horizontal", size: "xs", className: "min-w-1" },
    { axis: "horizontal", size: "sm", className: "min-w-2" },
    { axis: "horizontal", size: "md", className: "min-w-4" },
    { axis: "horizontal", size: "lg", className: "min-w-6" },
    { axis: "horizontal", size: "xl", className: "min-w-8" },
    { axis: "horizontal", size: "2xl", className: "min-w-12" },
    { axis: "vertical", size: "xs", className: "min-h-1" },
    { axis: "vertical", size: "sm", className: "min-h-2" },
    { axis: "vertical", size: "md", className: "min-h-4" },
    { axis: "vertical", size: "lg", className: "min-h-6" },
    { axis: "vertical", size: "xl", className: "min-h-8" },
    { axis: "vertical", size: "2xl", className: "min-h-12" },
  ],
  defaultVariants: {
    axis: "both",
    size: "auto",
  },
});

export interface SpacerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof spacerVariants> {}

const Spacer = React.forwardRef<HTMLDivElement, SpacerProps>(
  ({ className, axis, size, ...props }, ref) => {
    return (
      <div
        ref={ref}
        aria-hidden="true"
        className={cn(
          "flex-grow flex-shrink-0",
          spacerVariants({ axis, size }),
          className
        )}
        {...props}
      />
    );
  }
);
Spacer.displayName = "Spacer";

export { Spacer, spacerVariants };
