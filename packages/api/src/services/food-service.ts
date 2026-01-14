/**
 * Food Service API
 *
 * API client for food ordering operations (UBI Bites).
 */

import { type ApiClient, getApiClient } from "../client";
import type {
  Address,
  ApiResponse,
  Coordinates,
  Money,
  PaginatedResponse,
  PaginationParams,
  Timestamps,
} from "../types";

// Restaurant types
export interface Restaurant extends Timestamps {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  coverUrl?: string;
  cuisineTypes: string[];
  address: Address;
  rating: number;
  reviewCount: number;
  priceLevel: 1 | 2 | 3 | 4;
  isOpen: boolean;
  openingHours: OpeningHours[];
  deliveryFee: Money;
  minOrderAmount: Money;
  estimatedDeliveryTime: { min: number; max: number };
  features: RestaurantFeature[];
}

export interface OpeningHours {
  dayOfWeek: number; // 0-6
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
  isClosed: boolean;
}

export type RestaurantFeature =
  | "delivery"
  | "pickup"
  | "dine_in"
  | "halal"
  | "vegetarian"
  | "vegan"
  | "alcohol";

// Menu types
export interface MenuCategory {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  items: MenuItem[];
  sortOrder: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  price: Money;
  originalPrice?: Money; // for discounts
  calories?: number;
  preparationTime?: number;
  isAvailable: boolean;
  isPopular: boolean;
  isNew: boolean;
  dietaryInfo: DietaryInfo[];
  customizations?: MenuItemCustomization[];
}

export type DietaryInfo =
  | "vegetarian"
  | "vegan"
  | "gluten_free"
  | "dairy_free"
  | "halal"
  | "contains_nuts";

export interface MenuItemCustomization {
  id: string;
  name: string;
  type: "single" | "multiple";
  required: boolean;
  minSelections?: number;
  maxSelections?: number;
  options: CustomizationOption[];
}

export interface CustomizationOption {
  id: string;
  name: string;
  price?: Money;
  isDefault?: boolean;
}

// Order types
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready_for_pickup"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type OrderType = "delivery" | "pickup";

export interface FoodOrder extends Timestamps {
  id: string;
  orderNumber: string;
  userId: string;
  restaurantId: string;
  restaurant?: Restaurant;
  status: OrderStatus;
  type: OrderType;
  items: OrderItem[];
  subtotal: Money;
  deliveryFee?: Money;
  serviceFee?: Money;
  discount?: Money;
  tip?: Money;
  total: Money;
  paymentMethod: string;
  paymentStatus: "pending" | "paid" | "refunded";
  deliveryAddress?: Address;
  deliveryInstructions?: string;
  estimatedDeliveryTime?: string;
  actualDeliveryTime?: string;
  driverId?: string;
  rating?: number;
  review?: string;
  cancelReason?: string;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: Money;
  totalPrice: Money;
  customizations?: {
    customizationId: string;
    customizationName: string;
    optionId: string;
    optionName: string;
    price?: Money;
  }[];
  specialInstructions?: string;
}

// Cart types
export interface CartItem {
  menuItemId: string;
  quantity: number;
  customizations?: {
    customizationId: string;
    optionId: string;
  }[];
  specialInstructions?: string;
}

// Request/Response types
export interface CreateOrderRequest {
  restaurantId: string;
  type: OrderType;
  items: CartItem[];
  deliveryAddress?: Omit<Address, "coordinates">;
  deliveryInstructions?: string;
  paymentMethod: string;
  tip?: number;
  promoCode?: string;
  scheduledFor?: string;
}

export interface RestaurantFilters extends PaginationParams {
  cuisineTypes?: string[];
  priceLevel?: number[];
  rating?: number;
  isOpen?: boolean;
  features?: RestaurantFeature[];
  search?: string;
  near?: Coordinates;
  radius?: number;
}

export interface OrderFilters extends PaginationParams {
  status?: OrderStatus;
  type?: OrderType;
  restaurantId?: string;
  dateFrom?: string;
  dateTo?: string;
}

// Food Service API
export class FoodServiceApi {
  private client: ApiClient;
  private basePath = "food";

  constructor(client?: ApiClient) {
    this.client = client ?? getApiClient();
  }

  // Restaurants
  async getRestaurants(
    filters?: RestaurantFilters
  ): Promise<PaginatedResponse<Restaurant>> {
    return this.client.get(`${this.basePath}/restaurants`, {
      searchParams: filters as any,
    });
  }

  async getRestaurant(idOrSlug: string): Promise<ApiResponse<Restaurant>> {
    return this.client.get(`${this.basePath}/restaurants/${idOrSlug}`);
  }

  async getRestaurantMenu(
    restaurantId: string
  ): Promise<ApiResponse<MenuCategory[]>> {
    return this.client.get(`${this.basePath}/restaurants/${restaurantId}/menu`);
  }

  async searchRestaurants(
    query: string,
    location?: Coordinates
  ): Promise<ApiResponse<Restaurant[]>> {
    return this.client.get(`${this.basePath}/restaurants/search`, {
      searchParams: {
        q: query,
        ...(location && { lat: location.latitude, lng: location.longitude }),
      },
    });
  }

  async getFeaturedRestaurants(
    location?: Coordinates
  ): Promise<ApiResponse<Restaurant[]>> {
    return this.client.get(`${this.basePath}/restaurants/featured`, {
      searchParams: location && {
        lat: location.latitude,
        lng: location.longitude,
      },
    });
  }

  async getCuisineTypes(): Promise<
    ApiResponse<{ id: string; name: string; imageUrl?: string }[]>
  > {
    return this.client.get(`${this.basePath}/cuisine-types`);
  }

  // Orders
  async createOrder(data: CreateOrderRequest): Promise<ApiResponse<FoodOrder>> {
    return this.client.post(`${this.basePath}/orders`, data);
  }

  async getOrder(id: string): Promise<ApiResponse<FoodOrder>> {
    return this.client.get(`${this.basePath}/orders/${id}`);
  }

  async getOrderHistory(
    filters?: OrderFilters
  ): Promise<PaginatedResponse<FoodOrder>> {
    return this.client.get(`${this.basePath}/orders`, {
      searchParams: filters as any,
    });
  }

  async getActiveOrder(): Promise<ApiResponse<FoodOrder | null>> {
    return this.client.get(`${this.basePath}/orders/active`);
  }

  async cancelOrder(
    id: string,
    reason?: string
  ): Promise<ApiResponse<FoodOrder>> {
    return this.client.post(`${this.basePath}/orders/${id}/cancel`, { reason });
  }

  async rateOrder(
    id: string,
    data: { rating: number; review?: string; tip?: number }
  ): Promise<ApiResponse<FoodOrder>> {
    return this.client.post(`${this.basePath}/orders/${id}/rate`, data);
  }

  async reorder(orderId: string): Promise<ApiResponse<CartItem[]>> {
    return this.client.post(`${this.basePath}/orders/${orderId}/reorder`);
  }

  // Order tracking
  getOrderTrackingUrl(orderId: string): string {
    // WebSocket URL is constructed based on the API base URL
    return `/ws/food/orders/${orderId}`;
  }

  // Cart/Checkout preview
  async previewOrder(data: Omit<CreateOrderRequest, "paymentMethod">): Promise<
    ApiResponse<{
      subtotal: Money;
      deliveryFee?: Money;
      serviceFee: Money;
      discount?: Money;
      total: Money;
      estimatedDeliveryTime: { min: number; max: number };
    }>
  > {
    return this.client.post(`${this.basePath}/orders/preview`, data);
  }

  // Favorites
  async getFavoriteRestaurants(): Promise<ApiResponse<Restaurant[]>> {
    return this.client.get(`${this.basePath}/favorites`);
  }

  async addFavorite(restaurantId: string): Promise<ApiResponse<void>> {
    return this.client.post(`${this.basePath}/favorites/${restaurantId}`);
  }

  async removeFavorite(restaurantId: string): Promise<ApiResponse<void>> {
    return this.client.delete(`${this.basePath}/favorites/${restaurantId}`);
  }

  // Restaurant portal endpoints
  async getRestaurantOrders(
    filters?: OrderFilters
  ): Promise<PaginatedResponse<FoodOrder>> {
    return this.client.get(`${this.basePath}/restaurant/orders`, {
      searchParams: filters as any,
    });
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus
  ): Promise<ApiResponse<FoodOrder>> {
    return this.client.patch(
      `${this.basePath}/restaurant/orders/${orderId}/status`,
      { status }
    );
  }

  async updateMenuItem(
    menuItemId: string,
    data: Partial<MenuItem>
  ): Promise<ApiResponse<MenuItem>> {
    return this.client.patch(
      `${this.basePath}/restaurant/menu/${menuItemId}`,
      data
    );
  }

  async toggleMenuItemAvailability(
    menuItemId: string
  ): Promise<ApiResponse<MenuItem>> {
    return this.client.post(
      `${this.basePath}/restaurant/menu/${menuItemId}/toggle-availability`
    );
  }
}

// Export singleton instance
let foodServiceApi: FoodServiceApi | null = null;

export function getFoodServiceApi(): FoodServiceApi {
  if (!foodServiceApi) {
    foodServiceApi = new FoodServiceApi();
  }
  return foodServiceApi;
}
