/**
 * Checkbox Component
 *
 * Accessible checkbox with indeterminate state support.
 */

"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";

export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  /** Indeterminate state for partial selection */
  indeterminate?: boolean;
  /** Label text */
  label?: string;
  /** Description text */
  description?: string;
  /** Error state */
  error?: boolean;
}

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, indeterminate, label, description, error, ...props }, ref) => {
  const checkboxElement = (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border border-input ring-offset-background",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary",
        "data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary",
        error && "border-destructive",
        className
      )}
      checked={indeterminate ? "indeterminate" : props.checked}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className={cn("flex items-center justify-center text-current")}
      >
        {indeterminate ? (
          <Minus className="h-3 w-3" />
        ) : (
          <Check className="h-3 w-3" />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );

  if (!label && !description) {
    return checkboxElement;
  }

  return (
    <div className="flex items-start space-x-3">
      {checkboxElement}
      <div className="space-y-1 leading-none">
        {label && (
          <label
            htmlFor={props.id}
            className={cn(
              "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
              error && "text-destructive"
            )}
          >
            {label}
          </label>
        )}
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
