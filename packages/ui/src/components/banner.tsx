"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle, Info, XCircle, X } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

/**
 * Banner - Full-width notification banner
 *
 * Used for important announcements, promotions, or system messages.
 *
 * @example
 * <Banner variant="info" dismissible>
 *   New feature: Track your ride in real-time!
 * </Banner>
 *
 * <Banner variant="promo" action={{ label: "Learn More", onClick: () => {} }}>
 *   Get 50% off your next UBI Bites order
 * </Banner>
 */

const bannerVariants = cva(
  "relative flex items-center gap-3 px-4 py-3 text-sm",
  {
    variants: {
      variant: {
        info: "bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
        success:
          "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200",
        warning:
          "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
        error: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
        // UBI promotional banners
        promo:
          "bg-gradient-to-r from-ubi-green/10 to-ubi-bites/10 text-foreground",
        "promo-move": "bg-ubi-move/10 text-ubi-move dark:text-ubi-move",
        "promo-bites": "bg-ubi-bites/10 text-ubi-bites dark:text-ubi-bites",
        "promo-send": "bg-ubi-send/10 text-ubi-send dark:text-ubi-send",
      },
      position: {
        top: "border-b",
        inline: "rounded-lg border",
      },
    },
    defaultVariants: {
      variant: "info",
      position: "inline",
    },
  },
);

const iconMap = {
  info: Info,
  success: CheckCircle,
  warning: AlertCircle,
  error: XCircle,
  promo: Info,
  "promo-move": Info,
  "promo-bites": Info,
  "promo-send": Info,
};

export interface BannerProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof bannerVariants> {
  /** Show icon based on variant */
  showIcon?: boolean;
  /** Make banner dismissible */
  dismissible?: boolean;
  /** Callback when dismissed */
  onDismiss?: () => void;
  /** Action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  (
    {
      className,
      variant = "info",
      position,
      showIcon = true,
      dismissible,
      onDismiss,
      action,
      children,
      ...props
    },
    ref,
  ) => {
    const [isVisible, setIsVisible] = React.useState(true);
    const IconComponent = variant ? iconMap[variant] : Info;

    const handleDismiss = () => {
      setIsVisible(false);
      onDismiss?.();
    };

    if (!isVisible) {
      return null;
    }

    return (
      <div
        ref={ref}
        role="banner"
        className={cn(bannerVariants({ variant, position }), className)}
        {...props}
      >
        {showIcon && <IconComponent className="h-5 w-5 shrink-0" />}
        <div className="flex-1">{children}</div>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="shrink-0 font-medium underline-offset-4 hover:underline"
          >
            {action.label}
          </button>
        )}
        {dismissible && (
          <button
            type="button"
            onClick={handleDismiss}
            className="shrink-0 p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            aria-label="Dismiss banner"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  },
);
Banner.displayName = "Banner";

export { Banner, bannerVariants };
