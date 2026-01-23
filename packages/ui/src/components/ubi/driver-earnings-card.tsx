/**
 * Driver Earnings Card
 *
 * Mobile-optimized card showing driver earnings summary
 * with daily/weekly breakdown and performance metrics.
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
  ChevronRight,
  Clock,
  DollarSign,
  Navigation,
  Star,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { cn } from "../../lib/utils";

import type * as React from "react";

const earningsCardVariants = cva(
  "relative rounded-2xl border bg-white dark:bg-gray-900 overflow-hidden",
  {
    variants: {
      period: {
        daily: "border-green-200 dark:border-green-800",
        weekly: "border-blue-200 dark:border-blue-800",
        monthly: "border-purple-200 dark:border-purple-800",
      },
    },
    defaultVariants: {
      period: "daily",
    },
  },
);

export interface DriverEarningsCardProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof earningsCardVariants> {
  /** Period type */
  period: "daily" | "weekly" | "monthly";
  /** Period label (e.g., "Today", "This Week") */
  periodLabel: string;
  /** Total earnings amount */
  totalEarnings: string;
  /** Net earnings after deductions */
  netEarnings: string;
  /** Percentage change from previous period */
  percentageChange?: number;
  /** Breakdown of earnings */
  breakdown?: {
    trips: string;
    tips: string;
    bonuses: string;
    deductions: string;
  };
  /** Performance metrics */
  metrics?: {
    trips: number;
    hours: number;
    distance: string;
    rating: number;
  };
  /** Currency symbol */
  currency?: string;
  /** Callback when "See Details" is pressed */
  onSeeDetails?: () => void;
  /** Callback when "Cash Out" is pressed */
  onCashOut?: () => void;
}

export const DriverEarningsCard = ({
  className,
  period,
  periodLabel,
  totalEarnings,
  netEarnings,
  percentageChange,
  breakdown,
  metrics,
  currency = "₦",
  onSeeDetails,
  onCashOut,
  ...props
}: DriverEarningsCardProps) => {
  const isPositiveChange = percentageChange && percentageChange >= 0;

  return (
    <div className={cn(earningsCardVariants({ period }), className)} {...props}>
      {/* Header with gradient */}
      <div
        className={cn(
          "p-4 text-white",
          period === "daily" &&
            "bg-gradient-to-r from-green-500 to-emerald-600",
          period === "weekly" && "bg-gradient-to-r from-blue-500 to-cyan-600",
          period === "monthly" &&
            "bg-gradient-to-r from-purple-500 to-pink-600",
        )}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm opacity-90">{periodLabel}</p>
            <p className="text-3xl font-bold mt-1">
              {currency}
              {totalEarnings}
            </p>
            {percentageChange !== undefined && (
              <div
                className={cn(
                  "inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full text-xs font-medium",
                  isPositiveChange ? "bg-white/20" : "bg-red-500/50",
                )}
              >
                {isPositiveChange ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                {Math.abs(percentageChange)}% vs last{" "}
                {period === "daily"
                  ? "day"
                  : period === "weekly"
                    ? "week"
                    : "month"}
              </div>
            )}
          </div>
          <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
            <DollarSign className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Earnings Breakdown */}
      {breakdown && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Breakdown
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Trip fares
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {currency}
                {breakdown.trips}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Tips
              </span>
              <span className="text-sm font-medium text-green-600 dark:text-green-400">
                +{currency}
                {breakdown.tips}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Bonuses
              </span>
              <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                +{currency}
                {breakdown.bonuses}
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Service fee
              </span>
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                -{currency}
                {breakdown.deductions}
              </span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                Net Earnings
              </span>
              <span className="text-lg font-bold text-gray-900 dark:text-white">
                {currency}
                {netEarnings}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Performance Metrics */}
      {metrics && (
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Performance
          </p>
          <div className="grid grid-cols-4 gap-3">
            <div className="text-center">
              <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-1">
                <Navigation className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {metrics.trips}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Trips</p>
            </div>
            <div className="text-center">
              <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-1">
                <Clock className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {metrics.hours}h
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Hours</p>
            </div>
            <div className="text-center">
              <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-1">
                <Navigation className="h-4 w-4 text-purple-500" />
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {metrics.distance}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">km</p>
            </div>
            <div className="text-center">
              <div className="h-10 w-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-1">
                <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
              </div>
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {metrics.rating.toFixed(1)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Rating</p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4 flex gap-3">
        <button
          onClick={onSeeDetails}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          See Details
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={onCashOut}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 transition-colors"
        >
          <Wallet className="h-4 w-4" />
          Cash Out
        </button>
      </div>
    </div>
  );
};

export { earningsCardVariants };
