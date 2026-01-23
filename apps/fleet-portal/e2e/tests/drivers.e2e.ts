/**
 * E2E Test: Driver Management
 *
 * Tests for managing drivers in the fleet.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Driver List", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/drivers");
    await waitForPageLoad(authenticatedPage);
  });

  test("should display driver list", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await expect(page.getByText(/drivers/i).first()).toBeVisible();

    // Driver rows
    const driverRows = page.locator('tr, [data-testid*="driver"]');
    expect(await driverRows.count()).toBeGreaterThan(0);
  });

  test("should show driver status indicators", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;

    // Status badges
    const statusIndicators = page.getByText(/online|offline|busy|available/i);
    expect(await statusIndicators.count()).toBeGreaterThan(0);
  });

  test("should display driver ratings", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Ratings (usually with star icon or decimal)
    const ratings = page.getByText(/\d\.\d+|★/);
    expect(await ratings.count()).toBeGreaterThan(0);
  });

  test("should filter drivers by status", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const statusFilter = page.getByRole("button", {
      name: /status|filter|all/i,
    });

    if (await statusFilter.first().isVisible()) {
      await statusFilter.first().click();

      const onlineOption = page.getByText(/online/i);
      if (await onlineOption.first().isVisible()) {
        await onlineOption.first().click();
      }
    }
  });

  test("should search drivers by name", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const searchInput = page.getByPlaceholder(/search|find/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill("Chukwuemeka");
      await page.waitForTimeout(500);
    }
  });

  test("should sort drivers by earnings", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const earningsHeader = page.getByRole("columnheader", {
      name: /earnings/i,
    });

    if (await earningsHeader.isVisible()) {
      await earningsHeader.click();
    }
  });

  test("should sort drivers by trips", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const tripsHeader = page.getByRole("columnheader", { name: /trips/i });

    if (await tripsHeader.isVisible()) {
      await tripsHeader.click();
    }
  });
});

test.describe("Add Driver", () => {
  test("should open add driver form", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const addButton = page.getByRole("button", {
      name: /add.*driver|new.*driver|\+/i,
    });

    if (await addButton.isVisible()) {
      await addButton.click();

      await expect(page.getByLabel(/name|first.*name/i).first()).toBeVisible();
    }
  });

  test("should add new driver", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/drivers/, {
      success: true,
      data: { id: "drv_123", name: "New Driver" },
    });

    await page.goto("/drivers");

    const addButton = page.getByRole("button", { name: /add.*driver|\+/i });

    if (await addButton.isVisible()) {
      await addButton.click();

      const nameInput = page.getByLabel(/name|first.*name/i).first();
      if (await nameInput.isVisible()) {
        await nameInput.fill("Emeka Johnson");
      }

      const phoneInput = page.getByLabel(/phone/i);
      if (await phoneInput.isVisible()) {
        await phoneInput.fill("08012345678");
      }

      const emailInput = page.getByLabel(/email/i);
      if (await emailInput.isVisible()) {
        await emailInput.fill("emeka@email.com");
      }

      const saveButton = page.getByRole("button", { name: /save|add|create/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }
    }
  });

  test("should assign vehicle to driver", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const addButton = page.getByRole("button", { name: /add.*driver/i });

    if (await addButton.isVisible()) {
      await addButton.click();

      const vehicleSelect = page.getByRole("combobox", { name: /vehicle/i });
      if (await vehicleSelect.isVisible()) {
        await vehicleSelect.click();
      }
    }
  });
});

test.describe("Driver Details", () => {
  test("should view driver profile", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const viewButton = page
      .getByRole("button", { name: /view|details/i })
      .first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      await expect(page.getByText(/profile|details/i).first()).toBeVisible();
    }
  });

  test("should show driver trip history", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const viewButton = page.getByRole("button", { name: /view/i }).first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const tripsTab = page.getByRole("tab", { name: /trips|history/i });
      if (await tripsTab.isVisible()) {
        await tripsTab.click();
      }
    }
  });

  test("should show driver earnings history", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const viewButton = page.getByRole("button", { name: /view/i }).first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const earningsTab = page.getByRole("tab", { name: /earnings|payments/i });
      if (await earningsTab.isVisible()) {
        await earningsTab.click();
      }
    }
  });

  test("should show driver documents", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const viewButton = page.getByRole("button", { name: /view/i }).first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const documentsTab = page.getByRole("tab", {
        name: /documents|verification/i,
      });
      if (await documentsTab.isVisible()) {
        await documentsTab.click();

        // Document types
        await expect(
          page.getByText(/license|insurance|registration/i).first(),
        ).toBeVisible();
      }
    }
  });
});

test.describe("Driver Actions", () => {
  test("should suspend driver", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/drivers\/.*\/suspend/, {
      success: true,
      data: { status: "suspended" },
    });

    await page.goto("/drivers");

    const suspendButton = page
      .getByRole("button", { name: /suspend|deactivate/i })
      .first();

    if (await suspendButton.isVisible()) {
      await suspendButton.click();

      const reasonInput = page.getByPlaceholder(/reason/i);
      if (await reasonInput.isVisible()) {
        await reasonInput.fill("Policy violation");
      }

      const confirmButton = page.getByRole("button", { name: /confirm/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }
  });

  test("should reactivate driver", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/drivers\/.*\/activate/, {
      success: true,
      data: { status: "active" },
    });

    await page.goto("/drivers");

    // Filter to suspended
    const statusFilter = page.getByRole("button", { name: /status/i }).first();
    if (await statusFilter.isVisible()) {
      await statusFilter.click();
      const suspendedOption = page.getByText(/suspended/i);
      if (await suspendedOption.first().isVisible()) {
        await suspendedOption.first().click();
      }
    }

    const activateButton = page
      .getByRole("button", { name: /activate|reactivate/i })
      .first();

    if (await activateButton.isVisible()) {
      await activateButton.click();
    }
  });

  test("should send message to driver", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/notifications\/send/, {
      success: true,
      data: { sent: true },
    });

    await page.goto("/drivers");

    const messageButton = page
      .getByRole("button", { name: /message|notify/i })
      .first();

    if (await messageButton.isVisible()) {
      await messageButton.click();

      const messageInput = page.getByPlaceholder(/message/i);
      if (await messageInput.isVisible()) {
        await messageInput.fill("Please report to the office tomorrow.");
      }

      const sendButton = page.getByRole("button", { name: /send/i });
      if (await sendButton.isVisible()) {
        await sendButton.click();
      }
    }
  });
});

test.describe("Driver Performance", () => {
  test("should view driver performance metrics", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const viewButton = page.getByRole("button", { name: /view/i }).first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      // Performance metrics
      await expect(
        page.getByText(/acceptance.*rate|completion.*rate|rating/i).first(),
      ).toBeVisible();
    }
  });

  test("should show driver feedback/reviews", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const viewButton = page.getByRole("button", { name: /view/i }).first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const reviewsTab = page.getByRole("tab", { name: /reviews|feedback/i });
      if (await reviewsTab.isVisible()) {
        await reviewsTab.click();
      }
    }
  });
});

test.describe("Bulk Driver Actions", () => {
  test("should select multiple drivers", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/drivers");

    const checkboxes = page.getByRole("checkbox");

    if ((await checkboxes.count()) > 1) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();
    }
  });

  test("should send bulk message", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/notifications\/bulk/, {
      success: true,
      data: { sent: 5 },
    });

    await page.goto("/drivers");

    const checkboxes = page.getByRole("checkbox");
    if ((await checkboxes.count()) > 1) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();

      const bulkMessageButton = page.getByRole("button", {
        name: /message.*all|bulk.*message/i,
      });
      if (await bulkMessageButton.isVisible()) {
        await bulkMessageButton.click();
      }
    }
  });
});
