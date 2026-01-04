"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

/**
 * RatingDisplay - Display star ratings
 * 
 * @example
 * <RatingDisplay value={4.5} />
 * <RatingDisplay value={4.8} showValue maxStars={5} />
 */

const ratingVariants = cva("inline-flex items-center gap-1", {
  variants: {
    size: {
      xs: "[&_svg]:h-3 [&_svg]:w-3 text-xs",
      sm: "[&_svg]:h-4 [&_svg]:w-4 text-sm",
      md: "[&_svg]:h-5 [&_svg]:w-5 text-base",
      lg: "[&_svg]:h-6 [&_svg]:w-6 text-lg",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export interface RatingDisplayProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "value">,
    VariantProps<typeof ratingVariants> {
  /** Rating value (0-5) */
  value: number;
  /** Maximum number of stars */
  maxStars?: number;
  /** Show numeric value */
  showValue?: boolean;
  /** Show total review count */
  reviewCount?: number;
  /** Color scheme */
  color?: "default" | "move" | "bites" | "send";
}

const StarIcon = ({ filled, half, className }: { filled?: boolean; half?: boolean; className?: string }) => (
  <svg
    className={className}
    fill={filled ? "currentColor" : half ? "url(#half)" : "none"}
    stroke="currentColor"
    strokeWidth={1.5}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="half">
        <stop offset="50%" stopColor="currentColor" />
        <stop offset="50%" stopColor="transparent" />
      </linearGradient>
    </defs>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
    />
  </svg>
);

const colorClasses = {
  default: "text-amber-400",
  move: "text-ubi-move",
  bites: "text-ubi-bites",
  send: "text-ubi-send",
};

const RatingDisplay = React.forwardRef<HTMLDivElement, RatingDisplayProps>(
  (
    {
      className,
      value,
      maxStars = 5,
      showValue = false,
      reviewCount,
      size,
      color = "default",
      ...props
    },
    ref
  ) => {
    const fullStars = Math.floor(value);
    const hasHalfStar = value % 1 >= 0.5;
    const emptyStars = maxStars - fullStars - (hasHalfStar ? 1 : 0);

    return (
      <div
        ref={ref}
        className={cn(ratingVariants({ size }), colorClasses[color], className)}
        role="img"
        aria-label={`Rating: ${value} out of ${maxStars} stars`}
        {...props}
      >
        {/* Full stars */}
        {Array.from({ length: fullStars }).map((_, i) => (
          <StarIcon key={`full-${i}`} filled />
        ))}
        
        {/* Half star */}
        {hasHalfStar && <StarIcon half />}
        
        {/* Empty stars */}
        {Array.from({ length: emptyStars }).map((_, i) => (
          <StarIcon key={`empty-${i}`} className="text-gray-300 dark:text-gray-600" />
        ))}
        
        {/* Numeric value */}
        {showValue && (
          <span className="ml-1 font-medium text-foreground">{value.toFixed(1)}</span>
        )}
        
        {/* Review count */}
        {reviewCount !== undefined && (
          <span className="text-muted-foreground">({reviewCount.toLocaleString()})</span>
        )}
      </div>
    );
  }
);
RatingDisplay.displayName = "RatingDisplay";

/**
 * RatingInput - Interactive star rating input
 * 
 * @example
 * <RatingInput value={rating} onChange={setRating} />
 */

export interface RatingInputProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "value" | "onChange">,
    VariantProps<typeof ratingVariants> {
  /** Current value */
  value: number;
  /** Change handler */
  onChange: (value: number) => void;
  /** Maximum stars */
  maxStars?: number;
  /** Allow half-star ratings */
  allowHalf?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Color scheme */
  color?: "default" | "move" | "bites" | "send";
}

const RatingInput = React.forwardRef<HTMLDivElement, RatingInputProps>(
  (
    {
      className,
      value,
      onChange,
      maxStars = 5,
      allowHalf = false,
      disabled,
      size,
      color = "default",
      ...props
    },
    ref
  ) => {
    const [hoverValue, setHoverValue] = React.useState<number | null>(null);
    const displayValue = hoverValue ?? value;

    const handleMouseMove = (index: number, event: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      
      const rect = event.currentTarget.getBoundingClientRect();
      const position = (event.clientX - rect.left) / rect.width;
      
      if (allowHalf && position < 0.5) {
        setHoverValue(index + 0.5);
      } else {
        setHoverValue(index + 1);
      }
    };

    const handleClick = (index: number, event: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      
      const rect = event.currentTarget.getBoundingClientRect();
      const position = (event.clientX - rect.left) / rect.width;
      
      if (allowHalf && position < 0.5) {
        onChange(index + 0.5);
      } else {
        onChange(index + 1);
      }
    };

    return (
      <div
        ref={ref}
        className={cn(
          ratingVariants({ size }),
          colorClasses[color],
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        role="radiogroup"
        aria-label="Rating"
        onMouseLeave={() => setHoverValue(null)}
        {...props}
      >
        {Array.from({ length: maxStars }).map((_, index) => {
          const starValue = index + 1;
          const isFilled = displayValue >= starValue;
          const isHalf = displayValue === index + 0.5;

          return (
            <button
              key={index}
              type="button"
              disabled={disabled}
              onClick={(e) => handleClick(index, e)}
              onMouseMove={(e) => handleMouseMove(index, e)}
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded transition-transform hover:scale-110 disabled:cursor-not-allowed"
              aria-label={`Rate ${starValue} out of ${maxStars}`}
            >
              <StarIcon
                filled={isFilled}
                half={isHalf}
                className={!isFilled && !isHalf ? "text-gray-300 dark:text-gray-600" : undefined}
              />
            </button>
          );
        })}
      </div>
    );
  }
);
RatingInput.displayName = "RatingInput";

export { RatingDisplay, RatingInput, ratingVariants };
