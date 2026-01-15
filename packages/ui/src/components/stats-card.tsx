/**
 * Stats Card Component
 *
 * Display statistics with trend indicators for dashboards.
 */

import { cva, type VariantProps } from "class-variance-authority";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";


import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { cn } from "../lib/utils";

import type * as React from "react";

const statsTrendVariants = cva(
  "inline-flex items-center gap-1 text-xs font-medium",
  {
    variants: {
      trend: {
        up: "text-success",
        down: "text-destructive",
        neutral: "text-muted-foreground",
      },
    },
    defaultVariants: {
      trend: "neutral",
    },
  }
);

interface StatsTrendProps extends VariantProps<typeof statsTrendVariants> {
  value: number | string;
  label?: string;
  showIcon?: boolean;
}

const StatsTrend = ({
  trend,
  value,
  label,
  showIcon = true,
}: StatsTrendProps) => {
  const Icon =
    trend === "up" ? ArrowUp : trend === "down" ? ArrowDown : Minus;

  return (
    <span className={cn(statsTrendVariants({ trend }))}>
      {showIcon && <Icon className="h-3 w-3" />}
      <span>{value}</span>
      {label && <span className="text-muted-foreground">{label}</span>}
    </span>
  );
};

interface StatsCardProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
  trend?: "up" | "down" | "neutral";
  trendValue?: string | number;
  trendLabel?: string;
  loading?: boolean;
}

const StatsCard = ({
  title,
  value,
  description,
  icon,
  trend,
  trendValue,
  trendLabel,
  loading,
  className,
  ...props
}: StatsCardProps) => {
  if (loading) {
    return (
      <Card className={className} {...props}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          {icon && (
            <div className="h-8 w-8 animate-pulse rounded bg-muted" />
          )}
        </CardHeader>
        <CardContent>
          <div className="h-8 w-32 animate-pulse rounded bg-muted mb-2" />
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon && (
          <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
            {icon}
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-heading">{value}</div>
        {(description || trendValue) && (
          <div className="flex items-center gap-2 mt-1">
            {trendValue && (
              <StatsTrend
                trend={trend}
                value={trendValue}
                label={trendLabel}
              />
            )}
            {description && !trendValue && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Compact stats for inline display
interface CompactStatsProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  trendValue?: string | number;
  className?: string;
}

const CompactStats = ({
  label,
  value,
  trend,
  trendValue,
  className,
}: CompactStatsProps) => (
  <div className={cn("flex flex-col", className)}>
    <span className="text-xs text-muted-foreground">{label}</span>
    <div className="flex items-baseline gap-2">
      <span className="text-lg font-semibold">{value}</span>
      {trendValue && <StatsTrend trend={trend} value={trendValue} />}
    </div>
  </div>
);

// Stats grid layout
interface StatsGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

const StatsGrid = ({ children, columns = 4, className }: StatsGridProps) => (
  <div
    className={cn(
      "grid gap-4",
      {
        "grid-cols-1 sm:grid-cols-2": columns === 2,
        "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3": columns === 3,
        "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4": columns === 4,
      },
      className
    )}
  >
    {children}
  </div>
);

export { CompactStats, StatsCard, StatsGrid, StatsTrend, statsTrendVariants };

