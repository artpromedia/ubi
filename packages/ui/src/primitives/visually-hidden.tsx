"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * VisuallyHidden - Accessibility utility component
 * 
 * Hides content visually while keeping it accessible to screen readers.
 * Essential for providing context to assistive technologies.
 * 
 * @example
 * <button>
 *   <Icon><X /></Icon>
 *   <VisuallyHidden>Close dialog</VisuallyHidden>
 * </button>
 */

export interface VisuallyHiddenProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Content to hide visually but expose to screen readers */
  children: React.ReactNode;
}

const VisuallyHidden = React.forwardRef<HTMLSpanElement, VisuallyHiddenProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          // Screen reader only styles
          "absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0",
          "[clip:rect(0,0,0,0)]",
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);
VisuallyHidden.displayName = "VisuallyHidden";

export { VisuallyHidden };
