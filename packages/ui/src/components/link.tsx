"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * Link - A styled anchor component
 * 
 * Use for navigation links with consistent styling.
 * Works with Next.js Link when using asChild.
 * 
 * @example
 * <Link href="/about">About us</Link>
 * <Link href="/home" variant="nav">Home</Link>
 * 
 * // With Next.js Link
 * <Link asChild>
 *   <NextLink href="/dashboard">Dashboard</NextLink>
 * </Link>
 */

const linkVariants = cva(
  "inline-flex items-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm",
  {
    variants: {
      variant: {
        default: "text-primary underline-offset-4 hover:underline",
        muted: "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
        nav: "text-foreground hover:text-primary no-underline font-medium",
        subtle: "text-foreground/80 hover:text-foreground no-underline",
        // Service links
        move: "text-ubi-move hover:text-ubi-move/80 underline-offset-4 hover:underline",
        bites: "text-ubi-bites hover:text-ubi-bites/80 underline-offset-4 hover:underline",
        send: "text-ubi-send hover:text-ubi-send/80 underline-offset-4 hover:underline",
      },
      size: {
        sm: "text-sm",
        md: "text-base",
        lg: "text-lg",
      },
      underline: {
        always: "underline",
        hover: "hover:underline",
        none: "no-underline",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
      underline: "hover",
    },
  }
);

export interface LinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof linkVariants> {
  /** Render as child element (for Next.js Link) */
  asChild?: boolean;
  /** External link - adds rel and target */
  external?: boolean;
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(
  ({ className, variant, size, underline, asChild = false, external, ...props }, ref) => {
    const Comp = asChild ? Slot : "a";
    
    const externalProps = external
      ? { target: "_blank", rel: "noopener noreferrer" }
      : {};

    return (
      <Comp
        ref={ref}
        className={cn(linkVariants({ variant, size, underline }), className)}
        {...externalProps}
        {...props}
      />
    );
  }
);
Link.displayName = "Link";

export { Link, linkVariants };
