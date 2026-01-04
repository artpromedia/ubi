"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * Divider - A visual separator primitive
 * 
 * Creates horizontal or vertical dividers between content.
 * 
 * @example
 * <Stack>
 *   <Item />
 *   <Divider />
 *   <Item />
 * </Stack>
 * 
 * <HStack>
 *   <Item />
 *   <Divider orientation="vertical" />
 *   <Item />
 * </HStack>
 */

const dividerVariants = cva("shrink-0 bg-border", {
  variants: {
    orientation: {
      horizontal: "h-px w-full",
      vertical: "w-px h-full min-h-[1rem]",
    },
    variant: {
      solid: "",
      dashed: "border-dashed",
      dotted: "border-dotted",
    },
    spacing: {
      none: "",
      xs: "",
      sm: "",
      md: "",
      lg: "",
      xl: "",
    },
  },
  compoundVariants: [
    { orientation: "horizontal", spacing: "xs", className: "my-1" },
    { orientation: "horizontal", spacing: "sm", className: "my-2" },
    { orientation: "horizontal", spacing: "md", className: "my-4" },
    { orientation: "horizontal", spacing: "lg", className: "my-6" },
    { orientation: "horizontal", spacing: "xl", className: "my-8" },
    { orientation: "vertical", spacing: "xs", className: "mx-1" },
    { orientation: "vertical", spacing: "sm", className: "mx-2" },
    { orientation: "vertical", spacing: "md", className: "mx-4" },
    { orientation: "vertical", spacing: "lg", className: "mx-6" },
    { orientation: "vertical", spacing: "xl", className: "mx-8" },
  ],
  defaultVariants: {
    orientation: "horizontal",
    variant: "solid",
    spacing: "none",
  },
});

export interface DividerProps
  extends React.HTMLAttributes<HTMLHRElement>,
    VariantProps<typeof dividerVariants> {
  /** Content to display in the middle of the divider */
  label?: React.ReactNode;
  /** Position of the label */
  labelPosition?: "start" | "center" | "end";
}

const Divider = React.forwardRef<HTMLHRElement, DividerProps>(
  ({ className, orientation, variant, spacing, label, labelPosition = "center", ...props }, ref) => {
    if (label && orientation !== "vertical") {
      return (
        <div
          className={cn(
            "flex items-center w-full",
            spacing === "xs" && "my-1",
            spacing === "sm" && "my-2",
            spacing === "md" && "my-4",
            spacing === "lg" && "my-6",
            spacing === "xl" && "my-8",
            className
          )}
        >
          <div
            className={cn(
              "h-px bg-border",
              labelPosition === "start" && "w-4",
              labelPosition === "center" && "flex-1",
              labelPosition === "end" && "flex-1"
            )}
          />
          <span className="px-3 text-sm text-muted-foreground">{label}</span>
          <div
            className={cn(
              "h-px bg-border",
              labelPosition === "start" && "flex-1",
              labelPosition === "center" && "flex-1",
              labelPosition === "end" && "w-4"
            )}
          />
        </div>
      );
    }

    return (
      <hr
        ref={ref}
        className={cn(dividerVariants({ orientation, variant, spacing }), className)}
        {...props}
      />
    );
  }
);
Divider.displayName = "Divider";

export { Divider, dividerVariants };
