"use client";

import { Building, CreditCard, Plus, Smartphone, Wallet } from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

/**
 * PaymentMethodCard - Display a payment method option
 *
 * @example
 * <PaymentMethodCard
 *   type="card"
 *   label="•••• 4242"
 *   sublabel="Expires 12/25"
 *   selected
 *   onSelect={() => {}}
 * />
 */

const paymentIcons = {
  card: CreditCard,
  mobile: Smartphone,
  wallet: Wallet,
  bank: Building,
  add: Plus,
};

const paymentColors = {
  card: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  mobile:
    "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  wallet:
    "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
  bank: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  add: "bg-muted text-muted-foreground",
};

export interface PaymentMethodCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Payment method type */
  type: keyof typeof paymentIcons;
  /** Primary label (e.g., card number, mobile money name) */
  label: string;
  /** Secondary label (e.g., expiry, account) */
  sublabel?: string;
  /** Whether this method is selected */
  selected?: boolean;
  /** Whether this is the default payment method */
  isDefault?: boolean;
  /** Selection handler */
  onSelect?: () => void;
  /** Brand logo URL (for card brands like Visa, Mastercard) */
  brandLogo?: string;
  /** Disabled state */
  disabled?: boolean;
}

const PaymentMethodCard = React.forwardRef<
  HTMLDivElement,
  PaymentMethodCardProps
>(
  (
    {
      className,
      type,
      label,
      sublabel,
      selected,
      isDefault,
      onSelect,
      brandLogo,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Icon = paymentIcons[type];

    return (
      <div
        ref={ref}
        role="radio"
        aria-checked={selected}
        aria-disabled={disabled}
        onClick={() => !disabled && onSelect?.()}
        className={cn(
          "flex items-center gap-3 p-3 rounded-lg border-2 transition-all cursor-pointer",
          selected
            ? "border-primary bg-primary/5"
            : "border-transparent bg-card hover:border-border",
          disabled && "opacity-50 cursor-not-allowed",
          className,
        )}
        {...props}
      >
        {/* Icon */}
        <div className={cn("p-2 rounded-lg", paymentColors[type])}>
          <Icon className="h-5 w-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{label}</span>
            {isDefault && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary font-medium">
                Default
              </span>
            )}
          </div>
          {sublabel && (
            <p className="text-xs text-muted-foreground">{sublabel}</p>
          )}
        </div>

        {/* Brand logo */}
        {brandLogo && <img src={brandLogo} alt="" className="h-6 w-auto" />}

        {/* Selection indicator */}
        <div
          className={cn(
            "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0",
            selected ? "border-primary" : "border-muted-foreground/30",
          )}
        >
          {selected && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
        </div>
      </div>
    );
  },
);
PaymentMethodCard.displayName = "PaymentMethodCard";

/**
 * AddPaymentMethod - Button to add a new payment method
 */

export interface AddPaymentMethodProps extends React.HTMLAttributes<HTMLButtonElement> {
  /** Button label */
  label?: string;
}

const AddPaymentMethod = React.forwardRef<
  HTMLButtonElement,
  AddPaymentMethodProps
>(({ className, label = "Add payment method", ...props }, ref) => {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border-2 border-dashed border-muted-foreground/30 w-full",
        "hover:border-primary hover:bg-primary/5 transition-colors",
        className,
      )}
      {...props}
    >
      <div className="p-2 rounded-lg bg-muted">
        <Plus className="h-5 w-5 text-muted-foreground" />
      </div>
      <span className="font-medium text-muted-foreground">{label}</span>
    </button>
  );
});
AddPaymentMethod.displayName = "AddPaymentMethod";

export { AddPaymentMethod, PaymentMethodCard };
