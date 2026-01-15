"use client";

import { Slot } from "@radix-ui/react-slot";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Box - A polymorphic layout primitive
 *
 * The foundation for all layout components. Supports:
 * - Polymorphic rendering via `as` prop
 * - Composition via `asChild` prop (renders as Slot)
 * - Flexible display, padding, margin, gap via utility classes
 * - Full TypeScript support with proper ref forwarding
 *
 * @example
 * <Box as="section" className="p-4 bg-background">
 *   <Box className="flex gap-4">
 *     <Box asChild><button>Click me</button></Box>
 *   </Box>
 * </Box>
 */

type BoxOwnProps<E extends React.ElementType = "div"> = {
  /** The element type to render */
  as?: E;
  /** Use Radix Slot to merge props into child element */
  asChild?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Child elements */
  children?: React.ReactNode;
};

type BoxProps<E extends React.ElementType = "div"> = BoxOwnProps<E> &
  Omit<React.ComponentPropsWithoutRef<E>, keyof BoxOwnProps<E>>;

type BoxRef<E extends React.ElementType = "div"> =
  React.ComponentPropsWithRef<E>["ref"];

type BoxComponent = <E extends React.ElementType = "div">(
  props: BoxProps<E> & { ref?: BoxRef<E> }
) => React.ReactElement | null;

const Box: BoxComponent = React.forwardRef(function Box<
  E extends React.ElementType = "div",
>(
  { as, asChild = false, className, children, ...props }: BoxProps<E>,
  ref: React.ForwardedRef<Element>
) {
  const Component = asChild ? Slot : as || "div";

  return (
    <Component
      ref={ref as React.Ref<never>}
      className={cn(className)}
      {...(props as React.HTMLAttributes<HTMLElement>)}
    >
      {children}
    </Component>
  );
}) as BoxComponent;

export { Box };
export type { BoxProps };
