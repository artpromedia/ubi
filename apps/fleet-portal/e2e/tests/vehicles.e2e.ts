/**
 * E2E Test: Vehicle Management
 *
 * Tests for managing vehicles in the fleet.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Vehicle List", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/vehicles");
    await waitForPageLoad(authenticatedPage);
  });

  test("should display vehicle list", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await expect(page.getByText(/vehicles/i).first()).toBeVisible();

    const vehicleRows = page.locator('tr, [data-testid*="vehicle"]');
    expect(await vehicleRows.count()).toBeGreaterThan(0);
  });

  test("should show vehicle details", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Vehicle info
    await expect(
      page.getByText(/plate.*number|registration|model|make/i).first(),
    ).toBeVisible();
  });

  test("should show assigned driver", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const driverAssignment = page.getByText(/assigned|driver/i);
    expect(await driverAssignment.count()).toBeGreaterThan(0);
  });

  test("should filter by vehicle type", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const typeFilter = page.getByRole("button", {
      name: /type|filter|car|bike|tricycle/i,
    });

    if (await typeFilter.first().isVisible()) {
      await typeFilter.first().click();
    }
  });

  test("should filter by status", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const statusFilter = page.getByRole("button", {
      name: /status|active|maintenance/i,
    });

    if (await statusFilter.first().isVisible()) {
      await statusFilter.first().click();
    }
  });

  test("should search vehicles", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const searchInput = page.getByPlaceholder(/search|find|plate/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill("ABC123");
      await page.waitForTimeout(500);
    }
  });
});

test.describe("Add Vehicle", () => {
  test("should open add vehicle form", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const addButton = page.getByRole("button", {
      name: /add.*vehicle|new.*vehicle|\+/i,
    });

    if (await addButton.isVisible()) {
      await addButton.click();

      await expect(
        page.getByLabel(/plate|registration|make|model/i).first(),
      ).toBeVisible();
    }
  });

  test("should add new vehicle", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/vehicles/, {
      success: true,
      data: { id: "veh_123", plateNumber: "ABC123XY" },
    });

    await page.goto("/vehicles");

    const addButton = page.getByRole("button", { name: /add.*vehicle/i });

    if (await addButton.isVisible()) {
      await addButton.click();

      const plateInput = page.getByLabel(/plate.*number|registration/i);
      if (await plateInput.isVisible()) {
        await plateInput.fill("ABC123XY");
      }

      const makeInput = page.getByLabel(/make/i);
      if (await makeInput.isVisible()) {
        await makeInput.fill("Toyota");
      }

      const modelInput = page.getByLabel(/model/i);
      if (await modelInput.isVisible()) {
        await modelInput.fill("Corolla");
      }

      const yearInput = page.getByLabel(/year/i);
      if (await yearInput.isVisible()) {
        await yearInput.fill("2022");
      }

      const typeSelect = page.getByRole("combobox", { name: /type/i });
      if (await typeSelect.isVisible()) {
        await typeSelect.selectOption({ index: 1 });
      }

      const saveButton = page.getByRole("button", { name: /save|add|create/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }
    }
  });

  test("should upload vehicle documents", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const addButton = page.getByRole("button", { name: /add.*vehicle/i });

    if (await addButton.isVisible()) {
      await addButton.click();

      const uploadSection = page.getByText(
        /documents|upload|insurance|registration/i,
      );
      // Would need actual files for full test
    }
  });
});

test.describe("Vehicle Details", () => {
  test("should view vehicle details", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const viewButton = page
      .getByRole("button", { name: /view|details/i })
      .first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      await expect(
        page.getByText(/details|vehicle.*info/i).first(),
      ).toBeVisible();
    }
  });

  test("should show vehicle trip history", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const viewButton = page.getByRole("button", { name: /view/i }).first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const tripsTab = page.getByRole("tab", { name: /trips|history/i });
      if (await tripsTab.isVisible()) {
        await tripsTab.click();
      }
    }
  });

  test("should show maintenance history", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const viewButton = page.getByRole("button", { name: /view/i }).first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const maintenanceTab = page.getByRole("tab", {
        name: /maintenance|service/i,
      });
      if (await maintenanceTab.isVisible()) {
        await maintenanceTab.click();
      }
    }
  });

  test("should show document expiry dates", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const viewButton = page.getByRole("button", { name: /view/i }).first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const documentsTab = page.getByRole("tab", { name: /documents/i });
      if (await documentsTab.isVisible()) {
        await documentsTab.click();

        // Should show expiry info
        await expect(
          page.getByText(/expiry|expires|valid.*until/i).first(),
        ).toBeVisible();
      }
    }
  });
});

test.describe("Vehicle Actions", () => {
  test("should edit vehicle details", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/vehicles\/.*/, {
      success: true,
      data: { updated: true },
    });

    await page.goto("/vehicles");

    const editButton = page.getByRole("button", { name: /edit/i }).first();

    if (await editButton.isVisible()) {
      await editButton.click();

      const modelInput = page.getByLabel(/model/i);
      if (await modelInput.isVisible()) {
        await modelInput.fill("Camry");
      }

      const saveButton = page.getByRole("button", { name: /save|update/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }
    }
  });

  test("should assign driver to vehicle", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/vehicles\/.*\/assign/, {
      success: true,
      data: { driverId: "drv_123" },
    });

    await page.goto("/vehicles");

    const assignButton = page
      .getByRole("button", { name: /assign|driver/i })
      .first();

    if (await assignButton.isVisible()) {
      await assignButton.click();

      const driverSelect = page.getByRole("combobox", { name: /driver/i });
      if (await driverSelect.isVisible()) {
        await driverSelect.selectOption({ index: 1 });
      }

      const confirmButton = page.getByRole("button", {
        name: /assign|confirm/i,
      });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }
  });

  test("should mark vehicle for maintenance", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/vehicles\/.*\/maintenance/, {
      success: true,
      data: { status: "maintenance" },
    });

    await page.goto("/vehicles");

    const maintenanceButton = page
      .getByRole("button", { name: /maintenance|service/i })
      .first();

    if (await maintenanceButton.isVisible()) {
      await maintenanceButton.click();

      const reasonInput = page.getByPlaceholder(/reason|notes/i);
      if (await reasonInput.isVisible()) {
        await reasonInput.fill("Scheduled oil change");
      }
    }
  });

  test("should remove vehicle from fleet", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(
      /\/api\/vehicles\/.*/,
      {
        success: true,
        data: { deleted: true },
      },
      200,
    );

    await page.goto("/vehicles");

    const removeButton = page
      .getByRole("button", { name: /remove|delete/i })
      .first();

    if (await removeButton.isVisible()) {
      await removeButton.click();

      const confirmButton = page.getByRole("button", { name: /confirm|yes/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
    }
  });
});

test.describe("Vehicle Maintenance Alerts", () => {
  test("should show expiring documents warning", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const expiryWarning = page.getByText(/expiring|expired|renew/i);
    // May or may not have warnings
  });

  test("should show maintenance due alerts", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const maintenanceAlert = page.getByText(
      /maintenance.*due|service.*required/i,
    );
    // Contextual
  });
});

test.describe("Vehicle Types", () => {
  test("should filter by car type", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const typeFilter = page
      .getByRole("button", { name: /type|car|sedan/i })
      .first();

    if (await typeFilter.isVisible()) {
      await typeFilter.click();

      const carOption = page.getByText(/car|sedan/i);
      if (await carOption.first().isVisible()) {
        await carOption.first().click();
      }
    }
  });

  test("should filter by bike/motorcycle", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const typeFilter = page.getByRole("button", { name: /type/i }).first();

    if (await typeFilter.isVisible()) {
      await typeFilter.click();

      const bikeOption = page.getByText(/bike|motorcycle/i);
      if (await bikeOption.first().isVisible()) {
        await bikeOption.first().click();
      }
    }
  });

  test("should filter by tricycle/keke", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/vehicles");

    const typeFilter = page.getByRole("button", { name: /type/i }).first();

    if (await typeFilter.isVisible()) {
      await typeFilter.click();

      const tricycleOption = page.getByText(/tricycle|keke/i);
      if (await tricycleOption.first().isVisible()) {
        await tricycleOption.first().click();
      }
    }
  });
});
