/**
 * Order status constants for UBI
 */

export const OrderStatus = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  PREPARING: "PREPARING",
  READY: "READY",
  PICKED_UP: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
} as const;

export type OrderStatusType = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * Get display text for order status
 */
export function getOrderStatusLabel(status: OrderStatusType): string {
  const labels: Record<OrderStatusType, string> = {
    PENDING: "Pending",
    CONFIRMED: "Confirmed",
    PREPARING: "Preparing",
    READY: "Ready for Pickup",
    PICKED_UP: "Picked Up",
    IN_TRANSIT: "On the Way",
    DELIVERED: "Delivered",
    CANCELLED: "Cancelled",
    REFUNDED: "Refunded",
  };
  return labels[status];
}

/**
 * Get color for order status (for UI)
 */
export function getOrderStatusColor(status: OrderStatusType): string {
  const colors: Record<OrderStatusType, string> = {
    PENDING: "gray",
    CONFIRMED: "blue",
    PREPARING: "yellow",
    READY: "orange",
    PICKED_UP: "indigo",
    IN_TRANSIT: "purple",
    DELIVERED: "green",
    CANCELLED: "red",
    REFUNDED: "red",
  };
  return colors[status];
}

/**
 * Check if order can be cancelled
 */
export function canCancelOrder(status: OrderStatusType): boolean {
  return ["PENDING", "CONFIRMED"].includes(status);
}

/**
 * Get next valid statuses for an order
 */
export function getNextValidStatuses(
  current: OrderStatusType,
): OrderStatusType[] {
  const transitions: Record<OrderStatusType, OrderStatusType[]> = {
    PENDING: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["PREPARING", "CANCELLED"],
    PREPARING: ["READY", "CANCELLED"],
    READY: ["PICKED_UP", "CANCELLED"],
    PICKED_UP: ["IN_TRANSIT"],
    IN_TRANSIT: ["DELIVERED"],
    DELIVERED: ["REFUNDED"],
    CANCELLED: [],
    REFUNDED: [],
  };
  return transitions[current];
}
