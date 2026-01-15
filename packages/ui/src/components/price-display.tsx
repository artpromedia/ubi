"use client";

import * as React from "react";

import { cn } from "../lib/utils";

/**
 * PriceDisplay - Display price with currency formatting
 *
 * @example
 * <PriceDisplay amount={1500} currency="NGN" />
 * <PriceDisplay amount={25.99} currency="USD" showCents />
 * <PriceDisplay amount={1000} currency="KES" strikethrough originalAmount={1500} />
 */

export interface PriceDisplayProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Price amount */
  amount: number;
  /** Currency code */
  currency?:
    | "NGN"
    | "KES"
    | "ZAR"
    | "GHS"
    | "RWF"
    | "ETB"
    | "USD"
    | "EUR"
    | "GBP";
  /** Show cents/decimals */
  showCents?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg" | "xl";
  /** Original amount for showing discount */
  originalAmount?: number;
  /** Show as strikethrough (discounted) */
  strikethrough?: boolean;
}

const currencySymbols: Record<string, string> = {
  NGN: "\u20A6",
  KES: "KSh",
  ZAR: "R",
  GHS: "GH\u20B5",
  RWF: "RF",
  ETB: "Br",
  USD: "$",
  EUR: "\u20AC",
  GBP: "\u00A3",
};

const sizeClasses = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg",
  xl: "text-2xl font-semibold",
};

const PriceDisplay = React.forwardRef<HTMLDivElement, PriceDisplayProps>(
  (
    {
      className,
      amount,
      currency = "NGN",
      showCents = false,
      size = "md",
      originalAmount,
      strikethrough = false,
      ...props
    },
    ref,
  ) => {
    const formatPrice = (value: number) => {
      const formatted = showCents
        ? value.toFixed(2)
        : Math.floor(value).toLocaleString();
      return `${currencySymbols[currency]}${formatted}`;
    };

    return (
      <div
        ref={ref}
        className={cn("inline-flex items-baseline gap-2", className)}
        {...props}
      >
        {originalAmount && originalAmount > amount && (
          <span className="text-muted-foreground line-through text-sm">
            {formatPrice(originalAmount)}
          </span>
        )}
        <span
          className={cn(
            sizeClasses[size],
            strikethrough && "line-through text-muted-foreground",
          )}
        >
          {formatPrice(amount)}
        </span>
        {originalAmount && originalAmount > amount && (
          <span className="text-xs font-medium text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
            {Math.round(((originalAmount - amount) / originalAmount) * 100)}%
            off
          </span>
        )}
      </div>
    );
  },
);
PriceDisplay.displayName = "PriceDisplay";

export { PriceDisplay };
