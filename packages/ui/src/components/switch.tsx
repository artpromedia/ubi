/**
 * Switch Component
 *
 * Toggle switch for boolean settings.
 */

"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "../lib/utils";

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Label text */
  label?: string;
  /** Description text */
  description?: string;
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, size = "md", label, description, ...props }, ref) => {
  const switchElement = (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        {
          "h-4 w-7": size === "sm",
          "h-6 w-11": size === "md",
          "h-7 w-14": size === "lg",
        },
        className
      )}
      {...props}
      ref={ref}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-lg ring-0 transition-transform",
          "data-[state=checked]:translate-x-full data-[state=unchecked]:translate-x-0",
          {
            "h-3 w-3 data-[state=checked]:translate-x-3": size === "sm",
            "h-5 w-5 data-[state=checked]:translate-x-5": size === "md",
            "h-6 w-6 data-[state=checked]:translate-x-7": size === "lg",
          }
        )}
      />
    </SwitchPrimitive.Root>
  );

  if (!label && !description) {
    return switchElement;
  }

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        {label && (
          <label
            htmlFor={props.id}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {label}
          </label>
        )}
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {switchElement}
    </div>
  );
});
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
