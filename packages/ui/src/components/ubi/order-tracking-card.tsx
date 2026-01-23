/**
 * Order Tracking Card
 *
 * Mobile-optimized card for tracking food/delivery orders with
 * real-time status updates and courier information.
 */

import { cva, type VariantProps } from "class-variance-authority";
import {
  Bike,
  CheckCircle,
  ChefHat,
  MessageSquare,
  Package,
  Phone,
  Store,
  UtensilsCrossed,
} from "lucide-react";
import * as React from "react";

import { cn } from "../../lib/utils";

const orderTrackingCardVariants = cva(
  "relative rounded-2xl border bg-white dark:bg-gray-900 overflow-hidden",
  {
    variants: {
      orderType: {
        food: "border-orange-200 dark:border-orange-800",
        package: "border-blue-200 dark:border-blue-800",
      },
    },
    defaultVariants: {
      orderType: "food",
    },
  },
);

export type OrderStatus =
  | "placed"
  | "confirmed"
  | "preparing"
  | "ready"
  | "picked_up"
  | "on_the_way"
  | "delivered";

export interface OrderTrackingCardProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof orderTrackingCardVariants> {
  /** Order type */
  orderType: "food" | "package";
  /** Current order status */
  status: OrderStatus;
  /** Restaurant/merchant name */
  merchantName: string;
  /** Order ID */
  orderId: string;
  /** ETA in minutes */
  etaMinutes?: number;
  /** Courier information */
  courier?: {
    name: string;
    photo?: string;
    rating: number;
    vehicleType: "bike" | "car" | "scooter" | "walking";
  };
  /** Order items summary */
  items?: { name: string; quantity: number }[];
  /** Total price */
  totalPrice?: string;
  /** Callback when call courier */
  onCallCourier?: () => void;
  /** Callback when message courier */
  onMessageCourier?: () => void;
}

const statusSteps: {
  key: OrderStatus;
  label: string;
  icon: React.ElementType;
}[] = [
  { key: "placed", label: "Order Placed", icon: CheckCircle },
  { key: "confirmed", label: "Confirmed", icon: Store },
  { key: "preparing", label: "Preparing", icon: ChefHat },
  { key: "ready", label: "Ready", icon: Package },
  { key: "picked_up", label: "Picked Up", icon: Bike },
  { key: "on_the_way", label: "On the Way", icon: Bike },
  { key: "delivered", label: "Delivered", icon: CheckCircle },
];

const getStepIndex = (status: OrderStatus): number => {
  return statusSteps.findIndex((s) => s.key === status);
};

export const OrderTrackingCard = ({
  className,
  orderType,
  status,
  merchantName,
  orderId,
  etaMinutes,
  courier,
  items,
  totalPrice,
  onCallCourier,
  onMessageCourier,
  ...props
}: OrderTrackingCardProps) => {
  const currentStepIndex = getStepIndex(status);
  const isFood = orderType === "food";
  const IconComponent = isFood ? UtensilsCrossed : Package;

  return (
    <div
      className={cn(orderTrackingCardVariants({ orderType }), className)}
      {...props}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "h-10 w-10 rounded-full flex items-center justify-center",
                isFood ? "bg-orange-500" : "bg-blue-500",
              )}
            >
              <IconComponent className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">
                {merchantName}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Order #{orderId}
              </p>
            </div>
          </div>
          {etaMinutes !== undefined && status !== "delivered" && (
            <div className="text-right">
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {etaMinutes} min
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">ETA</p>
            </div>
          )}
        </div>
      </div>

      {/* Progress Steps */}
      <div className="px-4 py-4">
        <div className="flex items-center justify-between">
          {statusSteps
            .filter((_, i) => {
              // Show relevant steps based on order type
              if (isFood) {
                return i !== 3;
              } // Skip "Ready" for food (use preparing -> picked_up)
              return i !== 2; // Skip "Preparing" for packages
            })
            .slice(0, 5)
            .map((step, index, arr) => {
              const stepIndex = statusSteps.findIndex(
                (s) => s.key === step.key,
              );
              const isCompleted = currentStepIndex >= stepIndex;
              const isCurrent = currentStepIndex === stepIndex;
              const StepIcon = step.icon;

              return (
                <React.Fragment key={step.key}>
                  <div className="flex flex-col items-center">
                    <div
                      className={cn(
                        "h-8 w-8 rounded-full flex items-center justify-center transition-colors",
                        isCompleted
                          ? isFood
                            ? "bg-orange-500 text-white"
                            : "bg-blue-500 text-white"
                          : "bg-gray-100 dark:bg-gray-800 text-gray-400",
                        isCurrent &&
                          "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-900",
                        isCurrent &&
                          (isFood ? "ring-orange-500" : "ring-blue-500"),
                      )}
                    >
                      <StepIcon className="h-4 w-4" />
                    </div>
                    <p
                      className={cn(
                        "text-[10px] mt-1 text-center max-w-[60px]",
                        isCompleted
                          ? "text-gray-900 dark:text-white font-medium"
                          : "text-gray-400",
                      )}
                    >
                      {step.label}
                    </p>
                  </div>
                  {index < arr.length - 1 && (
                    <div
                      className={cn(
                        "flex-1 h-0.5 mx-1 -mt-4",
                        currentStepIndex > stepIndex
                          ? isFood
                            ? "bg-orange-500"
                            : "bg-blue-500"
                          : "bg-gray-200 dark:bg-gray-700",
                      )}
                    />
                  )}
                </React.Fragment>
              );
            })}
        </div>
      </div>

      {/* Courier Info */}
      {courier && (status === "picked_up" || status === "on_the_way") && (
        <div className="px-4 pb-4">
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
            <div className="flex items-center gap-3">
              {courier.photo ? (
                <img
                  src={courier.photo}
                  alt={courier.name}
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold">
                  {courier.name.charAt(0)}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 dark:text-white truncate">
                  {courier.name}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  ★ {courier.rating.toFixed(1)} • {courier.vehicleType}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onCallCourier}
                  className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors"
                  aria-label="Call courier"
                >
                  <Phone className="h-4 w-4" />
                </button>
                <button
                  onClick={onMessageCourier}
                  className="p-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                  aria-label="Message courier"
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Order Summary */}
      {items && items.length > 0 && (
        <div className="px-4 pb-4">
          <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                Order Summary
              </p>
              {totalPrice && (
                <p className="font-semibold text-gray-900 dark:text-white">
                  {totalPrice}
                </p>
              )}
            </div>
            <div className="space-y-1">
              {items.slice(0, 3).map((item, i) => (
                <p key={i} className="text-sm text-gray-600 dark:text-gray-400">
                  {item.quantity}x {item.name}
                </p>
              ))}
              {items.length > 3 && (
                <p className="text-sm text-gray-400">
                  +{items.length - 3} more items
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { orderTrackingCardVariants };
