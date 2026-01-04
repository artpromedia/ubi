/**
 * Menu Routes
 */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { cache } from "../lib/redis";
import { generateId } from "../lib/utils";
import { ItemAvailability } from "../types";

const menuRoutes = new Hono();

// ============================================
// Schemas
// ============================================

const createCategorySchema = z.object({
  restaurantId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().min(0).default(0),
});

const updateCategorySchema = createCategorySchema
  .partial()
  .omit({ restaurantId: true });

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

const updateMenuItemSchema = createMenuItemSchema
  .partial()
  .omit({ restaurantId: true });

const bulkUpdateAvailabilitySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      availability: z.nativeEnum(ItemAvailability),
    })
  ),
});

// ============================================
// Category Routes
// ============================================

/**
 * GET /menus/categories/:restaurantId - Get categories for a restaurant
 */
menuRoutes.get("/categories/:restaurantId", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const includeInactive = c.req.query("includeInactive") === "true";

  const where: any = { restaurantId };
  if (!includeInactive) {
    where.isActive = true;
  }

  const categories = await prisma.menuCategory.findMany({
    where,
    orderBy: { sortOrder: "asc" },
    include: {
      _count: {
        select: { items: true },
      },
    },
  });

  return c.json({
    success: true,
    data: categories,
  });
});

/**
 * POST /menus/categories - Create category
 */
menuRoutes.post(
  "/categories",
  zValidator("json", createCategorySchema),
  async (c) => {
    const ownerId = c.req.header("X-User-ID");
    const data = c.req.valid("json");

    // Verify ownership
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: data.restaurantId },
    });

    if (!restaurant || restaurant.ownerId !== ownerId) {
      return c.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "Not authorized" },
        },
        403
      );
    }

    const category = await prisma.menuCategory.create({
      data: {
        id: generateId("cat"),
        ...data,
        isActive: true,
      },
    });

    // Invalidate menu cache
    await cache.delete(`menu:${data.restaurantId}`);

    return c.json({ success: true, data: category }, 201);
  }
);

/**
 * PUT /menus/categories/:id - Update category
 */
menuRoutes.put(
  "/categories/:id",
  zValidator("json", updateCategorySchema),
  async (c) => {
    const id = c.req.param("id");
    const ownerId = c.req.header("X-User-ID");
    const data = c.req.valid("json");

    const category = await prisma.menuCategory.findUnique({
      where: { id },
      include: { restaurant: true },
    });

    if (!category || category.restaurant.ownerId !== ownerId) {
      return c.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "Not authorized" },
        },
        403
      );
    }

    const updated = await prisma.menuCategory.update({
      where: { id },
      data,
    });

    await cache.delete(`menu:${category.restaurantId}`);

    return c.json({ success: true, data: updated });
  }
);

/**
 * DELETE /menus/categories/:id - Delete category
 */
menuRoutes.delete("/categories/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.req.header("X-User-ID");

  const category = await prisma.menuCategory.findUnique({
    where: { id },
    include: { restaurant: true, items: true },
  });

  if (!category || category.restaurant.ownerId !== ownerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  if (category.items.length > 0) {
    // Soft delete - just mark as inactive
    await prisma.menuCategory.update({
      where: { id },
      data: { isActive: false },
    });
  } else {
    await prisma.menuCategory.delete({ where: { id } });
  }

  await cache.delete(`menu:${category.restaurantId}`);

  return c.json({ success: true, data: { deleted: true } });
});

/**
 * POST /menus/categories/reorder - Reorder categories
 */
menuRoutes.post("/categories/reorder", async (c) => {
  const ownerId = c.req.header("X-User-ID");
  const { restaurantId, categoryIds } = await c.req.json<{
    restaurantId: string;
    categoryIds: string[];
  }>();

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
  });

  if (!restaurant || restaurant.ownerId !== ownerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  // Update sort order for each category
  await prisma.$transaction(
    categoryIds.map((id, index) =>
      prisma.menuCategory.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );

  await cache.delete(`menu:${restaurantId}`);

  return c.json({ success: true, data: { reordered: true } });
});

// ============================================
// Menu Item Routes
// ============================================

/**
 * GET /menus/items/:id - Get menu item details
 */
menuRoutes.get("/items/:id", async (c) => {
  const id = c.req.param("id");

  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: {
      category: true,
      restaurant: {
        select: { id: true, name: true, currency: true },
      },
    },
  });

  if (!item) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Menu item not found" },
      },
      404
    );
  }

  return c.json({ success: true, data: item });
});

/**
 * POST /menus/items - Create menu item
 */
menuRoutes.post(
  "/items",
  zValidator("json", createMenuItemSchema),
  async (c) => {
    const ownerId = c.req.header("X-User-ID");
    const data = c.req.valid("json");

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: data.restaurantId },
    });

    if (!restaurant || restaurant.ownerId !== ownerId) {
      return c.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "Not authorized" },
        },
        403
      );
    }

    // Generate IDs for options and addons
    const options = data.options.map((opt) => ({
      ...opt,
      id: opt.id || generateId("opt"),
      choices: opt.choices.map((choice) => ({
        ...choice,
        id: choice.id || generateId("chc"),
      })),
    }));

    const addons = data.addons.map((addon) => ({
      ...addon,
      id: addon.id || generateId("add"),
    }));

    const item = await prisma.menuItem.create({
      data: {
        id: generateId("itm"),
        ...data,
        options,
        addons,
        isActive: true,
      },
    });

    await cache.delete(`menu:${data.restaurantId}`);

    return c.json({ success: true, data: item }, 201);
  }
);

/**
 * PUT /menus/items/:id - Update menu item
 */
menuRoutes.put(
  "/items/:id",
  zValidator("json", updateMenuItemSchema),
  async (c) => {
    const id = c.req.param("id");
    const ownerId = c.req.header("X-User-ID");
    const data = c.req.valid("json");

    const item = await prisma.menuItem.findUnique({
      where: { id },
      include: { restaurant: true },
    });

    if (!item || item.restaurant.ownerId !== ownerId) {
      return c.json(
        {
          success: false,
          error: { code: "FORBIDDEN", message: "Not authorized" },
        },
        403
      );
    }

    // Generate IDs for new options/addons
    if (data.options) {
      data.options = data.options.map((opt) => ({
        ...opt,
        id: opt.id || generateId("opt"),
        choices: opt.choices.map((choice) => ({
          ...choice,
          id: choice.id || generateId("chc"),
        })),
      }));
    }

    if (data.addons) {
      data.addons = data.addons.map((addon) => ({
        ...addon,
        id: addon.id || generateId("add"),
      }));
    }

    const updated = await prisma.menuItem.update({
      where: { id },
      data,
    });

    await cache.delete(`menu:${item.restaurantId}`);

    return c.json({ success: true, data: updated });
  }
);

/**
 * DELETE /menus/items/:id - Delete menu item
 */
menuRoutes.delete("/items/:id", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.req.header("X-User-ID");

  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: { restaurant: true },
  });

  if (!item || item.restaurant.ownerId !== ownerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  // Soft delete
  await prisma.menuItem.update({
    where: { id },
    data: { isActive: false },
  });

  await cache.delete(`menu:${item.restaurantId}`);

  return c.json({ success: true, data: { deleted: true } });
});

/**
 * PUT /menus/items/:id/availability - Update item availability
 */
menuRoutes.put("/items/:id/availability", async (c) => {
  const id = c.req.param("id");
  const ownerId = c.req.header("X-User-ID");
  const { availability } = await c.req.json<{
    availability: ItemAvailability;
  }>();

  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: { restaurant: true },
  });

  if (!item || item.restaurant.ownerId !== ownerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  await prisma.menuItem.update({
    where: { id },
    data: { availability },
  });

  await cache.delete(`menu:${item.restaurantId}`);

  return c.json({ success: true, data: { availability } });
});

/**
 * POST /menus/items/bulk-availability - Bulk update item availability
 */
menuRoutes.post(
  "/items/bulk-availability",
  zValidator("json", bulkUpdateAvailabilitySchema),
  async (c) => {
    const ownerId = c.req.header("X-User-ID");
    const { items } = c.req.valid("json");

    // Get all items and verify ownership
    const itemRecords = await prisma.menuItem.findMany({
      where: { id: { in: items.map((i) => i.id) } },
      include: { restaurant: true },
    });

    const restaurantIds = new Set<string>();

    for (const item of itemRecords) {
      if (item.restaurant.ownerId !== ownerId) {
        return c.json(
          {
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "Not authorized for all items",
            },
          },
          403
        );
      }
      restaurantIds.add(item.restaurantId);
    }

    // Update all items
    await prisma.$transaction(
      items.map((item) =>
        prisma.menuItem.update({
          where: { id: item.id },
          data: { availability: item.availability },
        })
      )
    );

    // Invalidate all affected menus
    for (const restaurantId of restaurantIds) {
      await cache.delete(`menu:${restaurantId}`);
    }

    return c.json({
      success: true,
      data: { updated: items.length },
    });
  }
);

/**
 * POST /menus/items/reorder - Reorder items within a category
 */
menuRoutes.post("/items/reorder", async (c) => {
  const ownerId = c.req.header("X-User-ID");
  const { categoryId, itemIds } = await c.req.json<{
    categoryId: string;
    itemIds: string[];
  }>();

  const category = await prisma.menuCategory.findUnique({
    where: { id: categoryId },
    include: { restaurant: true },
  });

  if (!category || category.restaurant.ownerId !== ownerId) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "Not authorized" },
      },
      403
    );
  }

  await prisma.$transaction(
    itemIds.map((id, index) =>
      prisma.menuItem.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );

  await cache.delete(`menu:${category.restaurantId}`);

  return c.json({ success: true, data: { reordered: true } });
});

export { menuRoutes };
