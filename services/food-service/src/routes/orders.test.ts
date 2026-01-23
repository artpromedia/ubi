/**
 * Order Routes Tests
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Define schemas matching the routes
const orderItemSchema = z.object({
  menuItemId: z.string(),
  quantity: z.number().int().min(1).max(99),
  selectedOptions: z
    .array(
      z.object({
        optionId: z.string(),
        choiceId: z.string(),
      }),
    )
    .default([]),
  selectedAddons: z.array(z.string()).default([]),
  specialInstructions: z.string().max(500).optional(),
});

const deliveryAddressSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1),
  city: z.string().min(1),
  state: z.string().optional(),
  country: z.string().min(2).max(2),
  postalCode: z.string().optional(),
});

const createOrderSchema = z.object({
  restaurantId: z.string(),
  type: z.enum(["DELIVERY", "PICKUP", "DINE_IN"]),
  items: z.array(orderItemSchema).min(1),
  deliveryAddress: deliveryAddressSchema.optional(),
  deliveryInstructions: z.string().max(500).optional(),
  customerNote: z.string().max(500).optional(),
  tip: z.number().min(0).default(0),
  promoCode: z.string().optional(),
});

describe("Order Schema Validation", () => {
  describe("orderItemSchema", () => {
    it("should validate valid order item", () => {
      const validItem = {
        menuItemId: "menu_123abc",
        quantity: 2,
        selectedOptions: [{ optionId: "opt1", choiceId: "choice1" }],
        selectedAddons: ["addon1"],
        specialInstructions: "No onions please",
      };

      const result = orderItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it("should require menuItemId", () => {
      const result = orderItemSchema.safeParse({ quantity: 1 });
      expect(result.success).toBe(false);
    });

    it("should reject quantity less than 1", () => {
      const result = orderItemSchema.safeParse({
        menuItemId: "menu_123",
        quantity: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject quantity greater than 99", () => {
      const result = orderItemSchema.safeParse({
        menuItemId: "menu_123",
        quantity: 100,
      });
      expect(result.success).toBe(false);
    });

    it("should reject specialInstructions over 500 chars", () => {
      const result = orderItemSchema.safeParse({
        menuItemId: "menu_123",
        quantity: 1,
        specialInstructions: "a".repeat(501),
      });
      expect(result.success).toBe(false);
    });

    it("should default selectedOptions to empty array", () => {
      const result = orderItemSchema.safeParse({
        menuItemId: "menu_123",
        quantity: 1,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.selectedOptions).toEqual([]);
      }
    });
  });

  describe("deliveryAddressSchema", () => {
    it("should validate valid address", () => {
      const validAddress = {
        latitude: 6.5244,
        longitude: 3.3792,
        address: "123 Lagos Street",
        city: "Lagos",
        country: "NG",
      };

      const result = deliveryAddressSchema.safeParse(validAddress);
      expect(result.success).toBe(true);
    });

    it("should reject invalid latitude", () => {
      const result = deliveryAddressSchema.safeParse({
        latitude: 100, // Invalid: > 90
        longitude: 3.3792,
        address: "123 Lagos Street",
        city: "Lagos",
        country: "NG",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid longitude", () => {
      const result = deliveryAddressSchema.safeParse({
        latitude: 6.5244,
        longitude: 200, // Invalid: > 180
        address: "123 Lagos Street",
        city: "Lagos",
        country: "NG",
      });
      expect(result.success).toBe(false);
    });

    it("should require address", () => {
      const result = deliveryAddressSchema.safeParse({
        latitude: 6.5244,
        longitude: 3.3792,
        address: "", // Invalid: empty
        city: "Lagos",
        country: "NG",
      });
      expect(result.success).toBe(false);
    });

    it("should require 2-char country code", () => {
      const result = deliveryAddressSchema.safeParse({
        latitude: 6.5244,
        longitude: 3.3792,
        address: "123 Lagos Street",
        city: "Lagos",
        country: "Nigeria", // Invalid: not 2 chars
      });
      expect(result.success).toBe(false);
    });
  });

  describe("createOrderSchema", () => {
    const validOrder = {
      restaurantId: "res_123abc",
      type: "DELIVERY" as const,
      items: [
        {
          menuItemId: "menu_123",
          quantity: 2,
        },
      ],
      deliveryAddress: {
        latitude: 6.5244,
        longitude: 3.3792,
        address: "123 Lagos Street",
        city: "Lagos",
        country: "NG",
      },
    };

    it("should validate valid order", () => {
      const result = createOrderSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
    });

    it("should require at least one item", () => {
      const result = createOrderSchema.safeParse({
        ...validOrder,
        items: [],
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid order type", () => {
      const result = createOrderSchema.safeParse({
        ...validOrder,
        type: "INVALID",
      });
      expect(result.success).toBe(false);
    });

    it("should default tip to 0", () => {
      const result = createOrderSchema.safeParse(validOrder);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tip).toBe(0);
      }
    });

    it("should reject negative tip", () => {
      const result = createOrderSchema.safeParse({
        ...validOrder,
        tip: -10,
      });
      expect(result.success).toBe(false);
    });

    it("should allow pickup without delivery address", () => {
      const result = createOrderSchema.safeParse({
        restaurantId: "res_123abc",
        type: "PICKUP",
        items: [{ menuItemId: "menu_123", quantity: 1 }],
      });
      expect(result.success).toBe(true);
    });
  });
});
