"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * ButtonGroup - Group related buttons together
 * 
 * Provides visual grouping with connected borders.
 * 
 * @example
 * <ButtonGroup>
 *   <Button variant="outline">Left</Button>
 *   <Button variant="outline">Center</Button>
 *   <Button variant="outline">Right</Button>
 * </ButtonGroup>
 */

const buttonGroupVariants = cva(
  "inline-flex items-center",
  {
    variants: {
      orientation: {
        horizontal: "flex-row [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none [&>*:not(:first-child)]:-ml-px",
        vertical: "flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:last-child)]:rounded-b-none [&>*:not(:first-child)]:-mt-px",
      },
      attached: {
        true: "",
        false: "gap-2",
      },
    },
    compoundVariants: [
      {
        attached: false,
        orientation: "horizontal",
        className: "[&>*]:rounded-lg [&>*]:ml-0",
      },
      {
        attached: false,
        orientation: "vertical",
        className: "[&>*]:rounded-lg [&>*]:mt-0",
      },
    ],
    defaultVariants: {
      orientation: "horizontal",
      attached: true,
    },
  }
);

export interface ButtonGroupProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof buttonGroupVariants> {}

const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  ({ className, orientation, attached, ...props }, ref) => {
    return (
      <div
        ref={ref}
        role="group"
        className={cn(buttonGroupVariants({ orientation, attached }), className)}
        {...props}
      />
    );
  }
);
ButtonGroup.displayName = "ButtonGroup";

export { ButtonGroup, buttonGroupVariants };
