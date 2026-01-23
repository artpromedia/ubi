/**
 * Quick Action Button
 *
 * Mobile-optimized quick action button with icon and label
 * for home screen shortcuts and navigation.
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
  Car,
  CreditCard,
  Gift,
  Heart,
  HelpCircle,
  History,
  Package,
  Settings,
  Shield,
  Ticket,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";

import type * as React from "react";

const quickActionVariants = cva(
  "flex flex-col items-center gap-2 p-3 rounded-2xl transition-all active:scale-95",
  {
    variants: {
      variant: {
        default:
          "bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700",
        primary:
          "bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30",
        secondary:
          "bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30",
        warning:
          "bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30",
        ghost: "hover:bg-gray-100 dark:hover:bg-gray-800",
      },
      size: {
        sm: "w-16",
        md: "w-20",
        lg: "w-24",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

const iconVariants = cva("flex items-center justify-center rounded-xl", {
  variants: {
    variant: {
      default: "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
      primary: "bg-green-500 text-white",
      secondary: "bg-blue-500 text-white",
      warning: "bg-orange-500 text-white",
      ghost: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300",
    },
    size: {
      sm: "h-10 w-10",
      md: "h-12 w-12",
      lg: "h-14 w-14",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "md",
  },
});

export interface QuickActionProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof quickActionVariants> {
  /** Action label */
  label: string;
  /** Icon component or preset icon name */
  icon: LucideIcon | keyof typeof presetIcons;
  /** Badge count for notifications */
  badge?: number;
  /** Whether the action is disabled */
  disabled?: boolean;
}

const presetIcons = {
  ride: Car,
  food: UtensilsCrossed,
  package: Package,
  payment: CreditCard,
  rewards: Gift,
  promo: Ticket,
  safety: Shield,
  settings: Settings,
  history: History,
  favorites: Heart,
  help: HelpCircle,
};

export const QuickAction = ({
  className,
  variant,
  size,
  label,
  icon,
  badge,
  disabled,
  ...props
}: QuickActionProps) => {
  const IconComponent = typeof icon === "string" ? presetIcons[icon] : icon;
  const iconSize = size === "sm" ? 18 : size === "lg" ? 24 : 20;

  return (
    <button
      className={cn(
        quickActionVariants({ variant, size }),
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      disabled={disabled}
      {...props}
    >
      <div className="relative">
        <div className={cn(iconVariants({ variant, size }))}>
          <IconComponent style={{ width: iconSize, height: iconSize }} />
        </div>
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </div>
      <span
        className={cn(
          "text-center font-medium leading-tight",
          size === "sm" && "text-[10px]",
          size === "md" && "text-xs",
          size === "lg" && "text-sm",
          variant === "primary" && "text-green-700 dark:text-green-300",
          variant === "secondary" && "text-blue-700 dark:text-blue-300",
          variant === "warning" && "text-orange-700 dark:text-orange-300",
          (variant === "default" || variant === "ghost") &&
            "text-gray-700 dark:text-gray-300",
        )}
      >
        {label}
      </span>
    </button>
  );
};

/**
 * Quick Action Grid
 *
 * Container for arranging quick actions in a responsive grid.
 */
export interface QuickActionGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of columns */
  columns?: 3 | 4 | 5;
  /** Actions to render */
  children: React.ReactNode;
}

export const QuickActionGrid = ({
  className,
  columns = 4,
  children,
  ...props
}: QuickActionGridProps) => {
  return (
    <div
      className={cn(
        "grid gap-2",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-4",
        columns === 5 && "grid-cols-5",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export { iconVariants, quickActionVariants };
