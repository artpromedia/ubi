/**
 * Food Order Factory
 *
 * Creates test restaurants, menu items, and food orders.
 */

import { faker } from "@faker-js/faker";
import type {
  TestFoodOrder,
  TestMenuItem,
  TestOrderItem,
  TestOrderStatus,
  TestRestaurant,
} from "../types";
import { randomInt, randomPick, uuid } from "../utils";
import { createLocation } from "./location.factory";

// African cuisine categories and items
const CUISINE_TYPES = [
  "Nigerian",
  "Kenyan",
  "Ghanaian",
  "Ethiopian",
  "South African",
  "Fast Food",
  "Continental",
  "Chinese",
  "Indian",
  "Lebanese",
];

const MENU_ITEMS_BY_CUISINE: Record<
  string,
  Array<{ name: string; description: string; category: string }>
> = {
  Nigerian: [
    {
      name: "Jollof Rice with Chicken",
      description: "Spicy tomato rice with grilled chicken",
      category: "Main Course",
    },
    {
      name: "Fried Rice with Beef",
      description: "Nigerian-style fried rice with beef strips",
      category: "Main Course",
    },
    {
      name: "Egusi Soup with Pounded Yam",
      description: "Melon seed soup with pounded yam",
      category: "Traditional",
    },
    {
      name: "Suya",
      description: "Spicy grilled beef skewers",
      category: "Appetizers",
    },
    {
      name: "Pepper Soup",
      description: "Spicy catfish pepper soup",
      category: "Soup",
    },
    { name: "Moi Moi", description: "Steamed bean pudding", category: "Sides" },
    {
      name: "Puff Puff",
      description: "Sweet fried dough balls",
      category: "Snacks",
    },
    {
      name: "Chapman",
      description: "Nigerian cocktail drink",
      category: "Drinks",
    },
  ],
  Kenyan: [
    {
      name: "Nyama Choma",
      description: "Grilled meat with ugali",
      category: "Main Course",
    },
    {
      name: "Pilau",
      description: "Spiced rice with meat",
      category: "Main Course",
    },
    {
      name: "Ugali with Sukuma",
      description: "Cornmeal with collard greens",
      category: "Traditional",
    },
    {
      name: "Samosas",
      description: "Fried pastry with meat filling",
      category: "Appetizers",
    },
    {
      name: "Mandazi",
      description: "East African fried bread",
      category: "Snacks",
    },
    { name: "Kenyan Tea", description: "Chai with milk", category: "Drinks" },
  ],
  Ethiopian: [
    {
      name: "Doro Wat",
      description: "Spicy chicken stew with injera",
      category: "Main Course",
    },
    {
      name: "Kitfo",
      description: "Ethiopian beef tartare",
      category: "Main Course",
    },
    {
      name: "Tibs",
      description: "Sautéed meat with vegetables",
      category: "Main Course",
    },
    { name: "Shiro", description: "Chickpea stew", category: "Vegetarian" },
    { name: "Injera", description: "Sourdough flatbread", category: "Sides" },
  ],
  "Fast Food": [
    {
      name: "Chicken Burger",
      description: "Crispy chicken with special sauce",
      category: "Burgers",
    },
    {
      name: "Beef Shawarma",
      description: "Grilled beef wrap with tahini",
      category: "Wraps",
    },
    {
      name: "Chicken Wings",
      description: "Spicy buffalo wings",
      category: "Appetizers",
    },
    {
      name: "French Fries",
      description: "Crispy golden fries",
      category: "Sides",
    },
    { name: "Meat Pie", description: "Savory meat pastry", category: "Snacks" },
    {
      name: "Soft Drink",
      description: "Cola, Fanta, or Sprite",
      category: "Drinks",
    },
  ],
};

const RESTAURANT_NAME_TEMPLATES = [
  "{owner}'s Kitchen",
  "The {adjective} {food}",
  "{cuisine} House",
  "{name} Restaurant",
  "{adjective} {cuisine} Grill",
  "{location} Eatery",
];

const ADJECTIVES = [
  "Golden",
  "Royal",
  "Delicious",
  "Tasty",
  "Fresh",
  "Spicy",
  "Sweet",
  "African",
];
const FOOD_WORDS = ["Pot", "Plate", "Table", "Grill", "Kitchen", "Cuisine"];

interface RestaurantFactoryOptions {
  city?: string;
  cuisine?: string;
  isOpen?: boolean;
  rating?: number;
}

interface MenuItemFactoryOptions {
  cuisine?: string;
  currency?: string;
  isAvailable?: boolean;
}

interface FoodOrderFactoryOptions {
  status?: TestOrderStatus;
  itemCount?: number;
  currency?: string;
  city?: string;
}

/**
 * Generate a restaurant name
 */
function generateRestaurantName(cuisine: string): string {
  const template = randomPick(RESTAURANT_NAME_TEMPLATES);
  return template
    .replace("{owner}", faker.person.lastName())
    .replace("{adjective}", randomPick(ADJECTIVES))
    .replace("{food}", randomPick(FOOD_WORDS))
    .replace("{cuisine}", cuisine.split(" ")[0])
    .replace("{name}", faker.person.firstName())
    .replace("{location}", faker.location.city());
}

/**
 * Create a test restaurant
 */
export function createRestaurant(
  options: RestaurantFactoryOptions = {}
): TestRestaurant {
  const {
    city = "lagos",
    cuisine = randomPick(CUISINE_TYPES),
    isOpen = true,
    rating = faker.number.float({ min: 3.5, max: 5.0, multipleOf: 0.1 }),
  } = options;

  const location = createLocation({ city: city as any });

  return {
    id: uuid(),
    name: generateRestaurantName(cuisine),
    description: `Authentic ${cuisine} cuisine with a modern twist`,
    cuisine: [cuisine],
    rating,
    reviewCount: faker.number.int({ min: 10, max: 5000 }),
    priceRange: randomPick(["$", "$$", "$$$"]) as "$" | "$$" | "$$$",
    deliveryFee: faker.number.int({ min: 200, max: 1000 }),
    minimumOrder: faker.number.int({ min: 500, max: 3000 }),
    estimatedDeliveryTime: faker.number.int({ min: 20, max: 60 }),
    isOpen,
    openingHours: {
      monday: { open: "08:00", close: "22:00" },
      tuesday: { open: "08:00", close: "22:00" },
      wednesday: { open: "08:00", close: "22:00" },
      thursday: { open: "08:00", close: "22:00" },
      friday: { open: "08:00", close: "23:00" },
      saturday: { open: "09:00", close: "23:00" },
      sunday: { open: "10:00", close: "21:00" },
    },
    location,
    images: [
      faker.image.urlLoremFlickr({ category: "food" }),
      faker.image.urlLoremFlickr({ category: "restaurant" }),
    ],
    tags: [
      cuisine.toLowerCase(),
      "popular",
      randomPick(["new", "featured", "trending"]),
    ],
    createdAt: faker.date.past(),
  };
}

/**
 * Create a menu item
 */
export function createMenuItem(
  options: MenuItemFactoryOptions = {}
): TestMenuItem {
  const {
    cuisine = randomPick(CUISINE_TYPES),
    currency = "NGN",
    isAvailable = true,
  } = options;

  const menuItems =
    MENU_ITEMS_BY_CUISINE[cuisine] || MENU_ITEMS_BY_CUISINE["Fast Food"];
  const item = randomPick(menuItems);

  // Price range based on currency
  const priceRanges: Record<string, [number, number]> = {
    NGN: [500, 8000],
    KES: [150, 2500],
    GHS: [10, 150],
    ZAR: [30, 300],
  };

  const [minPrice, maxPrice] = priceRanges[currency] || priceRanges.NGN;

  return {
    id: uuid(),
    name: item.name,
    description: item.description,
    price: faker.number.int({ min: minPrice, max: maxPrice }),
    currency,
    category: item.category,
    image: faker.image.urlLoremFlickr({ category: "food" }),
    isAvailable,
    preparationTime: faker.number.int({ min: 10, max: 30 }),
    options: [
      {
        name: "Protein",
        choices: ["Chicken", "Beef", "Fish", "Goat"],
        required: false,
        maxChoices: 1,
      },
      {
        name: "Spice Level",
        choices: ["Mild", "Medium", "Hot", "Extra Hot"],
        required: false,
        maxChoices: 1,
      },
    ],
    tags: [item.category.toLowerCase(), cuisine.toLowerCase()],
  };
}

/**
 * Create a food order
 */
export function createFoodOrder(
  options: FoodOrderFactoryOptions = {}
): TestFoodOrder {
  const {
    status = "delivered",
    itemCount = randomInt(1, 5),
    currency = "NGN",
    city = "lagos",
  } = options;

  const restaurant = createRestaurant({
    city,
    cuisine: randomPick(CUISINE_TYPES),
  });
  const deliveryLocation = createLocation({ city: city as any });

  // Create order items
  const items: TestOrderItem[] = Array.from({ length: itemCount }, () => {
    const menuItem = createMenuItem({ currency });
    const quantity = randomInt(1, 3);
    return {
      id: uuid(),
      menuItemId: menuItem.id,
      name: menuItem.name,
      price: menuItem.price,
      quantity,
      subtotal: menuItem.price * quantity,
      options: [],
      specialInstructions: randomPick([
        undefined,
        "Extra spicy",
        "No onions",
        "Well done",
      ]),
    };
  });

  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const deliveryFee = restaurant.deliveryFee;
  const serviceFee = Math.round(subtotal * 0.05); // 5% service fee
  const total = subtotal + deliveryFee + serviceFee;

  const orderId = uuid();
  const now = new Date();

  const order: TestFoodOrder = {
    id: orderId,
    orderNumber: `UBI-${faker.string.alphanumeric({ length: 6 }).toUpperCase()}`,
    userId: uuid(),
    restaurantId: restaurant.id,
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      image: restaurant.images[0],
    },
    items,
    status,
    deliveryAddress: deliveryLocation,
    pricing: {
      currency,
      subtotal,
      deliveryFee,
      serviceFee,
      discount: 0,
      total,
    },
    paymentMethod: randomPick(["card", "mobile_money", "cash"]),
    paymentStatus: status === "delivered" ? "paid" : "pending",
    estimatedDeliveryTime: faker.number.int({ min: 25, max: 60 }),
    specialInstructions: randomPick([
      undefined,
      "Please call when arriving",
      "Leave at door",
    ]),
    createdAt: faker.date.past(),
    updatedAt: now,
  };

  // Add status-specific timestamps
  switch (status) {
    case "pending":
      break;

    case "confirmed":
      order.confirmedAt = now;
      break;

    case "preparing":
      order.confirmedAt = faker.date.recent();
      order.preparingAt = now;
      break;

    case "ready_for_pickup":
      order.confirmedAt = faker.date.recent();
      order.preparingAt = faker.date.recent();
      order.readyAt = now;
      break;

    case "out_for_delivery":
      order.confirmedAt = faker.date.recent();
      order.preparingAt = faker.date.recent();
      order.readyAt = faker.date.recent();
      order.pickedUpAt = now;
      order.driverId = uuid();
      order.driverLocation = {
        latitude: deliveryLocation.latitude + (Math.random() - 0.5) * 0.01,
        longitude: deliveryLocation.longitude + (Math.random() - 0.5) * 0.01,
      };
      break;

    case "delivered":
      const startTime = faker.date.past();
      order.confirmedAt = new Date(startTime.getTime() + 60000);
      order.preparingAt = new Date(startTime.getTime() + 120000);
      order.readyAt = new Date(startTime.getTime() + 1200000);
      order.pickedUpAt = new Date(startTime.getTime() + 1500000);
      order.deliveredAt = new Date(startTime.getTime() + 2400000);
      order.driverId = uuid();
      order.rating = {
        foodRating: faker.number.float({ min: 4, max: 5, multipleOf: 0.5 }),
        deliveryRating: faker.number.float({ min: 4, max: 5, multipleOf: 0.5 }),
        comment: randomPick([
          undefined,
          "Great food!",
          "Fast delivery",
          "Delicious",
        ]),
      };
      break;

    case "cancelled":
      order.cancelledAt = now;
      order.cancellationReason = randomPick([
        "Changed my mind",
        "Restaurant closed",
        "Long wait time",
        "Item unavailable",
      ]);
      break;
  }

  return order;
}

/**
 * Create multiple restaurants
 */
export function createRestaurants(
  count: number,
  options?: RestaurantFactoryOptions
): TestRestaurant[] {
  return Array.from({ length: count }, () => createRestaurant(options));
}

/**
 * Create a restaurant with its menu
 */
export function createRestaurantWithMenu(
  itemCount: number = 10,
  options?: RestaurantFactoryOptions
): { restaurant: TestRestaurant; menu: TestMenuItem[] } {
  const restaurant = createRestaurant(options);
  const menu = Array.from({ length: itemCount }, () =>
    createMenuItem({ cuisine: restaurant.cuisine[0] })
  );
  return { restaurant, menu };
}

/**
 * Create multiple food orders
 */
export function createFoodOrders(
  count: number,
  options?: FoodOrderFactoryOptions
): TestFoodOrder[] {
  return Array.from({ length: count }, () => createFoodOrder(options));
}
