/**
 * Food Service Helpers
 *
 * API helpers for food ordering functionality
 */

import { check, sleep } from "k6";
import http from "k6/http";
import { generateLocation, getBaseUrl } from "../config";
import { ApiResponse, createHeaders } from "./http";

export interface Restaurant {
  id: string;
  name: string;
  cuisineType: string;
  rating: number;
  deliveryTime: number;
  deliveryFee: number;
  isOpen: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
}

export interface CartItem {
  itemId: string;
  quantity: number;
  price: number;
  customizations?: string[];
}

export interface FoodOrder {
  id: string;
  status: string;
  restaurantId: string;
  items: CartItem[];
  total: number;
  deliveryFee: number;
  estimatedDelivery?: number;
}

// Get nearby restaurants
export function getNearbyRestaurants(
  accessToken: string,
  latitude: number,
  longitude: number
): Restaurant[] | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/restaurants/nearby?lat=${latitude}&lng=${longitude}`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Nearby restaurants - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      restaurants: Restaurant[];
    }>;
    return body.data?.restaurants || [];
  } catch {
    return null;
  }
}

// Search restaurants
export function searchRestaurants(
  accessToken: string,
  query: string,
  latitude: number,
  longitude: number
): Restaurant[] | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/restaurants/search?q=${encodeURIComponent(query)}&lat=${latitude}&lng=${longitude}`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Search restaurants - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      restaurants: Restaurant[];
    }>;
    return body.data?.restaurants || [];
  } catch {
    return null;
  }
}

// Get restaurant menu
export function getRestaurantMenu(
  accessToken: string,
  restaurantId: string
): MenuItem[] | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/restaurants/${restaurantId}/menu`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Get menu - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      menu: MenuItem[];
    }>;
    return body.data?.menu || [];
  } catch {
    return null;
  }
}

// Add item to cart
export function addToCart(
  accessToken: string,
  restaurantId: string,
  itemId: string,
  quantity: number = 1
): boolean {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/cart/items`;

  const response = http.post(
    url,
    JSON.stringify({ restaurantId, itemId, quantity }),
    { headers: createHeaders(accessToken) }
  );

  return check(response, {
    "Add to cart - status is 200 or 201": (r) =>
      r.status === 200 || r.status === 201,
  });
}

// Get cart
export function getCart(accessToken: string): {
  items: CartItem[];
  total: number;
} | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/cart`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Get cart - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      cart: { items: CartItem[]; total: number };
    }>;
    return body.data?.cart || null;
  } catch {
    return null;
  }
}

// Place food order
export function placeFoodOrder(
  accessToken: string,
  deliveryAddress: {
    latitude: number;
    longitude: number;
    address: string;
  },
  paymentMethod: string = "wallet"
): FoodOrder | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/food-orders`;

  const response = http.post(
    url,
    JSON.stringify({
      deliveryAddress,
      paymentMethod,
    }),
    { headers: createHeaders(accessToken) }
  );

  const passed = check(response, {
    "Place order - status is 201": (r) => r.status === 201,
    "Place order - returns order": (r) => {
      try {
        const body = JSON.parse(r.body as string) as ApiResponse<{
          order: FoodOrder;
        }>;
        return body.data?.order?.id !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      order: FoodOrder;
    }>;
    return body.data?.order || null;
  } catch {
    return null;
  }
}

// Get order status
export function getOrderStatus(
  accessToken: string,
  orderId: string
): FoodOrder | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/food-orders/${orderId}`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Get order - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      order: FoodOrder;
    }>;
    return body.data?.order || null;
  } catch {
    return null;
  }
}

// Full food ordering flow simulation
export function simulateFoodOrderFlow(
  accessToken: string,
  city: string = "lagos"
): boolean {
  const location = generateLocation(city);

  // Step 1: Get nearby restaurants
  const restaurants = getNearbyRestaurants(
    accessToken,
    location.lat,
    location.lng
  );

  if (!restaurants || restaurants.length === 0) {
    console.error("No restaurants found");
    return false;
  }

  sleep(1); // User browses restaurants

  // Step 2: Get menu from first restaurant
  const restaurant = restaurants[0];
  const menu = getRestaurantMenu(accessToken, restaurant.id);

  if (!menu || menu.length === 0) {
    console.error("No menu items found");
    return false;
  }

  sleep(0.5); // User browses menu

  // Step 3: Add items to cart
  const selectedItems = menu.slice(0, Math.min(3, menu.length));
  for (const item of selectedItems) {
    addToCart(accessToken, restaurant.id, item.id, 1);
    sleep(0.2);
  }

  // Step 4: Place order
  const order = placeFoodOrder(accessToken, {
    latitude: location.lat,
    longitude: location.lng,
    address: "Test Address, " + city,
  });

  return order !== null;
}
