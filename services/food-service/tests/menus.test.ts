/**
 * Menu Routes Tests
 *
 * Tests menu categories, items, options, and addons.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Enums
enum ItemAvailability {
  AVAILABLE = "AVAILABLE",
  OUT_OF_STOCK = "OUT_OF_STOCK",
  COMING_SOON = "COMING_SOON",
  DISCONTINUED = "DISCONTINUED",
}

// Schemas
const createCategorySchema = z.object({
  restaurantId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const optionChoiceSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  priceModifier: z.number().default(0),
  isDefault: z.boolean().default(false),
});

const menuItemOptionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  required: z.boolean().default(false),
  maxSelections: z.number().int().min(1).default(1),
  choices: z.array(optionChoiceSchema).min(1),
});

const menuItemAddonSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  price: z.number().min(0),
  isAvailable: z.boolean().default(true),
});

const createMenuItemSchema = z.object({
  restaurantId: z.string(),
  categoryId: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  price: z.number().positive(),
  discountPrice: z.number().positive().optional(),
  currency: z.string().length(3).default("NGN"),
  images: z.array(z.string().url()).default([]),
  availability: z
    .nativeEnum(ItemAvailability)
    .default(ItemAvailability.AVAILABLE),
  prepTime: z.number().int().min(1).max(180).default(15),
  calories: z.number().int().positive().optional(),
  isVegetarian: z.boolean().default(false),
  isVegan: z.boolean().default(false),
  isGlutenFree: z.boolean().default(false),
  isSpicy: z.boolean().default(false),
  spiceLevel: z.number().int().min(1).max(3).optional(),
  allergens: z.array(z.string()).default([]),
  options: z.array(menuItemOptionSchema).default([]),
  addons: z.array(menuItemAddonSchema).default([]),
  sortOrder: z.number().int().min(0).default(0),
  isPopular: z.boolean().default(false),
});

const bulkUpdateAvailabilitySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      availability: z.nativeEnum(ItemAvailability),
    }),
  ),
});

describe("Menu Category Schema Validation", () => {
  describe("createCategorySchema", () => {
    it("should validate valid category", () => {
      const result = createCategorySchema.safeParse({
        restaurantId: "rest_123",
        name: "Main Dishes",
        description: "Our signature main courses",
        sortOrder: 1,
      });
      expect(result.success).toBe(true);
    });

    it("should require restaurantId", () => {
      const result = createCategorySchema.safeParse({
        name: "Main Dishes",
      });
      expect(result.success).toBe(false);
    });

    it("should require name", () => {
      const result = createCategorySchema.safeParse({
        restaurantId: "rest_123",
      });
      expect(result.success).toBe(false);
    });

    it("should reject name too long", () => {
      const result = createCategorySchema.safeParse({
        restaurantId: "rest_123",
        name: "A".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("should reject description too long", () => {
      const result = createCategorySchema.safeParse({
        restaurantId: "rest_123",
        name: "Main Dishes",
        description: "A".repeat(501),
      });
      expect(result.success).toBe(false);
    });

    it("should default sortOrder to 0", () => {
      const result = createCategorySchema.safeParse({
        restaurantId: "rest_123",
        name: "Main Dishes",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sortOrder).toBe(0);
      }
    });

    it("should reject negative sortOrder", () => {
      const result = createCategorySchema.safeParse({
        restaurantId: "rest_123",
        name: "Main Dishes",
        sortOrder: -1,
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("Menu Item Schema Validation", () => {
  const validMenuItem = {
    restaurantId: "rest_123",
    categoryId: "cat_123",
    name: "Jollof Rice",
    description: "Authentic Nigerian jollof rice",
    price: 2500,
    currency: "NGN",
    images: ["https://example.com/jollof.jpg"],
    availability: ItemAvailability.AVAILABLE,
    prepTime: 30,
    calories: 450,
    isVegetarian: false,
    isVegan: false,
    isGlutenFree: true,
    isSpicy: true,
    spiceLevel: 2,
    allergens: ["shellfish"],
    options: [
      {
        name: "Size",
        required: true,
        maxSelections: 1,
        choices: [
          { name: "Small", priceModifier: 0, isDefault: true },
          { name: "Medium", priceModifier: 500, isDefault: false },
          { name: "Large", priceModifier: 1000, isDefault: false },
        ],
      },
    ],
    addons: [
      { name: "Extra Meat", price: 800, isAvailable: true },
      { name: "Fried Plantain", price: 500, isAvailable: true },
    ],
    sortOrder: 1,
    isPopular: true,
  };

  describe("createMenuItemSchema", () => {
    it("should validate valid menu item", () => {
      const result = createMenuItemSchema.safeParse(validMenuItem);
      expect(result.success).toBe(true);
    });

    it("should require restaurantId", () => {
      const { restaurantId: _restaurantId, ...item } = validMenuItem;
      const result = createMenuItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });

    it("should require categoryId", () => {
      const { categoryId: _categoryId, ...item } = validMenuItem;
      const result = createMenuItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });

    it("should require name", () => {
      const { name: _name, ...item } = validMenuItem;
      const result = createMenuItemSchema.safeParse(item);
      expect(result.success).toBe(false);
    });

    it("should reject name too long", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        name: "A".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("should require positive price", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        price: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject negative price", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        price: -100,
      });
      expect(result.success).toBe(false);
    });

    it("should require 3-character currency code", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        currency: "NAIRA",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid image URL", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        images: ["not-a-url"],
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid availability status", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        availability: "INVALID" as any,
      });
      expect(result.success).toBe(false);
    });

    it("should reject prep time less than 1 minute", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        prepTime: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject prep time greater than 180 minutes", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        prepTime: 200,
      });
      expect(result.success).toBe(false);
    });

    it("should reject spice level less than 1", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        spiceLevel: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject spice level greater than 3", () => {
      const result = createMenuItemSchema.safeParse({
        ...validMenuItem,
        spiceLevel: 5,
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const minimalItem = {
        restaurantId: "rest_123",
        categoryId: "cat_123",
        name: "Test Item",
        price: 1000,
      };

      const result = createMenuItemSchema.safeParse(minimalItem);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe("NGN");
        expect(result.data.images).toEqual([]);
        expect(result.data.availability).toBe(ItemAvailability.AVAILABLE);
        expect(result.data.prepTime).toBe(15);
        expect(result.data.isVegetarian).toBe(false);
        expect(result.data.isPopular).toBe(false);
        expect(result.data.options).toEqual([]);
        expect(result.data.addons).toEqual([]);
      }
    });
  });

  describe("menuItemOptionSchema", () => {
    it("should validate valid option", () => {
      const result = menuItemOptionSchema.safeParse({
        name: "Size",
        required: true,
        maxSelections: 1,
        choices: [{ name: "Small", priceModifier: 0 }],
      });
      expect(result.success).toBe(true);
    });

    it("should require at least one choice", () => {
      const result = menuItemOptionSchema.safeParse({
        name: "Size",
        choices: [],
      });
      expect(result.success).toBe(false);
    });

    it("should default required to false", () => {
      const result = menuItemOptionSchema.safeParse({
        name: "Size",
        choices: [{ name: "Small", priceModifier: 0 }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.required).toBe(false);
      }
    });

    it("should reject maxSelections less than 1", () => {
      const result = menuItemOptionSchema.safeParse({
        name: "Size",
        maxSelections: 0,
        choices: [{ name: "Small", priceModifier: 0 }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("menuItemAddonSchema", () => {
    it("should validate valid addon", () => {
      const result = menuItemAddonSchema.safeParse({
        name: "Extra Cheese",
        price: 300,
        isAvailable: true,
      });
      expect(result.success).toBe(true);
    });

    it("should reject negative price", () => {
      const result = menuItemAddonSchema.safeParse({
        name: "Extra Cheese",
        price: -100,
      });
      expect(result.success).toBe(false);
    });

    it("should default isAvailable to true", () => {
      const result = menuItemAddonSchema.safeParse({
        name: "Extra Cheese",
        price: 300,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isAvailable).toBe(true);
      }
    });
  });

  describe("bulkUpdateAvailabilitySchema", () => {
    it("should validate bulk update", () => {
      const result = bulkUpdateAvailabilitySchema.safeParse({
        items: [
          { id: "item_1", availability: ItemAvailability.AVAILABLE },
          { id: "item_2", availability: ItemAvailability.OUT_OF_STOCK },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should accept empty items array", () => {
      const result = bulkUpdateAvailabilitySchema.safeParse({
        items: [],
      });
      expect(result.success).toBe(true);
    });
  });
});

describe("Menu Price Calculations", () => {
  interface MenuItem {
    price: number;
    discountPrice?: number;
    options: {
      choices: { priceModifier: number; isDefault: boolean }[];
    }[];
    addons: { name: string; price: number }[];
  }

  interface OrderItem {
    menuItem: MenuItem;
    quantity: number;
    selectedOptions: { choiceIndex: number }[];
    selectedAddons: number[];
  }

  function calculateItemPrice(item: OrderItem): number {
    let price = item.menuItem.discountPrice || item.menuItem.price;

    // Add option price modifiers
    item.selectedOptions.forEach((selection, optionIndex) => {
      const option = item.menuItem.options[optionIndex];
      if (option && option.choices[selection.choiceIndex]) {
        price += option.choices[selection.choiceIndex].priceModifier;
      }
    });

    // Add addon prices
    item.selectedAddons.forEach((addonIndex) => {
      if (item.menuItem.addons[addonIndex]) {
        price += item.menuItem.addons[addonIndex].price;
      }
    });

    return price * item.quantity;
  }

  it("should calculate basic item price", () => {
    const item: OrderItem = {
      menuItem: {
        price: 2500,
        options: [],
        addons: [],
      },
      quantity: 2,
      selectedOptions: [],
      selectedAddons: [],
    };

    expect(calculateItemPrice(item)).toBe(5000);
  });

  it("should use discount price when available", () => {
    const item: OrderItem = {
      menuItem: {
        price: 2500,
        discountPrice: 2000,
        options: [],
        addons: [],
      },
      quantity: 1,
      selectedOptions: [],
      selectedAddons: [],
    };

    expect(calculateItemPrice(item)).toBe(2000);
  });

  it("should add option price modifiers", () => {
    const item: OrderItem = {
      menuItem: {
        price: 2500,
        options: [
          {
            choices: [
              { priceModifier: 0, isDefault: true },
              { priceModifier: 500, isDefault: false },
            ],
          },
        ],
        addons: [],
      },
      quantity: 1,
      selectedOptions: [{ choiceIndex: 1 }],
      selectedAddons: [],
    };

    expect(calculateItemPrice(item)).toBe(3000);
  });

  it("should add addon prices", () => {
    const item: OrderItem = {
      menuItem: {
        price: 2500,
        options: [],
        addons: [
          { name: "Extra Meat", price: 800 },
          { name: "Plantain", price: 500 },
        ],
      },
      quantity: 1,
      selectedOptions: [],
      selectedAddons: [0, 1],
    };

    expect(calculateItemPrice(item)).toBe(3800);
  });

  it("should handle complex calculation with options and addons", () => {
    const item: OrderItem = {
      menuItem: {
        price: 2500,
        options: [
          {
            choices: [
              { priceModifier: 0, isDefault: true },
              { priceModifier: 1000, isDefault: false }, // Large size
            ],
          },
        ],
        addons: [{ name: "Extra Meat", price: 800 }],
      },
      quantity: 2,
      selectedOptions: [{ choiceIndex: 1 }], // Large
      selectedAddons: [0], // Extra Meat
    };

    // (2500 + 1000 + 800) * 2 = 8600
    expect(calculateItemPrice(item)).toBe(8600);
  });
});

describe("Menu Dietary Filters", () => {
  interface MenuItem {
    id: string;
    name: string;
    isVegetarian: boolean;
    isVegan: boolean;
    isGlutenFree: boolean;
    allergens: string[];
  }

  function filterByDietary(
    items: MenuItem[],
    filters: {
      vegetarian?: boolean;
      vegan?: boolean;
      glutenFree?: boolean;
      excludeAllergens?: string[];
    },
  ): MenuItem[] {
    return items.filter((item) => {
      if (filters.vegetarian && !item.isVegetarian) {
        return false;
      }
      if (filters.vegan && !item.isVegan) {
        return false;
      }
      if (filters.glutenFree && !item.isGlutenFree) {
        return false;
      }
      if (filters.excludeAllergens?.length) {
        const hasAllergen = item.allergens.some((a) =>
          filters.excludeAllergens!.includes(a.toLowerCase()),
        );
        if (hasAllergen) {
          return false;
        }
      }
      return true;
    });
  }

  const menuItems: MenuItem[] = [
    {
      id: "1",
      name: "Jollof Rice",
      isVegetarian: false,
      isVegan: false,
      isGlutenFree: true,
      allergens: [],
    },
    {
      id: "2",
      name: "Veggie Stir Fry",
      isVegetarian: true,
      isVegan: true,
      isGlutenFree: true,
      allergens: ["soy"],
    },
    {
      id: "3",
      name: "Chicken Curry",
      isVegetarian: false,
      isVegan: false,
      isGlutenFree: false,
      allergens: ["dairy"],
    },
    {
      id: "4",
      name: "Vegetable Soup",
      isVegetarian: true,
      isVegan: false,
      isGlutenFree: true,
      allergens: ["dairy"],
    },
  ];

  it("should filter vegetarian items", () => {
    const result = filterByDietary(menuItems, { vegetarian: true });
    expect(result).toHaveLength(2);
    expect(result.every((i) => i.isVegetarian)).toBe(true);
  });

  it("should filter vegan items", () => {
    const result = filterByDietary(menuItems, { vegan: true });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Veggie Stir Fry");
  });

  it("should filter gluten-free items", () => {
    const result = filterByDietary(menuItems, { glutenFree: true });
    expect(result).toHaveLength(3);
  });

  it("should exclude items with allergens", () => {
    const result = filterByDietary(menuItems, { excludeAllergens: ["dairy"] });
    expect(result).toHaveLength(2);
  });

  it("should apply multiple filters", () => {
    const result = filterByDietary(menuItems, {
      vegetarian: true,
      glutenFree: true,
      excludeAllergens: ["dairy"],
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Veggie Stir Fry");
  });
});
