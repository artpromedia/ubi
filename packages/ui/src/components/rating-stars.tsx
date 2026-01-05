"use client";

import * as React from "react";
import { cn } from "../lib/utils";

/**
 * RatingStars - Display star rating
 *
 * @example
 * <RatingStars rating={4.5} />
 * <RatingStars rating={3} maxRating={5} showValue />
 * <RatingStars rating={4} size="lg" interactive onChange={(r) => console.log(r)} />
 */

export interface RatingStarsProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Current rating value */
  rating: number;
  /** Maximum rating (default: 5) */
  maxRating?: number;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Show numeric value */
  showValue?: boolean;
  /** Show count of ratings */
  count?: number;
  /** Allow interactive rating */
  interactive?: boolean;
  /** Callback when rating changes (interactive mode) */
  onRatingChange?: (rating: number) => void;
}

const sizeClasses = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
};

const textSizeClasses = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

const RatingStars = React.forwardRef<HTMLDivElement, RatingStarsProps>(
  (
    {
      className,
      rating,
      maxRating = 5,
      size = "md",
      showValue = false,
      count,
      interactive = false,
      onRatingChange,
      ...props
    },
    ref
  ) => {
    const [hoverRating, setHoverRating] = React.useState<number | null>(null);

    const displayRating = hoverRating ?? rating;

    const handleClick = (index: number) => {
      if (interactive && onRatingChange) {
        onRatingChange(index + 1);
      }
    };

    const handleMouseEnter = (index: number) => {
      if (interactive) {
        setHoverRating(index + 1);
      }
    };

    const handleMouseLeave = () => {
      if (interactive) {
        setHoverRating(null);
      }
    };

    return (
      <div
        ref={ref}
        className={cn("inline-flex items-center gap-1", className)}
        {...props}
      >
        <div
          className="flex"
          onMouseLeave={handleMouseLeave}
        >
          {Array.from({ length: maxRating }, (_, index) => {
            const fillPercentage = Math.min(
              Math.max(displayRating - index, 0),
              1
            );
            const isFull = fillPercentage === 1;
            const isEmpty = fillPercentage === 0;

            return (
              <button
                key={index}
                type="button"
                className={cn(
                  "relative",
                  interactive && "cursor-pointer hover:scale-110 transition-transform",
                  !interactive && "cursor-default"
                )}
                onClick={() => handleClick(index)}
                onMouseEnter={() => handleMouseEnter(index)}
                disabled={!interactive}
              >
                {/* Empty star (background) */}
                <svg
                  className={cn(
                    sizeClasses[size],
                    "text-gray-200 dark:text-gray-600"
                  )}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>

                {/* Filled star (overlay with clip) */}
                {!isEmpty && (
                  <svg
                    className={cn(
                      sizeClasses[size],
                      "absolute inset-0 text-yellow-400"
                    )}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    style={{
                      clipPath: isFull
                        ? undefined
                        : `inset(0 ${(1 - fillPercentage) * 100}% 0 0)`,
                    }}
                  >
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>

        {showValue && (
          <span className={cn("font-medium", textSizeClasses[size])}>
            {rating.toFixed(1)}
          </span>
        )}

        {count !== undefined && (
          <span
            className={cn("text-muted-foreground", textSizeClasses[size])}
          >
            ({count.toLocaleString()})
          </span>
        )}
      </div>
    );
  }
);
RatingStars.displayName = "RatingStars";

export { RatingStars };
