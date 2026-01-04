/**
 * Restaurant Fixtures
 *
 * Pre-defined test restaurants and menu items.
 */

import type { TestFoodOrder, TestMenuItem, TestRestaurant } from "../types";
import { LAGOS_LOCATIONS, NAIROBI_LOCATIONS } from "./locations.fixture";
import { TEST_RIDERS } from "./users.fixture";

/**
 * Test restaurants
 */
export const TEST_RESTAURANTS: Record<string, TestRestaurant> = {
  MAMA_PUTTS: {
    id: "restaurant_001",
    name: "Mama Putt's Kitchen",
    description: "Authentic Nigerian home-cooked meals",
    cuisine: ["Nigerian"],
    rating: 4.7,
    reviewCount: 523,
    priceRange: "$$",
    deliveryFee: 500,
    minimumOrder: 1500,
    estimatedDeliveryTime: 35,
    isOpen: true,
    openingHours: {
      monday: { open: "08:00", close: "22:00" },
      tuesday: { open: "08:00", close: "22:00" },
      wednesday: { open: "08:00", close: "22:00" },
      thursday: { open: "08:00", close: "22:00" },
      friday: { open: "08:00", close: "23:00" },
      saturday: { open: "09:00", close: "23:00" },
      sunday: { open: "10:00", close: "21:00" },
    },
    location: {
      ...LAGOS_LOCATIONS.VICTORIA_ISLAND,
      address: "25 Adeola Odeku Street, Victoria Island",
    },
    images: [
      "https://example.com/restaurants/mama-putts-1.jpg",
      "https://example.com/restaurants/mama-putts-2.jpg",
    ],
    tags: ["nigerian", "local", "popular", "comfort-food"],
    createdAt: new Date("2023-01-15"),
  },

  JAVA_HOUSE: {
    id: "restaurant_002",
    name: "Java House",
    description: "East African coffee and continental cuisine",
    cuisine: ["Continental", "Coffee"],
    rating: 4.5,
    reviewCount: 1247,
    priceRange: "$$$",
    deliveryFee: 200,
    minimumOrder: 800,
    estimatedDeliveryTime: 25,
    isOpen: true,
    openingHours: {
      monday: { open: "07:00", close: "22:00" },
      tuesday: { open: "07:00", close: "22:00" },
      wednesday: { open: "07:00", close: "22:00" },
      thursday: { open: "07:00", close: "22:00" },
      friday: { open: "07:00", close: "23:00" },
      saturday: { open: "08:00", close: "23:00" },
      sunday: { open: "08:00", close: "21:00" },
    },
    location: {
      ...NAIROBI_LOCATIONS.WESTLANDS,
      address: "Sarit Centre, Westlands",
    },
    images: ["https://example.com/restaurants/java-house-1.jpg"],
    tags: ["coffee", "continental", "breakfast", "premium"],
    createdAt: new Date("2022-06-01"),
  },

  SUYA_SPOT: {
    id: "restaurant_003",
    name: "The Suya Spot",
    description: "Best suya and grilled meats in Lagos",
    cuisine: ["Nigerian", "Grill"],
    rating: 4.8,
    reviewCount: 892,
    priceRange: "$",
    deliveryFee: 400,
    minimumOrder: 1000,
    estimatedDeliveryTime: 30,
    isOpen: true,
    openingHours: {
      monday: { open: "16:00", close: "02:00" },
      tuesday: { open: "16:00", close: "02:00" },
      wednesday: { open: "16:00", close: "02:00" },
      thursday: { open: "16:00", close: "02:00" },
      friday: { open: "16:00", close: "03:00" },
      saturday: { open: "16:00", close: "03:00" },
      sunday: { open: "16:00", close: "00:00" },
    },
    location: {
      ...LAGOS_LOCATIONS.LEKKI,
      address: "Admiralty Way, Lekki Phase 1",
    },
    images: ["https://example.com/restaurants/suya-spot-1.jpg"],
    tags: ["suya", "grill", "late-night", "budget-friendly"],
    createdAt: new Date("2023-08-20"),
  },

  CLOSED_RESTAURANT: {
    id: "restaurant_closed",
    name: "Temporarily Closed Kitchen",
    description: "Currently undergoing renovations",
    cuisine: ["Nigerian"],
    rating: 4.2,
    reviewCount: 156,
    priceRange: "$$",
    deliveryFee: 500,
    minimumOrder: 2000,
    estimatedDeliveryTime: 45,
    isOpen: false,
    openingHours: {
      monday: { open: "00:00", close: "00:00" },
      tuesday: { open: "00:00", close: "00:00" },
      wednesday: { open: "00:00", close: "00:00" },
      thursday: { open: "00:00", close: "00:00" },
      friday: { open: "00:00", close: "00:00" },
      saturday: { open: "00:00", close: "00:00" },
      sunday: { open: "00:00", close: "00:00" },
    },
    location: LAGOS_LOCATIONS.IKEJA,
    images: [],
    tags: ["closed"],
    createdAt: new Date("2023-01-01"),
  },
};

/**
 * Test menu items
 */
export const TEST_MENU_ITEMS: Record<string, TestMenuItem> = {
  JOLLOF_RICE: {
    id: "menu_001",
    name: "Jollof Rice with Chicken",
    description: "Spicy tomato rice with grilled chicken and plantain",
    price: 3500,
    currency: "NGN",
    category: "Main Course",
    image: "https://example.com/menu/jollof-rice.jpg",
    isAvailable: true,
    preparationTime: 20,
    options: [
      {
        name: "Protein",
        choices: ["Chicken", "Beef", "Fish", "Turkey"],
        required: true,
        maxChoices: 1,
      },
      {
        name: "Add-ons",
        choices: ["Extra Plantain", "Coleslaw", "Moi Moi"],
        required: false,
        maxChoices: 3,
      },
    ],
    tags: ["main", "popular", "signature"],
  },

  SUYA: {
    id: "menu_002",
    name: "Beef Suya (Full)",
    description: "Spicy grilled beef skewers with yaji seasoning",
    price: 5000,
    currency: "NGN",
    category: "Grill",
    image: "https://example.com/menu/suya.jpg",
    isAvailable: true,
    preparationTime: 15,
    options: [
      {
        name: "Spice Level",
        choices: ["Mild", "Medium", "Hot", "Extra Hot"],
        required: false,
        maxChoices: 1,
      },
    ],
    tags: ["grill", "popular", "spicy"],
  },

  EGUSI_SOUP: {
    id: "menu_003",
    name: "Egusi Soup with Pounded Yam",
    description: "Melon seed soup with assorted meat, served with pounded yam",
    price: 4500,
    currency: "NGN",
    category: "Traditional",
    image: "https://example.com/menu/egusi.jpg",
    isAvailable: true,
    preparationTime: 25,
    options: [
      {
        name: "Swallow",
        choices: ["Pounded Yam", "Eba", "Fufu", "Semovita"],
        required: true,
        maxChoices: 1,
      },
    ],
    tags: ["traditional", "soup", "comfort-food"],
  },

  UNAVAILABLE_ITEM: {
    id: "menu_unavailable",
    name: "Special Weekend Dish",
    description: "Available only on weekends",
    price: 6000,
    currency: "NGN",
    category: "Special",
    image: "https://example.com/menu/special.jpg",
    isAvailable: false,
    preparationTime: 30,
    tags: ["special", "weekend-only"],
  },

  KENYAN_PILAU: {
    id: "menu_004",
    name: "Kenyan Pilau",
    description: "Aromatic spiced rice with tender beef",
    price: 650,
    currency: "KES",
    category: "Main Course",
    image: "https://example.com/menu/pilau.jpg",
    isAvailable: true,
    preparationTime: 20,
    options: [
      {
        name: "Protein",
        choices: ["Beef", "Chicken", "Goat"],
        required: true,
        maxChoices: 1,
      },
    ],
    tags: ["main", "kenyan", "aromatic"],
  },
};

/**
 * Test food orders
 */
export const TEST_FOOD_ORDERS: Record<string, TestFoodOrder> = {
  COMPLETED_ORDER: {
    id: "order_001",
    orderNumber: "UBI-ABC123",
    userId: TEST_RIDERS.ADAOBI_RIDER.id,
    restaurantId: TEST_RESTAURANTS.MAMA_PUTTS.id,
    restaurant: {
      id: TEST_RESTAURANTS.MAMA_PUTTS.id,
      name: TEST_RESTAURANTS.MAMA_PUTTS.name,
      image: TEST_RESTAURANTS.MAMA_PUTTS.images[0],
    },
    items: [
      {
        id: "item_001",
        menuItemId: TEST_MENU_ITEMS.JOLLOF_RICE.id,
        name: TEST_MENU_ITEMS.JOLLOF_RICE.name,
        price: TEST_MENU_ITEMS.JOLLOF_RICE.price,
        quantity: 2,
        subtotal: 7000,
        options: [{ name: "Protein", choice: "Chicken" }],
      },
      {
        id: "item_002",
        menuItemId: TEST_MENU_ITEMS.SUYA.id,
        name: TEST_MENU_ITEMS.SUYA.name,
        price: TEST_MENU_ITEMS.SUYA.price,
        quantity: 1,
        subtotal: 5000,
        options: [{ name: "Spice Level", choice: "Hot" }],
      },
    ],
    status: "delivered",
    deliveryAddress: LAGOS_LOCATIONS.LEKKI,
    pricing: {
      currency: "NGN",
      subtotal: 12000,
      deliveryFee: 500,
      serviceFee: 600,
      discount: 0,
      total: 13100,
    },
    paymentMethod: "mobile_money",
    paymentStatus: "paid",
    estimatedDeliveryTime: 35,
    confirmedAt: new Date("2024-06-01T12:02:00Z"),
    preparingAt: new Date("2024-06-01T12:03:00Z"),
    readyAt: new Date("2024-06-01T12:25:00Z"),
    pickedUpAt: new Date("2024-06-01T12:28:00Z"),
    deliveredAt: new Date("2024-06-01T12:50:00Z"),
    driverId: "driver_food_001",
    rating: {
      foodRating: 5,
      deliveryRating: 4.5,
      comment: "Food was delicious and still hot!",
    },
    createdAt: new Date("2024-06-01T12:00:00Z"),
    updatedAt: new Date("2024-06-01T12:50:00Z"),
  },

  PENDING_ORDER: {
    id: "order_pending",
    orderNumber: "UBI-DEF456",
    userId: TEST_RIDERS.NJERI_RIDER.id,
    restaurantId: TEST_RESTAURANTS.JAVA_HOUSE.id,
    restaurant: {
      id: TEST_RESTAURANTS.JAVA_HOUSE.id,
      name: TEST_RESTAURANTS.JAVA_HOUSE.name,
      image: TEST_RESTAURANTS.JAVA_HOUSE.images[0],
    },
    items: [
      {
        id: "item_003",
        menuItemId: TEST_MENU_ITEMS.KENYAN_PILAU.id,
        name: TEST_MENU_ITEMS.KENYAN_PILAU.name,
        price: TEST_MENU_ITEMS.KENYAN_PILAU.price,
        quantity: 1,
        subtotal: 650,
        options: [{ name: "Protein", choice: "Beef" }],
      },
    ],
    status: "pending",
    deliveryAddress: NAIROBI_LOCATIONS.KILIMANI,
    pricing: {
      currency: "KES",
      subtotal: 650,
      deliveryFee: 200,
      serviceFee: 33,
      discount: 0,
      total: 883,
    },
    paymentMethod: "mobile_money",
    paymentStatus: "pending",
    estimatedDeliveryTime: 25,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};
