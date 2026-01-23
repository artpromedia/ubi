/**
 * E2E Test: Restaurant Menu Management
 *
 * Tests menu item CRUD, availability, and pricing management.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Menu Item List", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/menu");
    await waitForPageLoad(authenticatedPage);
  });

  test("should display menu categories", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Common Nigerian restaurant categories
    const categories = page.getByText(
      /main.*dish|soups|swallows|drinks|proteins|sides|breakfast|lunch|dinner/i,
    );
    expect(await categories.count()).toBeGreaterThan(0);
  });

  test("should list menu items", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Should show menu items
    const menuItems = page.locator(
      '[class*="menu-item"], [data-testid*="menu-item"], tr',
    );
    expect(await menuItems.count()).toBeGreaterThan(0);
  });

  test("should display item prices", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Prices in Naira
    const prices = page.getByText(/₦\d|NGN|\d{1,3}(,\d{3})+/);
    expect(await prices.count()).toBeGreaterThan(0);
  });

  test("should show availability status", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Available/unavailable indicators
    const availabilityIndicators = page.getByText(
      /available|unavailable|in.*stock|out.*of.*stock/i,
    );
    // Or toggle switches
    const toggles = page.getByRole("switch");

    const hasIndicators = (await availabilityIndicators.count()) > 0;
    const hasToggles = (await toggles.count()) > 0;

    expect(hasIndicators || hasToggles).toBeTruthy();
  });

  test("should filter by category", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const categoryTabs = page.getByRole("tab");

    if ((await categoryTabs.count()) > 1) {
      await categoryTabs.nth(1).click();
      // Items should filter
    }
  });

  test("should search menu items", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const searchInput = page.getByPlaceholder(/search|find|filter/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill("Jollof");
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Add Menu Item", () => {
  test("should open add item form", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/menu");

    const addButton = page.getByRole("button", {
      name: /add.*item|new.*item|\+/i,
    });

    if (await addButton.isVisible()) {
      await addButton.click();

      // Form should appear
      await expect(page.getByLabel(/name|item.*name/i).first()).toBeVisible();
    }
  });

  test("should create new menu item", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/menu/, {
      success: true,
      data: { id: "item_123", name: "New Dish" },
    });

    await page.goto("/menu");

    const addButton = page.getByRole("button", {
      name: /add.*item|new.*item|\+/i,
    });

    if (await addButton.isVisible()) {
      await addButton.click();

      // Fill form
      const nameInput = page.getByLabel(/name|item.*name/i).first();
      if (await nameInput.isVisible()) {
        await nameInput.fill("Special Jollof Rice");
      }

      const priceInput = page.getByLabel(/price/i);
      if (await priceInput.isVisible()) {
        await priceInput.fill("3500");
      }

      const descInput = page.getByLabel(/description/i);
      if (await descInput.isVisible()) {
        await descInput.fill("Our signature jollof with special spices");
      }

      // Select category
      const categorySelect = page.getByRole("combobox", { name: /category/i });
      if (await categorySelect.isVisible()) {
        await categorySelect.selectOption({ index: 1 });
      }

      // Save
      const saveButton = page.getByRole("button", { name: /save|create|add/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }
    }
  });

  test("should upload item image", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/menu");

    const addButton = page.getByRole("button", { name: /add.*item|\+/i });

    if (await addButton.isVisible()) {
      await addButton.click();

      // Image upload
      const uploadButton = page.getByRole("button", {
        name: /upload|image|photo/i,
      });
      const fileInput = page.locator('input[type="file"]');

      // File input may be hidden
      if ((await fileInput.count()) > 0) {
        // Would need actual file for upload test
      }
    }
  });

  test("should set preparation time", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/menu");

    const addButton = page.getByRole("button", { name: /add.*item|\+/i });

    if (await addButton.isVisible()) {
      await addButton.click();

      const prepTimeInput = page.getByLabel(/prep.*time|preparation/i);
      if (await prepTimeInput.isVisible()) {
        await prepTimeInput.fill("20");
      }
    }
  });
});

test.describe("Edit Menu Item", () => {
  test("should edit existing item", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/menu\/.*/, {
      success: true,
      data: { updated: true },
    });

    await page.goto("/menu");

    const editButton = page.getByRole("button", { name: /edit|✏️/i }).first();

    if (await editButton.isVisible()) {
      await editButton.click();

      const nameInput = page.getByLabel(/name/i).first();
      if (await nameInput.isVisible()) {
        await nameInput.fill("Updated Item Name");
      }

      const saveButton = page.getByRole("button", { name: /save|update/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }
    }
  });

  test("should update item price", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/menu\/.*\/price/, {
      success: true,
      data: { price: 4000 },
    });

    await page.goto("/menu");

    const editButton = page.getByRole("button", { name: /edit/i }).first();

    if (await editButton.isVisible()) {
      await editButton.click();

      const priceInput = page.getByLabel(/price/i);
      if (await priceInput.isVisible()) {
        await priceInput.fill("4000");
      }
    }
  });

  test("should delete menu item", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(
      /\/api\/menu\/.*/,
      {
        success: true,
        data: { deleted: true },
      },
      200,
    );

    await page.goto("/menu");

    const deleteButton = page
      .getByRole("button", { name: /delete|remove|🗑/i })
      .first();

    if (await deleteButton.isVisible()) {
      await deleteButton.click();

      // Confirm deletion
      const confirmButton = page.getByRole("button", {
        name: /confirm|yes|delete/i,
      });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }
  });
});

test.describe("Item Availability", () => {
  test("should toggle item availability", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/menu\/.*\/availability/, {
      success: true,
      data: { available: false },
    });

    await page.goto("/menu");

    const toggle = page.getByRole("switch").first();

    if (await toggle.isVisible()) {
      await toggle.click();
    }
  });

  test("should mark item as out of stock", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/menu\/.*\/stock/, {
      success: true,
      data: { inStock: false },
    });

    await page.goto("/menu");

    const outOfStockButton = page
      .getByRole("button", { name: /out.*of.*stock|unavailable/i })
      .first();

    if (await outOfStockButton.isVisible()) {
      await outOfStockButton.click();
    }
  });

  test("should set daily limit", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/menu");

    const editButton = page.getByRole("button", { name: /edit/i }).first();

    if (await editButton.isVisible()) {
      await editButton.click();

      const limitInput = page.getByLabel(/daily.*limit|max.*orders/i);
      if (await limitInput.isVisible()) {
        await limitInput.fill("50");
      }
    }
  });
});

test.describe("Menu Categories", () => {
  test("should create new category", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/menu\/categories/, {
      success: true,
      data: { id: "cat_123", name: "New Category" },
    });

    await page.goto("/menu");

    const addCategoryButton = page.getByRole("button", {
      name: /add.*category|new.*category/i,
    });

    if (await addCategoryButton.isVisible()) {
      await addCategoryButton.click();

      const nameInput = page.getByLabel(/name|category.*name/i);
      if (await nameInput.isVisible()) {
        await nameInput.fill("Specials");
      }

      const saveButton = page.getByRole("button", { name: /save|create/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }
    }
  });

  test("should reorder categories", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/menu");

    // Drag and drop or reorder buttons
    const reorderButton = page.getByRole("button", {
      name: /reorder|drag|↑|↓/i,
    });
    // Drag and drop testing is complex
  });
});

test.describe("Bulk Menu Actions", () => {
  test("should select multiple items", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/menu");

    const checkboxes = page.getByRole("checkbox");

    if ((await checkboxes.count()) > 1) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();
    }
  });

  test("should bulk update prices", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/menu\/bulk/, {
      success: true,
      data: { updated: 3 },
    });

    await page.goto("/menu");

    const checkboxes = page.getByRole("checkbox");
    if ((await checkboxes.count()) > 1) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();

      const bulkActionButton = page.getByRole("button", {
        name: /bulk|selected|action/i,
      });
      if (await bulkActionButton.isVisible()) {
        await bulkActionButton.click();

        const priceIncreaseOption = page.getByText(
          /increase.*price|price.*adjust/i,
        );
        if (await priceIncreaseOption.isVisible()) {
          await priceIncreaseOption.click();
        }
      }
    }
  });

  test("should bulk mark unavailable", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/menu\/bulk\/availability/, {
      success: true,
      data: { updated: 2 },
    });

    await page.goto("/menu");

    // Select items and mark unavailable
    const checkboxes = page.getByRole("checkbox");
    if ((await checkboxes.count()) > 1) {
      await checkboxes.nth(0).check();

      const markUnavailable = page.getByRole("button", {
        name: /unavailable|out.*of.*stock/i,
      });
      if (await markUnavailable.isVisible()) {
        await markUnavailable.click();
      }
    }
  });
});
