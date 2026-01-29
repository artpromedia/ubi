"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../lib/utils";

/**
 * Text - A typography primitive
 *
 * Renders text with consistent typography styles.
 * Supports all heading levels, body text, and special variants.
 *
 * @example
 * <Text variant="h1">Page Title</Text>
 * <Text variant="body" color="muted">Description text</Text>
 * <Text as="span" weight="semibold">Inline bold</Text>
 */

const textVariants = cva("", {
  variants: {
    variant: {
      // Display variants - for hero sections
      display1:
        "font-heading text-6xl sm:text-7xl md:text-8xl font-bold tracking-tight",
      display2:
        "font-heading text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight",

      // Heading variants
      h1: "font-heading text-4xl sm:text-5xl font-bold tracking-tight",
      h2: "font-heading text-3xl sm:text-4xl font-semibold tracking-tight",
      h3: "font-heading text-2xl sm:text-3xl font-semibold tracking-tight",
      h4: "font-heading text-xl sm:text-2xl font-semibold",
      h5: "font-heading text-lg sm:text-xl font-semibold",
      h6: "font-heading text-base sm:text-lg font-semibold",

      // Body variants
      "body-xl": "font-body text-xl",
      "body-lg": "font-body text-lg",
      body: "font-body text-base",
      "body-sm": "font-body text-sm",
      "body-xs": "font-body text-xs",

      // Special variants
      lead: "font-body text-xl text-muted-foreground leading-relaxed",
      large: "font-body text-lg font-medium",
      small: "font-body text-sm font-medium leading-none",
      muted: "font-body text-sm text-muted-foreground",

      // UI variants
      label:
        "font-body text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      caption: "font-body text-xs text-muted-foreground",
      overline: "font-body text-xs font-semibold uppercase tracking-wider",

      // Code
      code: "font-mono text-sm bg-muted px-1.5 py-0.5 rounded",
      "code-block": "font-mono text-sm",
    },
    color: {
      default: "text-foreground",
      muted: "text-muted-foreground",
      primary: "text-primary",
      secondary: "text-secondary-foreground",
      success: "text-green-600 dark:text-green-400",
      warning: "text-amber-600 dark:text-amber-400",
      error: "text-red-600 dark:text-red-400",
      info: "text-blue-600 dark:text-blue-400",
      // Service colors
      move: "text-ubi-green",
      bites: "text-ubi-bites",
      send: "text-ubi-send",
    },
    weight: {
      thin: "font-thin",
      light: "font-light",
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
      bold: "font-bold",
      extrabold: "font-extrabold",
    },
    align: {
      left: "text-left",
      center: "text-center",
      right: "text-right",
      justify: "text-justify",
    },
    wrap: {
      wrap: "text-wrap",
      nowrap: "text-nowrap",
      balance: "text-balance",
      pretty: "text-pretty",
    },
    truncate: {
      true: "truncate",
      false: "",
    },
    lineClamp: {
      1: "line-clamp-1",
      2: "line-clamp-2",
      3: "line-clamp-3",
      4: "line-clamp-4",
      5: "line-clamp-5",
      6: "line-clamp-6",
    },
  },
  defaultVariants: {
    variant: "body",
    color: "default",
    align: "left",
    truncate: false,
  },
});

// Map variants to semantic HTML elements
const variantElementMap: Record<string, React.ElementType> = {
  display1: "h1",
  display2: "h1",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  "body-xl": "p",
  "body-lg": "p",
  body: "p",
  "body-sm": "p",
  "body-xs": "p",
  lead: "p",
  large: "p",
  small: "small",
  muted: "p",
  label: "label",
  caption: "span",
  overline: "span",
  code: "code",
  "code-block": "pre",
};

type TextOwnProps<E extends React.ElementType = "p"> = {
  /** Override the default element */
  as?: E;
  /** Use Radix Slot to merge props into child element */
  asChild?: boolean;
} & VariantProps<typeof textVariants>;

type TextProps<E extends React.ElementType = "p"> = TextOwnProps<E> &
  Omit<React.ComponentPropsWithoutRef<E>, keyof TextOwnProps<E>>;

type TextComponent = <E extends React.ElementType = "p">(
  props: TextProps<E> & { ref?: React.ComponentPropsWithRef<E>["ref"] },
) => React.ReactElement | null;

const TextInner = <E extends React.ElementType = "p">(
  {
    as,
    asChild = false,
    variant = "body",
    color,
    weight,
    align,
    wrap,
    truncate,
    lineClamp,
    className,
    children,
    ...props
  }: TextProps<E>,
  ref: React.ForwardedRef<Element>,
) => {
  // Determine the element to render
  const getComponent = (): React.ElementType => {
    if (asChild) return Slot;
    if (as) return as;
    if (variant && variantElementMap[variant])
      return variantElementMap[variant];
    return "p";
  };
  const Component = getComponent();

  return (
    <Component
      ref={ref as React.Ref<never>}
      className={cn(
        textVariants({
          variant,
          color,
          weight,
          align,
          wrap,
          truncate,
          lineClamp,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
};

const Text = React.forwardRef(TextInner) as TextComponent;

export { Text, textVariants };
export type { TextProps };
