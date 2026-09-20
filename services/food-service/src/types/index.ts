/**
 * Food Service Types
 */

// ============================================
// Enums
// ============================================

export enum RestaurantStatus {
  PENDING = "PENDING",
  ACTIVE = "ACTIVE",
  SUSPENDED = "SUSPENDED",
  CLOSED = "CLOSED",
}

export enum OrderStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  PREPARING = "PREPARING",
  READY_FOR_PICKUP = "READY_FOR_PICKUP",
  PICKED_UP = "PICKED_UP",
  DELIVERED = "DELIVERED",
  CANCELLED = "CANCELLED",
  REFUNDED = "REFUNDED",
}

export enum OrderType {
  DELIVERY = "DELIVERY",
  PICKUP = "PICKUP",
  DINE_IN = "DINE_IN",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  PAID = "PAID",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}

export enum ItemAvailability {
  AVAILABLE = "AVAILABLE",
  OUT_OF_STOCK = "OUT_OF_STOCK",
  LIMITED = "LIMITED",
}

export enum DayOfWeek {
  MONDAY = "MONDAY",
  TUESDAY = "TUESDAY",
  WEDNESDAY = "WEDNESDAY",
  THURSDAY = "THURSDAY",
  FRIDAY = "FRIDAY",
  SATURDAY = "SATURDAY",
  SUNDAY = "SUNDAY",
}

export enum CuisineType {
  AFRICAN = "AFRICAN",
  NIGERIAN = "NIGERIAN",
  KENYAN = "KENYAN",
  GHANAIAN = "GHANAIAN",
  ETHIOPIAN = "ETHIOPIAN",
  SOUTH_AFRICAN = "SOUTH_AFRICAN",
  FAST_FOOD = "FAST_FOOD",
  CHINESE = "CHINESE",
  INDIAN = "INDIAN",
  ITALIAN = "ITALIAN",
  AMERICAN = "AMERICAN",
  MEXICAN = "MEXICAN",
  MIDDLE_EASTERN = "MIDDLE_EASTERN",
  SEAFOOD = "SEAFOOD",
  VEGETARIAN = "VEGETARIAN",
  DESSERTS = "DESSERTS",
  BEVERAGES = "BEVERAGES",
  OTHER = "OTHER",
}

// ============================================
// Interfaces
// ============================================

export interface Location {
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  state?: string;
  country: string;
  postalCode?: string;
}

export interface OpeningHours {
  day: DayOfWeek;
  openTime: string; // HH:MM format
  closeTime: string;
  isClosed: boolean;
}

export interface Restaurant {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description?: string;
  phone: string;
  email?: string;
  location: Location;
  cuisineTypes: CuisineType[];
  status: RestaurantStatus;
  rating: number;
  reviewCount: number;
  priceRange: 1 | 2 | 3 | 4; // $ to $$$$
  deliveryFee: number;
  minimumOrder: number;
  averagePrepTime: number; // minutes
  isOpen: boolean;
  openingHours: OpeningHours[];
  images: string[];
  logo?: string;
  banner?: string;
  features: {
    hasDelivery: boolean;
    hasPickup: boolean;
    hasDineIn: boolean;
    acceptsCash: boolean;
    acceptsCard: boolean;
    acceptsMobileMoney: boolean;
  };
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuCategory {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description?: string;
  price: number;
  discountPrice?: number;
  currency: string;
  images: string[];
  availability: ItemAvailability;
  prepTime: number; // minutes
  calories?: number;
  isVegetarian: boolean;
  isVegan: boolean;
  isGlutenFree: boolean;
  isSpicy: boolean;
  spiceLevel?: 1 | 2 | 3;
  allergens: string[];
  options: MenuItemOption[];
  addons: MenuItemAddon[];
  sortOrder: number;
  isPopular: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuItemOption {
  id: string;
  name: string; // e.g., "Size", "Spice Level"
  required: boolean;
  maxSelections: number;
  choices: {
    id: string;
    name: string;
    priceModifier: number; // can be positive or negative
    isDefault: boolean;
  }[];
}

export interface MenuItemAddon {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions: {
    optionId: string;
    optionName: string;
    choiceId: string;
    choiceName: string;
    priceModifier: number;
  }[];
  selectedAddons: {
    addonId: string;
    addonName: string;
    price: number;
  }[];
  specialInstructions?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  restaurantId: string;
  driverId?: string;
  type: OrderType;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  serviceFee: number;
  tax: number;
  tip: number;
  discount: number;
  total: number;
  currency: string;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  paymentReference?: string;
  deliveryAddress?: Location;
  deliveryInstructions?: string;
  estimatedPrepTime: number;
  estimatedDeliveryTime?: number;
  actualPrepTime?: number;
  actualDeliveryTime?: number;
  confirmedAt?: Date;
  preparingAt?: Date;
  readyAt?: Date;
  pickedUpAt?: Date;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  customerNote?: string;
  restaurantNote?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Review {
  id: string;
  orderId: string;
  customerId: string;
  restaurantId: string;
  rating: number; // 1-5
  foodRating?: number;
  deliveryRating?: number;
  comment?: string;
  images?: string[];
  restaurantReply?: string;
  repliedAt?: Date;
  isVerified: boolean;
  isVisible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// API Types
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

export interface SearchFilters {
  query?: string;
  cuisineTypes?: CuisineType[];
  priceRange?: number[];
  rating?: number;
  hasDelivery?: boolean;
  hasPickup?: boolean;
  isOpen?: boolean;
  maxDeliveryFee?: number;
  maxDistance?: number;
  sortBy?: "rating" | "distance" | "deliveryTime" | "price";
  sortOrder?: "asc" | "desc";
}

// ============================================
// Event Types
// ============================================

export interface OrderEvent {
  type:
    | "order.created"
    | "order.confirmed"
    | "order.preparing"
    | "order.ready"
    | "order.picked_up"
    | "order.delivered"
    | "order.cancelled";
  orderId: string;
  orderNumber: string;
  customerId: string;
  restaurantId: string;
  driverId?: string;
  status: OrderStatus;
  timestamp: Date;
}

export interface RestaurantEvent {
  type:
    | "restaurant.opened"
    | "restaurant.closed"
    | "restaurant.busy"
    | "restaurant.updated";
  restaurantId: string;
  timestamp: Date;
}
