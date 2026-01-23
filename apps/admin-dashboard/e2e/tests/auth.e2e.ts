/**
 * E2E Test: Admin Authentication Flow
 *
 * Tests admin login, session management, and role-based access.
 */

import { expect, test, TEST_ADMIN_USERS } from "../fixtures/test-fixtures";

test.describe("Admin Authentication", () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing auth state
    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  });

  test("should display login page for unauthenticated users", async ({
    page,
  }) => {
    await page.goto("/");

    // Should redirect to login
    await expect(page).toHaveURL(/login/);

    // Should see login form
    await expect(
      page.getByRole("heading", { name: /admin|sign in|login/i }),
    ).toBeVisible();
  });

  test("should show email and password input on login page", async ({
    page,
  }) => {
    await page.goto("/login");

    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in|login/i }),
    ).toBeVisible();
  });

  test("should validate email format", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/email/i).fill("invalid-email");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /sign in|login/i }).click();

    // Should show validation error
    await expect(page.getByText(/invalid email|valid email/i)).toBeVisible();
  });

  test("should require password", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/email/i).fill("admin@ubi.com");
    await page.getByRole("button", { name: /sign in|login/i }).click();

    // Should show validation error
    await expect(
      page.getByText(/password.*required|enter.*password/i),
    ).toBeVisible();
  });

  test("should handle invalid credentials", async ({
    page,
    mockApiResponse,
  }) => {
    await mockApiResponse(
      /\/api\/auth\/login/,
      {
        error: "Invalid credentials",
      },
      401,
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill("wrong@email.com");
    await page.getByLabel(/password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /sign in|login/i }).click();

    // Should show error
    await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible();
  });

  test("should successfully login and redirect to dashboard", async ({
    page,
    mockApiResponse,
  }) => {
    const adminUser = TEST_ADMIN_USERS.admin;

    await mockApiResponse(/\/api\/auth\/login/, {
      success: true,
      data: {
        user: adminUser,
        token: adminUser.token,
      },
    });

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(adminUser.email);
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /sign in|login/i }).click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/dashboard/);
  });

  test("should preserve session across page reloads", async ({
    page,
    loginAsAdmin,
  }) => {
    await page.goto("/login");
    await loginAsAdmin("admin");
    await page.goto("/dashboard");

    // Reload page
    await page.reload();

    // Should still be on dashboard (not redirected to login)
    await expect(page).toHaveURL(/dashboard/);
  });

  test("should logout successfully", async ({ page, loginAsAdmin }) => {
    await page.goto("/login");
    await loginAsAdmin("admin");
    await page.goto("/dashboard");

    // Find and click logout button
    const logoutButton = page.getByRole("button", { name: /logout|sign out/i });

    // May be in a dropdown menu
    const userMenu = page.getByRole("button", {
      name: /user|profile|account/i,
    });
    if (await userMenu.isVisible()) {
      await userMenu.click();
    }

    if (await logoutButton.isVisible()) {
      await logoutButton.click();
    }

    // Should redirect to login
    await expect(page).toHaveURL(/login/);
  });

  test("should restrict access based on role - support cannot view fraud", async ({
    page,
    loginAsAdmin,
  }) => {
    await page.goto("/login");
    await loginAsAdmin("support");

    // Try to access fraud page
    await page.goto("/fraud");

    // Should see access denied or redirect
    const accessDenied = page.getByText(
      /access denied|unauthorized|permission/i,
    );
    const redirectedToLogin = page.url().includes("login");
    const redirectedToDashboard = page.url().includes("dashboard");

    expect(
      (await accessDenied.isVisible()) ||
        redirectedToLogin ||
        redirectedToDashboard,
    ).toBeTruthy();
  });

  test("should allow analyst to view dashboard", async ({
    page,
    loginAsAdmin,
  }) => {
    await page.goto("/login");
    await loginAsAdmin("analyst");
    await page.goto("/dashboard");

    // Should see dashboard content
    await expect(page).toHaveURL(/dashboard/);
    await expect(
      page.getByText(/total users|active rides|overview/i),
    ).toBeVisible();
  });
});

test.describe("Two-Factor Authentication", () => {
  test("should show 2FA prompt when required", async ({
    page,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/auth\/login/, {
      success: true,
      data: {
        requires2FA: true,
        tempToken: "temp_token",
      },
    });

    await page.goto("/login");
    await page.getByLabel(/email/i).fill("admin@ubi.com");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /sign in|login/i }).click();

    // Should show 2FA input
    await expect(
      page.getByText(/two-factor|2fa|authenticator|verification code/i),
    ).toBeVisible();
  });

  test("should verify 2FA code", async ({ page, mockApiResponse }) => {
    const adminUser = TEST_ADMIN_USERS.super_admin;

    // First login returns 2FA required
    await mockApiResponse(/\/api\/auth\/login/, {
      success: true,
      data: {
        requires2FA: true,
        tempToken: "temp_token",
      },
    });

    await page.goto("/login");
    await page.getByLabel(/email/i).fill("super@ubi.com");
    await page.getByLabel(/password/i).fill("password123");
    await page.getByRole("button", { name: /sign in|login/i }).click();

    // Mock 2FA verification
    await mockApiResponse(/\/api\/auth\/verify-2fa/, {
      success: true,
      data: {
        user: adminUser,
        token: adminUser.token,
      },
    });

    // Enter 2FA code
    const codeInput = page.getByPlaceholder(/code|otp/i);
    if (await codeInput.isVisible()) {
      await codeInput.fill("123456");
      await page
        .getByRole("button", { name: /verify|submit|continue/i })
        .click();
    }

    // Should redirect to dashboard
    await expect(page).toHaveURL(/dashboard/);
  });
});
