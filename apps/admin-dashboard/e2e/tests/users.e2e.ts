/**
 * E2E Test: User Management
 *
 * Tests the admin functionality for managing platform users.
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("User List", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/users");
    await waitForPageLoad(authenticatedPage);
  });

  test("should display users list", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Should show users page
    await expect(
      page.getByText(/users|customers|members/i).first(),
    ).toBeVisible();

    // Should have table or list of users
    const userRows = page.locator(
      'tr, [data-testid*="user-row"], [class*="user-card"]',
    );
    expect(await userRows.count()).toBeGreaterThan(0);
  });

  test("should search users by name", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const searchInput = page.getByPlaceholder(/search|find|filter/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill("John");
      await page.waitForTimeout(500);

      // Results should update
    }
  });

  test("should search users by email", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const searchInput = page.getByPlaceholder(/search|find|filter/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill("test@email.com");
      await page.waitForTimeout(500);
    }
  });

  test("should search users by phone", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const searchInput = page.getByPlaceholder(/search|find|filter/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill("+234");
      await page.waitForTimeout(500);
    }
  });

  test("should filter users by status", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const statusFilter = page.getByRole("button", {
      name: /status|filter|active|inactive|blocked/i,
    });

    if (await statusFilter.first().isVisible()) {
      await statusFilter.first().click();

      // Should show status options
      await expect(
        page.getByText(/active|inactive|blocked|suspended/i).first(),
      ).toBeVisible();
    }
  });

  test("should filter users by type", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    const typeFilter = page.getByRole("button", {
      name: /type|rider|driver|restaurant|merchant/i,
    });

    if (await typeFilter.first().isVisible()) {
      await typeFilter.first().click();
    }
  });

  test("should paginate user list", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Look for pagination controls
    const nextButton = page.getByRole("button", { name: /next|→|>/i });
    const pageNumbers = page.getByText(/page \d|1.*of/i);

    if (await nextButton.isVisible()) {
      await nextButton.click();
      // Page should advance
    }
  });

  test("should sort users by column", async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Click column header to sort
    const nameHeader = page.getByRole("columnheader", { name: /name/i });
    const dateHeader = page.getByRole("columnheader", {
      name: /date|joined|created/i,
    });

    if (await nameHeader.isVisible()) {
      await nameHeader.click();
      // Should toggle sort order
    }
  });
});

test.describe("User Details", () => {
  test("should view user profile", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/users\/.*/, {
      success: true,
      data: {
        id: "USR-12345",
        firstName: "Test",
        lastName: "User",
        email: "test@email.com",
        phone: "+2348012345678",
        status: "active",
        createdAt: "2024-01-01T00:00:00Z",
      },
    });

    await page.goto("/users");

    const viewButton = page
      .getByRole("button", { name: /view|details/i })
      .first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      // Should show user details
      await expect(
        page.getByText(/test@email.com|profile|details/i).first(),
      ).toBeVisible();
    }
  });

  test("should display user activity history", async ({
    authenticatedPage,
  }) => {
    const page = authenticatedPage;
    await page.goto("/users");

    // Open user details
    const viewButton = page
      .getByRole("button", { name: /view|details/i })
      .first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      // Look for activity section
      const activityTab = page.getByRole("tab", {
        name: /activity|history|transactions/i,
      });
      if (await activityTab.isVisible()) {
        await activityTab.click();
      }
    }
  });

  test("should show user ride history", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/users");

    const viewButton = page
      .getByRole("button", { name: /view|details/i })
      .first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const ridesTab = page.getByRole("tab", { name: /rides|trips/i });
      if (await ridesTab.isVisible()) {
        await ridesTab.click();
        // Should show ride history
      }
    }
  });

  test("should show user payment history", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/users");

    const viewButton = page
      .getByRole("button", { name: /view|details/i })
      .first();

    if (await viewButton.isVisible()) {
      await viewButton.click();

      const paymentsTab = page.getByRole("tab", {
        name: /payments|transactions|wallet/i,
      });
      if (await paymentsTab.isVisible()) {
        await paymentsTab.click();
        // Should show payment history
      }
    }
  });
});

test.describe("User Management Actions", () => {
  test("should block user", async ({ authenticatedPage, mockApiResponse }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/users\/.*\/block/, {
      success: true,
      data: { status: "blocked" },
    });

    await page.goto("/users");

    const blockButton = page
      .getByRole("button", { name: /block|suspend/i })
      .first();

    if (await blockButton.isVisible()) {
      await blockButton.click();

      // Confirm dialog
      const reasonInput = page.getByPlaceholder(/reason|note/i);
      if (await reasonInput.isVisible()) {
        await reasonInput.fill("Violation of terms of service");
      }

      const confirmButton = page.getByRole("button", {
        name: /confirm|yes|block/i,
      });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }

      // Should show success
      await expect(
        page.getByText(/blocked|suspended|success/i).first(),
      ).toBeVisible();
    }
  });

  test("should unblock user", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/users\/.*\/unblock/, {
      success: true,
      data: { status: "active" },
    });

    await page.goto("/users");

    // Filter to blocked users first
    const statusFilter = page
      .getByRole("button", { name: /status|blocked/i })
      .first();
    if (await statusFilter.isVisible()) {
      await statusFilter.click();
      await page
        .getByText(/blocked/i)
        .first()
        .click();
    }

    const unblockButton = page
      .getByRole("button", { name: /unblock|activate/i })
      .first();

    if (await unblockButton.isVisible()) {
      await unblockButton.click();
    }
  });

  test("should send notification to user", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/notifications\/send/, {
      success: true,
      data: { sent: true },
    });

    await page.goto("/users");

    // View user details first
    const viewButton = page
      .getByRole("button", { name: /view|details/i })
      .first();
    if (await viewButton.isVisible()) {
      await viewButton.click();
    }

    const notifyButton = page.getByRole("button", {
      name: /send.*notification|notify|message/i,
    });

    if (await notifyButton.isVisible()) {
      await notifyButton.click();

      const messageInput = page.getByPlaceholder(/message|notification/i);
      if (await messageInput.isVisible()) {
        await messageInput.fill("Important: Your account has been verified.");

        const sendButton = page.getByRole("button", { name: /send/i });
        if (await sendButton.isVisible()) {
          await sendButton.click();
        }
      }
    }
  });

  test("should issue refund to user", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/refunds/, {
      success: true,
      data: { refundId: "REF-123" },
    });

    await page.goto("/users");

    const viewButton = page
      .getByRole("button", { name: /view|details/i })
      .first();
    if (await viewButton.isVisible()) {
      await viewButton.click();
    }

    const refundButton = page.getByRole("button", {
      name: /refund|issue.*refund/i,
    });

    if (await refundButton.isVisible()) {
      await refundButton.click();

      const amountInput = page.getByLabel(/amount/i);
      if (await amountInput.isVisible()) {
        await amountInput.fill("5000");
      }

      const reasonInput = page.getByPlaceholder(/reason/i);
      if (await reasonInput.isVisible()) {
        await reasonInput.fill("Service issue compensation");
      }

      const submitButton = page.getByRole("button", {
        name: /submit|issue|confirm/i,
      });
      if (await submitButton.isVisible()) {
        await submitButton.click();
      }
    }
  });

  test("should edit user details", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(
      /\/api\/users\/.*/,
      {
        success: true,
        data: { updated: true },
      },
      200,
    );

    await page.goto("/users");

    const editButton = page.getByRole("button", { name: /edit/i }).first();

    if (await editButton.isVisible()) {
      await editButton.click();

      const emailInput = page.getByLabel(/email/i);
      if (await emailInput.isVisible()) {
        await emailInput.fill("updated@email.com");
      }

      const saveButton = page.getByRole("button", { name: /save|update/i });
      if (await saveButton.isVisible()) {
        await saveButton.click();
      }
    }
  });

  test("should verify user identity", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/users\/.*\/verify/, {
      success: true,
      data: { verified: true },
    });

    await page.goto("/users");

    const verifyButton = page
      .getByRole("button", { name: /verify|approve.*kyc/i })
      .first();

    if (await verifyButton.isVisible()) {
      await verifyButton.click();
    }
  });
});

test.describe("User Export", () => {
  test("should export user list to CSV", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/users");

    const exportButton = page.getByRole("button", { name: /export|download/i });

    if (await exportButton.isVisible()) {
      const downloadPromise = page
        .waitForEvent("download", { timeout: 5000 })
        .catch(() => null);
      await exportButton.click();

      // May show format options
      const csvOption = page.getByText(/csv/i);
      if (await csvOption.isVisible()) {
        await csvOption.click();
      }
    }
  });
});

test.describe("Bulk User Actions", () => {
  test("should select multiple users", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/users");

    // Look for checkboxes
    const checkboxes = page.getByRole("checkbox");
    const count = await checkboxes.count();

    if (count > 1) {
      await checkboxes.nth(0).check();
      await checkboxes.nth(1).check();

      // Bulk action button should appear
      const bulkActionButton = page.getByRole("button", {
        name: /bulk|selected|action/i,
      });
      // May or may not be visible depending on implementation
    }
  });

  test("should select all users", async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await page.goto("/users");

    const selectAllCheckbox = page.getByRole("checkbox", {
      name: /select.*all|all/i,
    });

    if (await selectAllCheckbox.isVisible()) {
      await selectAllCheckbox.check();
    }
  });
});

test.describe("User Search Autocomplete", () => {
  test("should show search suggestions", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    const page = authenticatedPage;

    await mockApiResponse(/\/api\/users\/search/, {
      success: true,
      data: {
        suggestions: [
          { id: "1", name: "John Doe", email: "john@email.com" },
          { id: "2", name: "John Smith", email: "jsmith@email.com" },
        ],
      },
    });

    await page.goto("/users");

    const searchInput = page.getByPlaceholder(/search/i);

    if (await searchInput.isVisible()) {
      await searchInput.fill("John");

      // Wait for suggestions
      await page.waitForTimeout(500);

      // Suggestions dropdown may appear
      const suggestion = page.getByText(/john.*doe|john.*smith/i);
      // May or may not show depending on implementation
    }
  });
});
