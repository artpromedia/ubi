"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Flex - A flexbox layout primitive
 * 
 * Provides common flexbox patterns with sensible defaults.
 * 
 * @example
 * <Flex direction="column" gap="4" align="center" justify="between">
 *   <Flex.Item grow>Content</Flex.Item>
 *   <Flex.Item shrink={false}>Fixed</Flex.Item>
 * </Flex>
 */

const flexVariants = cva("flex", {
  variants: {
    direction: {
      row: "flex-row",
      "row-reverse": "flex-row-reverse",
      column: "flex-col",
      "column-reverse": "flex-col-reverse",
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
      around: "justify-around",
      evenly: "justify-evenly",
    },
    wrap: {
      wrap: "flex-wrap",
      nowrap: "flex-nowrap",
      "wrap-reverse": "flex-wrap-reverse",
    },
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
    },
    inline: {
      true: "inline-flex",
      false: "flex",
    },
  },
  defaultVariants: {
    direction: "row",
    align: "stretch",
    justify: "start",
    wrap: "nowrap",
    inline: false,
  },
});

export interface FlexProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof flexVariants> {
  asChild?: boolean;
}

const Flex = React.forwardRef<HTMLDivElement, FlexProps>(
  ({ className, direction, align, justify, wrap, gap, inline, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(flexVariants({ direction, align, justify, wrap, gap, inline }), className)}
        {...props}
      />
    );
  }
);
Flex.displayName = "Flex";

// Flex.Item for flex children with grow/shrink control
const flexItemVariants = cva("", {
  variants: {
    grow: {
      true: "flex-grow",
      false: "flex-grow-0",
    },
    shrink: {
      true: "flex-shrink",
      false: "flex-shrink-0",
    },
    basis: {
      auto: "basis-auto",
      0: "basis-0",
      full: "basis-full",
      "1/2": "basis-1/2",
      "1/3": "basis-1/3",
      "2/3": "basis-2/3",
      "1/4": "basis-1/4",
      "3/4": "basis-3/4",
    },
    align: {
      auto: "self-auto",
      start: "self-start",
      center: "self-center",
      end: "self-end",
      stretch: "self-stretch",
      baseline: "self-baseline",
    },
  },
  defaultVariants: {},
});

interface FlexItemProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof flexItemVariants> {}

const FlexItem = React.forwardRef<HTMLDivElement, FlexItemProps>(
  ({ className, grow, shrink, basis, align, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(flexItemVariants({ grow, shrink, basis, align }), className)}
        {...props}
      />
    );
  }
);
FlexItem.displayName = "FlexItem";

// Compound component pattern
const FlexWithItem = Object.assign(Flex, { Item: FlexItem });

export { FlexWithItem as Flex, FlexItem, flexVariants, flexItemVariants };
