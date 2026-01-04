"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * Stack - Vertical spacing primitive
 * 
 * Stacks children vertically with consistent spacing.
 * Simpler alternative to Flex for vertical layouts.
 * 
 * @example
 * <Stack gap={4}>
 *   <Card>Item 1</Card>
 *   <Card>Item 2</Card>
 *   <Card>Item 3</Card>
 * </Stack>
 */

const stackVariants = cva("flex flex-col", {
  variants: {
    gap: {
      0: "gap-0",
      0.5: "gap-0.5",
      1: "gap-1",
      1.5: "gap-1.5",
      2: "gap-2",
      2.5: "gap-2.5",
      3: "gap-3",
      3.5: "gap-3.5",
      4: "gap-4",
      5: "gap-5",
      6: "gap-6",
      7: "gap-7",
      8: "gap-8",
      9: "gap-9",
      10: "gap-10",
      12: "gap-12",
      14: "gap-14",
      16: "gap-16",
      20: "gap-20",
      24: "gap-24",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
  },
  defaultVariants: {
    gap: 4,
    align: "stretch",
    justify: "start",
  },
});

export interface StackProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof stackVariants> {
  /** Use a different HTML element */
  as?: "div" | "section" | "article" | "aside" | "ul" | "ol" | "nav" | "form" | "fieldset";
  /** Add a divider between items */
  divider?: React.ReactNode;
}

const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ as: Component = "div", className, gap, align, justify, divider, children, ...props }, ref) => {
    // If divider is provided, intersperse it between children
    const childArray = React.Children.toArray(children).filter(Boolean);
    const content = divider
      ? childArray.reduce<React.ReactNode[]>((acc, child, index) => {
          if (index > 0) {
            acc.push(
              <React.Fragment key={`divider-${index}`}>{divider}</React.Fragment>
            );
          }
          acc.push(child);
          return acc;
        }, [])
      : children;

    return (
      <Component
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn(stackVariants({ gap, align, justify }), className)}
        {...props}
      >
        {content}
      </Component>
    );
  }
);
Stack.displayName = "Stack";

/**
 * HStack - Horizontal spacing primitive
 * 
 * Stacks children horizontally with consistent spacing.
 * 
 * @example
 * <HStack gap={2}>
 *   <Button>Cancel</Button>
 *   <Button variant="primary">Save</Button>
 * </HStack>
 */

const hstackVariants = cva("flex flex-row", {
  variants: {
    gap: {
      0: "gap-0",
      0.5: "gap-0.5",
      1: "gap-1",
      1.5: "gap-1.5",
      2: "gap-2",
      2.5: "gap-2.5",
      3: "gap-3",
      3.5: "gap-3.5",
      4: "gap-4",
      5: "gap-5",
      6: "gap-6",
      7: "gap-7",
      8: "gap-8",
      9: "gap-9",
      10: "gap-10",
      12: "gap-12",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
    wrap: {
      true: "flex-wrap",
      false: "flex-nowrap",
    },
  },
  defaultVariants: {
    gap: 4,
    align: "center",
    justify: "start",
    wrap: false,
  },
});

export interface HStackProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof hstackVariants> {
  /** Use a different HTML element */
  as?: "div" | "section" | "nav" | "ul" | "ol";
  /** Add a divider between items */
  divider?: React.ReactNode;
}

const HStack = React.forwardRef<HTMLDivElement, HStackProps>(
  ({ as: Component = "div", className, gap, align, justify, wrap, divider, children, ...props }, ref) => {
    const childArray = React.Children.toArray(children).filter(Boolean);
    const content = divider
      ? childArray.reduce<React.ReactNode[]>((acc, child, index) => {
          if (index > 0) {
            acc.push(
              <React.Fragment key={`divider-${index}`}>{divider}</React.Fragment>
            );
          }
          acc.push(child);
          return acc;
        }, [])
      : children;

    return (
      <Component
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn(hstackVariants({ gap, align, justify, wrap }), className)}
        {...props}
      >
        {content}
      </Component>
    );
  }
);
HStack.displayName = "HStack";

export { Stack, HStack, stackVariants, hstackVariants };
