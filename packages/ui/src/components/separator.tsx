/**
 * Separator Component
 *
 * Visual divider between content sections.
 */

"use client";

import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as React from "react";
import { cn } from "../lib/utils";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> & {
    /** Label to show in the middle of the separator */
    label?: string;
  }
>(({ className, orientation = "horizontal", decorative = true, label, ...props }, ref) => {
  if (label) {
    return (
      <div
        className={cn(
          "flex items-center",
          orientation === "horizontal" ? "w-full" : "flex-col h-full",
          className
        )}
      >
        <SeparatorPrimitive.Root
          ref={ref}
          decorative={decorative}
          orientation={orientation}
          className={cn(
            "shrink-0 bg-border",
            orientation === "horizontal" ? "h-[1px] flex-1" : "w-[1px] flex-1"
          )}
          {...props}
        />
        <span className="px-3 text-xs text-muted-foreground">{label}</span>
        <SeparatorPrimitive.Root
          decorative={decorative}
          orientation={orientation}
          className={cn(
            "shrink-0 bg-border",
            orientation === "horizontal" ? "h-[1px] flex-1" : "w-[1px] flex-1"
          )}
        />
      </div>
    );
  }

  return (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  );
});
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
