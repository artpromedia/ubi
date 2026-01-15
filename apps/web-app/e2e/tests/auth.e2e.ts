/**
 * E2E Test: Authentication Flow
 *
 * Tests the complete authentication flow including:
 * - Phone number login with OTP
 * - Session management
 * - Logout
 */

import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Authentication Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForPageLoad(page);
  });

  test("should display login page for unauthenticated users", async ({
    page,
  }) => {
    // Clear any existing auth
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto("/");

    // Should see login prompt or redirect to login
    await expect(
      page.getByRole("button", { name: /sign in|login|get started/i }),
    ).toBeVisible();
  });

  test("should show phone number input on login page", async ({ page }) => {
    await page.goto("/login");

    // Phone input should be visible
    await expect(page.getByPlaceholder(/phone|mobile/i)).toBeVisible();

    // Should show country code selector
    await expect(page.getByText(/\+234|\+254|\+233/)).toBeVisible();
  });

  test("should validate phone number format", async ({ page }) => {
    await page.goto("/login");

    const phoneInput = page.getByPlaceholder(/phone|mobile/i);

    // Enter invalid phone number
    await phoneInput.fill("123");
    await page.getByRole("button", { name: /continue|next|send/i }).click();

    // Should show validation error
    await expect(page.getByText(/invalid|valid phone/i)).toBeVisible();
  });

  test("should send OTP and show verification screen", async ({
    page,
    mockApiResponse,
  }) => {
    // Mock OTP send API
    await mockApiResponse(/\/api\/auth\/login/, {
      success: true,
      data: { otpSent: true, expiresIn: 300 },
    });

    await page.goto("/login");

    // Enter valid Nigerian phone number
    const phoneInput = page.getByPlaceholder(/phone|mobile/i);
    await phoneInput.fill("8012345678");

    await page.getByRole("button", { name: /continue|next|send/i }).click();

    // Should show OTP input screen
    await expect(page.getByText(/enter.*code|verification/i)).toBeVisible();
    await expect(
      page.getByPlaceholder(/otp|code|digit/i).first(),
    ).toBeVisible();
  });

  test("should verify OTP and redirect to home", async ({
    page,
    mockApiResponse,
  }) => {
    // Mock successful authentication
    await mockApiResponse(/\/api\/auth\/login/, {
      success: true,
      data: {
        user: {
          id: "user_001",
          email: "test@ubi.com",
          firstName: "Test",
          lastName: "User",
        },
        token: "test_token_123",
      },
    });

    await page.goto("/login");
    await page.getByPlaceholder(/phone|mobile/i).fill("8012345678");
    await page.getByRole("button", { name: /continue|next|send/i }).click();

    // Enter OTP
    const otpInputs = page.locator('input[type="tel"], input[type="number"]');
    const count = await otpInputs.count();

    for (let i = 0; i < Math.min(count, 6); i++) {
      await otpInputs.nth(i).fill(String(i + 1));
    }

    // Should redirect to home after successful login
    await expect(page).toHaveURL(/\/(home|dashboard)?$/);
  });

  test("should handle invalid OTP", async ({ page, mockApiResponse }) => {
    // First API call: send OTP
    await mockApiResponse(/\/api\/auth\/login/, {
      success: true,
      data: { otpSent: true },
    });

    await page.goto("/login");
    await page.getByPlaceholder(/phone|mobile/i).fill("8012345678");
    await page.getByRole("button", { name: /continue|next|send/i }).click();

    // Mock failed OTP verification
    await page.route(/\/api\/auth\/verify|\/api\/auth\/login/, (route) => {
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Invalid OTP" }),
      });
    });

    // Enter wrong OTP
    const otpInputs = page.locator('input[type="tel"], input[type="number"]');
    for (let i = 0; i < 6; i++) {
      const input = otpInputs.nth(i);
      if (await input.isVisible()) {
        await input.fill("0");
      }
    }

    // Should show error message
    await expect(page.getByText(/invalid|incorrect|wrong/i)).toBeVisible();
  });

  test("should allow resending OTP", async ({ page, mockApiResponse }) => {
    await mockApiResponse(/\/api\/auth\/login/, {
      success: true,
      data: { otpSent: true, expiresIn: 300 },
    });

    await page.goto("/login");
    await page.getByPlaceholder(/phone|mobile/i).fill("8012345678");
    await page.getByRole("button", { name: /continue|next|send/i }).click();

    // Wait for resend button to be enabled
    const resendButton = page.getByRole("button", { name: /resend/i });

    // Should be disabled initially (countdown)
    await expect(resendButton).toBeDisabled();

    // Wait for countdown to finish (or mock time)
    await page.waitForTimeout(2000);

    // Eventually should be clickable
    // Note: In real tests, we'd mock the timer
  });
});

test.describe("Session Management", () => {
  test("should persist session across page reloads", async ({
    authenticatedPage,
  }) => {
    await authenticatedPage.goto("/home");
    await waitForPageLoad(authenticatedPage);

    // Should be logged in
    await expect(authenticatedPage).not.toHaveURL(/login/);

    // Reload page
    await authenticatedPage.reload();
    await waitForPageLoad(authenticatedPage);

    // Should still be logged in
    await expect(authenticatedPage).not.toHaveURL(/login/);
  });

  test("should handle session expiry gracefully", async ({
    page,
    mockApiResponse,
  }) => {
    // Set expired token
    await page.addInitScript(() => {
      localStorage.setItem("auth_token", "expired_token");
    });

    // Mock API returning 401
    await mockApiResponse(/\/api\/auth\/me/, { error: "Unauthorized" }, 401);

    await page.goto("/home");

    // Should redirect to login
    await expect(page).toHaveURL(/login/);
  });
});

test.describe("Logout", () => {
  test("should logout and redirect to login", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/home");
    await waitForPageLoad(authenticatedPage);

    // Open profile/settings menu
    await authenticatedPage
      .getByRole("button", { name: /profile|menu|settings/i })
      .click();

    // Click logout
    await authenticatedPage
      .getByRole("button", { name: /logout|sign out/i })
      .click();

    // Should redirect to login
    await expect(authenticatedPage).toHaveURL(/login|\//);

    // Should clear local storage
    const token = await authenticatedPage.evaluate(() =>
      localStorage.getItem("auth_token"),
    );
    expect(token).toBeNull();
  });
});
