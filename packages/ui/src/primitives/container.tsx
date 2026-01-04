"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * Container - A responsive container primitive
 * 
 * Provides consistent max-width and padding across breakpoints.
 * Used for page layouts and section containers.
 * 
 * @example
 * <Container size="lg" className="py-8">
 *   <h1>Page content</h1>
 * </Container>
 */

const containerVariants = cva("mx-auto w-full", {
  variants: {
    size: {
      xs: "max-w-xs", // 320px
      sm: "max-w-sm", // 384px
      md: "max-w-md", // 448px
      lg: "max-w-lg", // 512px
      xl: "max-w-xl", // 576px
      "2xl": "max-w-2xl", // 672px
      "3xl": "max-w-3xl", // 768px
      "4xl": "max-w-4xl", // 896px
      "5xl": "max-w-5xl", // 1024px
      "6xl": "max-w-6xl", // 1152px
      "7xl": "max-w-7xl", // 1280px
      full: "max-w-full",
      prose: "max-w-prose", // 65ch - optimal for reading
      screen: "max-w-screen-xl", // 1280px (common for dashboards)
    },
    padding: {
      none: "px-0",
      sm: "px-4",
      md: "px-4 sm:px-6 lg:px-8",
      lg: "px-6 sm:px-8 lg:px-12",
      xl: "px-8 sm:px-12 lg:px-16",
    },
    center: {
      true: "flex flex-col items-center",
      false: "",
    },
  },
  defaultVariants: {
    size: "7xl",
    padding: "md",
    center: false,
  },
});

export interface ContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof containerVariants> {
  as?: "div" | "section" | "article" | "main" | "header" | "footer" | "aside" | "nav";
}

const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ as: Component = "div", className, size, padding, center, ...props }, ref) => {
    return (
      <Component
        ref={ref}
        className={cn(containerVariants({ size, padding, center }), className)}
        {...props}
      />
    );
  }
);
Container.displayName = "Container";

export { Container, containerVariants };
