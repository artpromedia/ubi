/**
 * Skeleton Component
 *
 * Loading placeholder with shimmer animation.
 */

import * as React from "react";

import { cn } from "../lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Use circular shape */
  circle?: boolean;
  /** Width */
  width?: string | number;
  /** Height */
  height?: string | number;
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, circle, width, height, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "animate-pulse bg-muted",
          circle ? "rounded-full" : "rounded-md",
          className,
        )}
        style={{
          width,
          height,
          ...style,
        }}
        {...props}
      />
    );
  },
);
Skeleton.displayName = "Skeleton";

/**
 * Skeleton Text - Multiple lines of skeleton text
 */
interface SkeletonTextProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of lines */
  lines?: number;
  /** Line height */
  lineHeight?: string | number;
}

const SkeletonText = React.forwardRef<HTMLDivElement, SkeletonTextProps>(
  ({ className, lines = 3, lineHeight = "1rem", ...props }, ref) => {
    return (
      <div ref={ref} className={cn("space-y-2", className)} {...props}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn(i === lines - 1 && "w-4/5")}
            style={{ height: lineHeight }}
          />
        ))}
      </div>
    );
  },
);
SkeletonText.displayName = "SkeletonText";

/**
 * Skeleton Avatar - Circular skeleton for avatars
 */
interface SkeletonAvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Size of the avatar */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

const SkeletonAvatar = React.forwardRef<HTMLDivElement, SkeletonAvatarProps>(
  ({ className, size = "md", ...props }, ref) => {
    const sizeMap = {
      xs: "h-6 w-6",
      sm: "h-8 w-8",
      md: "h-10 w-10",
      lg: "h-12 w-12",
      xl: "h-16 w-16",
    };

    return (
      <Skeleton
        ref={ref}
        circle
        className={cn(sizeMap[size], className)}
        {...props}
      />
    );
  },
);
SkeletonAvatar.displayName = "SkeletonAvatar";

/**
 * Skeleton Card - Card-shaped skeleton
 */
interface SkeletonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Show image placeholder */
  showImage?: boolean;
  /** Number of text lines */
  lines?: number;
}

const SkeletonCard = React.forwardRef<HTMLDivElement, SkeletonCardProps>(
  ({ className, showImage = true, lines = 2, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("rounded-xl border bg-card p-4 space-y-4", className)}
        {...props}
      >
        {showImage && <Skeleton className="h-32 w-full" />}
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <SkeletonText lines={lines} lineHeight="0.875rem" />
        </div>
      </div>
    );
  },
);
SkeletonCard.displayName = "SkeletonCard";

/**
 * Skeleton Table Row
 */
interface SkeletonTableRowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of columns */
  columns?: number;
}

const SkeletonTableRow = React.forwardRef<
  HTMLDivElement,
  SkeletonTableRowProps
>(({ className, columns = 4, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("flex items-center gap-4 py-4 border-b", className)}
      {...props}
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4 flex-1"
          style={{
            maxWidth: i === 0 ? "200px" : undefined,
          }}
        />
      ))}
    </div>
  );
});
SkeletonTableRow.displayName = "SkeletonTableRow";

export {
  Skeleton,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonText,
};
