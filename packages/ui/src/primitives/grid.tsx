"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * Grid - A CSS Grid layout primitive
 * 
 * Provides common grid patterns with responsive column support.
 * 
 * @example
 * <Grid cols={3} gap={4}>
 *   <Grid.Item colSpan={2}>Wide content</Grid.Item>
 *   <Grid.Item>Normal content</Grid.Item>
 * </Grid>
 */

const gridVariants = cva("grid", {
  variants: {
    cols: {
      1: "grid-cols-1",
      2: "grid-cols-2",
      3: "grid-cols-3",
      4: "grid-cols-4",
      5: "grid-cols-5",
      6: "grid-cols-6",
      7: "grid-cols-7",
      8: "grid-cols-8",
      9: "grid-cols-9",
      10: "grid-cols-10",
      11: "grid-cols-11",
      12: "grid-cols-12",
      none: "grid-cols-none",
      subgrid: "grid-cols-subgrid",
    },
    rows: {
      1: "grid-rows-1",
      2: "grid-rows-2",
      3: "grid-rows-3",
      4: "grid-rows-4",
      5: "grid-rows-5",
      6: "grid-rows-6",
      none: "grid-rows-none",
      subgrid: "grid-rows-subgrid",
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
    flow: {
      row: "grid-flow-row",
      col: "grid-flow-col",
      dense: "grid-flow-dense",
      "row-dense": "grid-flow-row-dense",
      "col-dense": "grid-flow-col-dense",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
      baseline: "items-baseline",
    },
    justify: {
      start: "justify-items-start",
      center: "justify-items-center",
      end: "justify-items-end",
      stretch: "justify-items-stretch",
    },
    placeContent: {
      start: "place-content-start",
      center: "place-content-center",
      end: "place-content-end",
      between: "place-content-between",
      around: "place-content-around",
      evenly: "place-content-evenly",
      stretch: "place-content-stretch",
    },
    inline: {
      true: "inline-grid",
      false: "grid",
    },
  },
  defaultVariants: {
    cols: 1,
    gap: 4,
    inline: false,
  },
});

export interface GridProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof gridVariants> {}

const Grid = React.forwardRef<HTMLDivElement, GridProps>(
  ({ className, cols, rows, gap, flow, align, justify, placeContent, inline, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          gridVariants({ cols, rows, gap, flow, align, justify, placeContent, inline }),
          className
        )}
        {...props}
      />
    );
  }
);
Grid.displayName = "Grid";

// Grid.Item for grid children with span control
const gridItemVariants = cva("", {
  variants: {
    colSpan: {
      1: "col-span-1",
      2: "col-span-2",
      3: "col-span-3",
      4: "col-span-4",
      5: "col-span-5",
      6: "col-span-6",
      7: "col-span-7",
      8: "col-span-8",
      9: "col-span-9",
      10: "col-span-10",
      11: "col-span-11",
      12: "col-span-12",
      full: "col-span-full",
    },
    rowSpan: {
      1: "row-span-1",
      2: "row-span-2",
      3: "row-span-3",
      4: "row-span-4",
      5: "row-span-5",
      6: "row-span-6",
      full: "row-span-full",
    },
    colStart: {
      1: "col-start-1",
      2: "col-start-2",
      3: "col-start-3",
      4: "col-start-4",
      5: "col-start-5",
      6: "col-start-6",
      7: "col-start-7",
      8: "col-start-8",
      9: "col-start-9",
      10: "col-start-10",
      11: "col-start-11",
      12: "col-start-12",
      13: "col-start-13",
      auto: "col-start-auto",
    },
    colEnd: {
      1: "col-end-1",
      2: "col-end-2",
      3: "col-end-3",
      4: "col-end-4",
      5: "col-end-5",
      6: "col-end-6",
      7: "col-end-7",
      8: "col-end-8",
      9: "col-end-9",
      10: "col-end-10",
      11: "col-end-11",
      12: "col-end-12",
      13: "col-end-13",
      auto: "col-end-auto",
    },
    placeSelf: {
      auto: "place-self-auto",
      start: "place-self-start",
      center: "place-self-center",
      end: "place-self-end",
      stretch: "place-self-stretch",
    },
  },
  defaultVariants: {},
});

interface GridItemProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof gridItemVariants> {}

const GridItem = React.forwardRef<HTMLDivElement, GridItemProps>(
  ({ className, colSpan, rowSpan, colStart, colEnd, placeSelf, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(gridItemVariants({ colSpan, rowSpan, colStart, colEnd, placeSelf }), className)}
        {...props}
      />
    );
  }
);
GridItem.displayName = "GridItem";

// Compound component pattern
const GridWithItem = Object.assign(Grid, { Item: GridItem });

export { GridWithItem as Grid, GridItem, gridVariants, gridItemVariants };
