/**
 * E2E Test: Ride Booking Flow
 *
 * Tests the complete ride booking flow including:
 * - Location selection
 * - Ride type selection
 * - Price estimation
 * - Driver matching
 * - Trip tracking
 * - Payment
 */

import { LAGOS_LOCATIONS } from "@ubi/testing";
import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Ride Booking Flow", () => {
  test.beforeEach(async ({ authenticatedPage, mockLocation }) => {
    // Set user location to Lagos
    await mockLocation(
      LAGOS_LOCATIONS.VICTORIA_ISLAND.latitude,
      LAGOS_LOCATIONS.VICTORIA_ISLAND.longitude,
    );

    await authenticatedPage.goto("/");
    await waitForPageLoad(authenticatedPage);
  });

  test("should show map with current location", async ({
    authenticatedPage,
    mockLocation,
  }) => {
    await mockLocation(6.4281, 3.4219); // Victoria Island, Lagos

    await authenticatedPage.goto("/ride");

    // Map should be visible
    await expect(
      authenticatedPage.locator(".map-container, [data-testid='map']"),
    ).toBeVisible();

    // Current location marker should be visible
    await expect(
      authenticatedPage.locator("[data-testid='current-location-marker']"),
    ).toBeVisible();
  });

  test("should allow searching for destination", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/ride");

    // Click on "Where to?" input
    await authenticatedPage
      .getByPlaceholder(/where|destination|going/i)
      .click();

    // Type destination
    await authenticatedPage.getByPlaceholder(/search|enter/i).fill("Ikeja");

    // Should show search results
    await expect(
      authenticatedPage.locator("[data-testid='search-results']"),
    ).toBeVisible();

    // Should show Ikeja in results
    await expect(authenticatedPage.getByText(/ikeja/i).first()).toBeVisible();
  });

  test("should show saved places", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/users\/.*\/addresses/, {
      success: true,
      data: {
        addresses: [
          { id: "1", name: "Home", address: "15 Victoria Island" },
          { id: "2", name: "Work", address: "Ikeja City Mall" },
        ],
      },
    });

    await authenticatedPage.goto("/ride");

    // Should show saved places
    await expect(authenticatedPage.getByText(/home/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/work/i)).toBeVisible();
  });

  test("should show ride options after selecting destination", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    // Mock ride estimate
    await mockApiResponse(/\/api\/rides\/estimate/, {
      success: true,
      data: {
        estimates: [
          {
            rideType: "economy",
            price: 2500,
            currency: "NGN",
            estimatedDuration: 25,
          },
          {
            rideType: "comfort",
            price: 3800,
            currency: "NGN",
            estimatedDuration: 25,
          },
        ],
      },
    });

    await authenticatedPage.goto("/ride");

    // Select destination
    await authenticatedPage
      .getByPlaceholder(/where|destination/i)
      .fill("Ikeja");
    await authenticatedPage
      .getByText(/ikeja city mall/i)
      .first()
      .click();

    // Should show ride options
    await expect(authenticatedPage.getByText(/economy/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/comfort/i)).toBeVisible();

    // Should show prices
    await expect(authenticatedPage.getByText(/₦2,500|2500/)).toBeVisible();
    await expect(authenticatedPage.getByText(/₦3,800|3800/)).toBeVisible();
  });

  test("should request ride and show searching state", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    // Mock ride creation
    await mockApiResponse(/\/api\/rides$/, {
      success: true,
      data: {
        ride: {
          id: "ride_001",
          status: "searching",
          estimatedWait: 3,
        },
      },
    });

    await authenticatedPage.goto("/ride/confirm?pickup=VI&dropoff=Ikeja");

    // Select ride type
    await authenticatedPage.getByText(/economy/i).click();

    // Click request button
    await authenticatedPage
      .getByRole("button", { name: /request|book|confirm/i })
      .click();

    // Should show searching state
    await expect(
      authenticatedPage.getByText(/searching|finding|looking/i),
    ).toBeVisible();
  });

  test("should show driver details when matched", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    // Mock ride with driver assigned
    await mockApiResponse(/\/api\/rides\/ride_001/, {
      success: true,
      data: {
        ride: {
          id: "ride_001",
          status: "driver_assigned",
          driver: {
            id: "driver_001",
            firstName: "Emeka",
            lastName: "N.",
            rating: 4.8,
            vehicle: {
              model: "Toyota Corolla",
              color: "Silver",
              plateNumber: "ABC-123XY",
            },
          },
          estimatedArrival: 5,
        },
      },
    });

    await authenticatedPage.goto("/ride/ride_001");
    await waitForPageLoad(authenticatedPage);

    // Should show driver info
    await expect(authenticatedPage.getByText(/emeka/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/4\.8|4.8/)).toBeVisible();

    // Should show vehicle info
    await expect(authenticatedPage.getByText(/toyota|corolla/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/silver/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/ABC-123/i)).toBeVisible();

    // Should show ETA
    await expect(authenticatedPage.getByText(/5\s*min/i)).toBeVisible();
  });

  test("should allow cancelling ride", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/rides\/ride_001\/cancel/, {
      success: true,
      data: {
        ride: { id: "ride_001", status: "cancelled" },
      },
    });

    await authenticatedPage.goto("/ride/ride_001");

    // Click cancel button
    await authenticatedPage.getByRole("button", { name: /cancel/i }).click();

    // Confirm cancellation
    await authenticatedPage
      .getByRole("button", { name: /yes|confirm|cancel ride/i })
      .click();

    // Should show cancellation confirmation or redirect
    await expect(
      authenticatedPage.getByText(/cancelled|ride cancelled/i),
    ).toBeVisible();
  });
});

test.describe("Ride Tracking", () => {
  test("should show live driver location on map", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/rides\/ride_001/, {
      success: true,
      data: {
        ride: {
          id: "ride_001",
          status: "driver_arrived",
          driverLocation: { latitude: 6.4281, longitude: 3.4219 },
        },
      },
    });

    await authenticatedPage.goto("/ride/ride_001");

    // Should show driver marker on map
    await expect(
      authenticatedPage.locator("[data-testid='driver-marker']"),
    ).toBeVisible();
  });

  test("should update status as ride progresses", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/ride/ride_001");

    // Status indicator should be visible
    await expect(
      authenticatedPage.locator("[data-testid='ride-status']"),
    ).toBeVisible();
  });

  test("should show trip summary after completion", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/rides\/ride_001/, {
      success: true,
      data: {
        ride: {
          id: "ride_001",
          status: "completed",
          distance: 15.2,
          actualDuration: 45,
          pricing: {
            total: 2500,
            currency: "NGN",
          },
        },
      },
    });

    await authenticatedPage.goto("/ride/ride_001/summary");

    // Should show trip details
    await expect(
      authenticatedPage.getByText(/completed|trip complete/i),
    ).toBeVisible();
    await expect(authenticatedPage.getByText(/15\.2|15.2\s*km/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/45\s*min/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/₦2,500|2500/)).toBeVisible();
  });
});

test.describe("Rating and Feedback", () => {
  test("should show rating prompt after ride completion", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/rides\/ride_001/, {
      success: true,
      data: {
        ride: { id: "ride_001", status: "completed" },
      },
    });

    await authenticatedPage.goto("/ride/ride_001/rate");

    // Should show star rating
    await expect(
      authenticatedPage.locator("[data-testid='star-rating']"),
    ).toBeVisible();

    // Should show comment input
    await expect(
      authenticatedPage.getByPlaceholder(/comment|feedback/i),
    ).toBeVisible();
  });

  test("should submit rating successfully", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/rides\/ride_001\/rate/, {
      success: true,
    });

    await authenticatedPage.goto("/ride/ride_001/rate");

    // Select 5 stars
    await authenticatedPage.locator("[data-testid='star-5']").click();

    // Add comment
    await authenticatedPage
      .getByPlaceholder(/comment|feedback/i)
      .fill("Great ride!");

    // Submit
    await authenticatedPage
      .getByRole("button", { name: /submit|done/i })
      .click();

    // Should show success or redirect
    await expect(authenticatedPage).toHaveURL(/\/|home/);
  });
});

test.describe("Network Resilience", () => {
  test("should handle poor network gracefully @slow", async ({
    authenticatedPage,
    setNetworkConditions,
  }) => {
    // Set 3G network conditions
    await setNetworkConditions("3G");

    await authenticatedPage.goto("/ride");

    // Page should still load (may be slower)
    await expect(
      authenticatedPage.locator(".map-container, [data-testid='map']"),
    ).toBeVisible({
      timeout: 30000,
    });
  });

  test("should show offline indicator when disconnected @slow", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/ride");
    await waitForPageLoad(authenticatedPage);

    // Simulate offline
    await authenticatedPage.context().setOffline(true);

    // Try to make a request
    await authenticatedPage.reload();

    // Should show offline indicator
    await expect(
      authenticatedPage.getByText(/offline|no connection|network/i),
    ).toBeVisible();

    // Restore connection
    await authenticatedPage.context().setOffline(false);
  });
});
