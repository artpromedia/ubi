/**
 * Promo Banner
 *
 * Mobile-optimized promotional banner with gradient backgrounds
 * and call-to-action for marketing campaigns.
 */

import { cva, type VariantProps } from "class-variance-authority";
import { ChevronRight, Gift, Percent, Star, X, Zap } from "lucide-react";

import { cn } from "../../lib/utils";

import type * as React from "react";

const promoBannerVariants = cva("relative rounded-2xl p-4 overflow-hidden", {
  variants: {
    variant: {
      gradient: "bg-gradient-to-r from-green-500 to-emerald-600 text-white",
      orange: "bg-gradient-to-r from-orange-500 to-red-500 text-white",
      purple: "bg-gradient-to-r from-purple-500 to-pink-500 text-white",
      blue: "bg-gradient-to-r from-blue-500 to-cyan-500 text-white",
      dark: "bg-gray-900 text-white border border-gray-800",
      light: "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white",
    },
    size: {
      sm: "py-3",
      md: "py-4",
      lg: "py-5",
    },
  },
  defaultVariants: {
    variant: "gradient",
    size: "md",
  },
});

export interface PromoBannerProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof promoBannerVariants> {
  /** Promo title */
  title: string;
  /** Promo description */
  description?: string;
  /** Promo code if applicable */
  promoCode?: string;
  /** Icon type */
  icon?: "gift" | "percent" | "zap" | "star";
  /** Call to action text */
  ctaText?: string;
  /** Callback when CTA is clicked */
  onCtaClick?: () => void;
  /** Whether banner is dismissible */
  dismissible?: boolean;
  /** Callback when dismissed */
  onDismiss?: () => void;
  /** Expiry text */
  expiryText?: string;
  /** Background image URL */
  backgroundImage?: string;
}

const iconMap = {
  gift: Gift,
  percent: Percent,
  zap: Zap,
  star: Star,
};

export const PromoBanner = ({
  className,
  variant,
  size,
  title,
  description,
  promoCode,
  icon = "gift",
  ctaText,
  onCtaClick,
  dismissible = false,
  onDismiss,
  expiryText,
  backgroundImage,
  ...props
}: PromoBannerProps) => {
  const IconComponent = iconMap[icon];

  return (
    <div
      className={cn(promoBannerVariants({ variant, size }), className)}
      {...props}
    >
      {/* Background Image/Pattern */}
      {backgroundImage && (
        <div
          className="absolute inset-0 opacity-20 bg-cover bg-center"
          style={{ backgroundImage: `url(${backgroundImage})` }}
        />
      )}

      {/* Decorative circles */}
      <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-white/10" />
      <div className="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-white/5" />

      {/* Content */}
      <div className="relative flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-white/20 flex items-center justify-center">
          <IconComponent className="h-5 w-5" />
        </div>

        {/* Text Content */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg leading-tight">{title}</h3>
          {description && (
            <p className="text-sm opacity-90 mt-0.5">{description}</p>
          )}
          {promoCode && (
            <div className="inline-flex items-center gap-2 mt-2 px-3 py-1 bg-white/20 rounded-lg text-sm font-mono font-bold">
              {promoCode}
            </div>
          )}
          {expiryText && (
            <p className="text-xs opacity-75 mt-2">{expiryText}</p>
          )}
        </div>

        {/* CTA Button */}
        {ctaText && (
          <button
            onClick={onCtaClick}
            className="flex-shrink-0 flex items-center gap-1 px-4 py-2 bg-white text-gray-900 rounded-xl font-semibold text-sm hover:bg-white/90 transition-colors"
          >
            {ctaText}
            <ChevronRight className="h-4 w-4" />
          </button>
        )}

        {/* Dismiss Button */}
        {dismissible && (
          <button
            onClick={onDismiss}
            className="absolute top-0 right-0 p-1 text-white/70 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export { promoBannerVariants };
