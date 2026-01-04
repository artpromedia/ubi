/**
 * E2E Test: Payment Methods and Transactions
 *
 * Tests payment functionality including:
 * - Payment method management
 * - Mobile money integration
 * - Card payments
 * - Wallet operations
 */

import { TEST_PAYMENT_METHODS, TEST_WALLETS } from "@ubi/testing";
import { expect, test, waitForPageLoad } from "../fixtures/test-fixtures";

test.describe("Payment Method Management", () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/settings/payment");
    await waitForPageLoad(authenticatedPage);
  });

  test("should show saved payment methods", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/users\/.*\/payment-methods/, {
      success: true,
      data: {
        paymentMethods: TEST_PAYMENT_METHODS,
      },
    });

    await authenticatedPage.reload();

    // Should show payment methods list
    await expect(
      authenticatedPage.locator("[data-testid='payment-methods-list']")
    ).toBeVisible();

    // Should show mobile money option
    await expect(
      authenticatedPage.getByText(/opay|m-pesa|mtn|mobile money/i)
    ).toBeVisible();
  });

  test("should add mobile money account", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/users\/.*\/payment-methods/, {
      success: true,
      data: {
        paymentMethod: {
          id: "pm_new",
          type: "mobile_money",
          provider: "mpesa",
          lastFour: "5678",
        },
      },
    });

    // Click add payment method
    await authenticatedPage.getByRole("button", { name: /add|new/i }).click();

    // Select mobile money
    await authenticatedPage.getByText(/mobile money/i).click();

    // Select provider
    await authenticatedPage.getByText(/m-pesa/i).click();

    // Enter phone number
    await authenticatedPage
      .getByPlaceholder(/phone|number/i)
      .fill("+254712345678");

    // Submit
    await authenticatedPage
      .getByRole("button", { name: /add|save|confirm/i })
      .click();

    // Should show success
    await expect(authenticatedPage.getByText(/added|success/i)).toBeVisible();
  });

  test("should add card payment method", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/users\/.*\/payment-methods/, {
      success: true,
      data: {
        paymentMethod: {
          id: "pm_card",
          type: "card",
          brand: "visa",
          lastFour: "4242",
        },
      },
    });

    // Click add payment method
    await authenticatedPage.getByRole("button", { name: /add|new/i }).click();

    // Select card
    await authenticatedPage.getByText(/card|credit|debit/i).click();

    // Enter card details
    await authenticatedPage
      .getByPlaceholder(/card number/i)
      .fill("4242424242424242");
    await authenticatedPage.getByPlaceholder(/mm.*yy|expiry/i).fill("12/26");
    await authenticatedPage.getByPlaceholder(/cvv|cvc/i).fill("123");

    // Submit
    await authenticatedPage.getByRole("button", { name: /add|save/i }).click();

    // Should show success
    await expect(authenticatedPage.getByText(/added|success/i)).toBeVisible();
  });

  test("should set default payment method", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(
      /\/api\/users\/.*\/payment-methods\/pm_001\/default/,
      {
        success: true,
      }
    );

    // Click on set default
    await authenticatedPage
      .getByRole("button", { name: /set default|make default/i })
      .first()
      .click();

    // Should show confirmation
    await expect(authenticatedPage.getByText(/default|primary/i)).toBeVisible();
  });

  test("should remove payment method", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/users\/.*\/payment-methods\/pm_001/, {
      success: true,
    });

    // Click remove
    await authenticatedPage
      .getByRole("button", { name: /remove|delete/i })
      .first()
      .click();

    // Confirm deletion
    await authenticatedPage
      .getByRole("button", { name: /confirm|yes|delete/i })
      .click();

    // Should show success
    await expect(authenticatedPage.getByText(/removed|deleted/i)).toBeVisible();
  });
});

test.describe("Mobile Money Flow", () => {
  test("should initiate M-Pesa payment", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/payments\/initiate/, {
      success: true,
      data: {
        transactionId: "txn_001",
        status: "pending",
        message: "Please enter your M-Pesa PIN on your phone",
      },
    });

    await authenticatedPage.goto("/payment/checkout?amount=2500&currency=KES");

    // Select M-Pesa
    await authenticatedPage.getByText(/m-pesa/i).click();

    // Should show STK push instruction
    await expect(
      authenticatedPage.getByText(/enter.*pin|check.*phone/i)
    ).toBeVisible();

    // Should show waiting indicator
    await expect(
      authenticatedPage.locator("[data-testid='payment-pending']")
    ).toBeVisible();
  });

  test("should initiate OPay payment", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/payments\/initiate/, {
      success: true,
      data: {
        transactionId: "txn_002",
        status: "pending",
        approvalUrl: "https://opay.com/pay/txn_002",
      },
    });

    await authenticatedPage.goto("/payment/checkout?amount=2500&currency=NGN");

    // Select OPay
    await authenticatedPage.getByText(/opay/i).click();

    // Should redirect or show approval flow
    await expect(
      authenticatedPage.getByText(/redirecting|approve|opay/i)
    ).toBeVisible();
  });

  test("should handle mobile money timeout", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/payments\/initiate/, {
      success: true,
      data: {
        transactionId: "txn_001",
        status: "pending",
      },
    });

    await mockApiResponse(/\/api\/payments\/txn_001\/status/, {
      success: false,
      error: {
        code: "PAYMENT_TIMEOUT",
        message: "Payment request timed out",
      },
    });

    await authenticatedPage.goto("/payment/checkout?amount=2500&currency=KES");
    await authenticatedPage.getByText(/m-pesa/i).click();

    // Wait for timeout (or mock it)
    await authenticatedPage.waitForTimeout(2000);

    // Should show retry option
    await expect(
      authenticatedPage.getByRole("button", { name: /retry|try again/i })
    ).toBeVisible();
  });
});

test.describe("Wallet Operations", () => {
  test("should show wallet balance", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/wallets\/me/, {
      success: true,
      data: {
        wallet: TEST_WALLETS.naira,
      },
    });

    await authenticatedPage.goto("/wallet");

    // Should show balance
    await expect(authenticatedPage.getByText(/₦|balance/i)).toBeVisible();
  });

  test("should top up wallet", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/wallets\/topup/, {
      success: true,
      data: {
        transactionId: "txn_topup",
        newBalance: 10000,
      },
    });

    await authenticatedPage.goto("/wallet");

    // Click top up
    await authenticatedPage
      .getByRole("button", { name: /top up|add money/i })
      .click();

    // Enter amount
    await authenticatedPage.getByPlaceholder(/amount/i).fill("5000");

    // Select payment method
    await authenticatedPage
      .getByText(/card|bank/i)
      .first()
      .click();

    // Confirm
    await authenticatedPage
      .getByRole("button", { name: /top up|add|confirm/i })
      .click();

    // Should show success
    await expect(authenticatedPage.getByText(/success|added/i)).toBeVisible();
  });

  test("should show transaction history", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/wallets\/me\/transactions/, {
      success: true,
      data: {
        transactions: [
          {
            id: "txn_001",
            type: "debit",
            amount: 2500,
            description: "Ride payment",
            createdAt: "2024-01-15T10:00:00Z",
          },
          {
            id: "txn_002",
            type: "credit",
            amount: 5000,
            description: "Wallet top-up",
            createdAt: "2024-01-14T09:00:00Z",
          },
        ],
      },
    });

    await authenticatedPage.goto("/wallet/history");

    // Should show transactions
    await expect(
      authenticatedPage.locator("[data-testid='transaction-list']")
    ).toBeVisible();

    // Should show transaction types
    await expect(authenticatedPage.getByText(/ride payment/i)).toBeVisible();
    await expect(authenticatedPage.getByText(/top-up/i)).toBeVisible();
  });
});

test.describe("Payment during Checkout", () => {
  test("should complete payment for ride", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/rides\/ride_001\/pay/, {
      success: true,
      data: {
        payment: {
          id: "pmt_001",
          status: "completed",
          amount: 2500,
          currency: "NGN",
        },
      },
    });

    await authenticatedPage.goto("/ride/ride_001/payment");

    // Select payment method
    await authenticatedPage
      .locator("[data-testid='payment-method']")
      .first()
      .click();

    // Confirm payment
    await authenticatedPage
      .getByRole("button", { name: /pay|confirm/i })
      .click();

    // Should show success
    await expect(
      authenticatedPage.getByText(/paid|success|complete/i)
    ).toBeVisible();
  });

  test("should complete payment for food order", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/food-orders\/order_001\/pay/, {
      success: true,
      data: {
        payment: {
          id: "pmt_002",
          status: "completed",
          amount: 4500,
          currency: "NGN",
        },
      },
    });

    await authenticatedPage.goto("/food/checkout");

    // Select wallet payment
    await authenticatedPage.getByText(/wallet|balance/i).click();

    // Place order
    await authenticatedPage
      .getByRole("button", { name: /place order|pay/i })
      .click();

    // Should show success
    await expect(
      authenticatedPage.getByText(/order placed|success/i)
    ).toBeVisible();
  });

  test("should handle insufficient wallet balance", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/food-orders/, {
      success: false,
      error: {
        code: "INSUFFICIENT_BALANCE",
        message: "Insufficient wallet balance",
      },
    });

    await authenticatedPage.goto("/food/checkout");

    // Select wallet
    await authenticatedPage.getByText(/wallet/i).click();

    // Try to place order
    await authenticatedPage
      .getByRole("button", { name: /place order/i })
      .click();

    // Should show error with top-up option
    await expect(
      authenticatedPage.getByText(/insufficient|not enough/i)
    ).toBeVisible();
    await expect(
      authenticatedPage.getByRole("button", { name: /top up/i })
    ).toBeVisible();
  });
});

test.describe("Payment Security", () => {
  test("should mask card numbers", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/settings/payment");

    // Card numbers should be masked
    await expect(
      authenticatedPage.getByText(/\*{4}\s*\d{4}|\*\*\*\*\s*\d{4}/)
    ).toBeVisible();
  });

  test("should require PIN for large transactions", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/payments\/initiate/, {
      success: true,
      data: {
        requiresPin: true,
        transactionId: "txn_large",
      },
    });

    await authenticatedPage.goto(
      "/payment/checkout?amount=100000&currency=NGN"
    );

    // Should show PIN input
    await expect(authenticatedPage.getByPlaceholder(/pin/i)).toBeVisible();
  });

  test("should handle 3DS verification", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/payments\/initiate/, {
      success: true,
      data: {
        requires3DS: true,
        redirectUrl: "https://3ds.bank.com/verify",
      },
    });

    await authenticatedPage.goto("/payment/checkout?amount=50000&currency=NGN");
    await authenticatedPage.getByText(/card/i).first().click();

    // Should show 3DS redirect or iframe
    await expect(authenticatedPage.getByText(/verify|3ds|bank/i)).toBeVisible();
  });
});

test.describe("Receipts and Invoices", () => {
  test("should show payment receipt", async ({
    authenticatedPage,
    mockApiResponse,
  }) => {
    await mockApiResponse(/\/api\/payments\/pmt_001\/receipt/, {
      success: true,
      data: {
        receipt: {
          id: "rcpt_001",
          amount: 2500,
          currency: "NGN",
          date: "2024-01-15T10:30:00Z",
          description: "Ride from VI to Ikeja",
        },
      },
    });

    await authenticatedPage.goto("/payment/receipt/pmt_001");

    // Should show receipt details
    await expect(
      authenticatedPage.getByText(/receipt|payment confirmation/i)
    ).toBeVisible();
    await expect(authenticatedPage.getByText(/₦2,500|2500/)).toBeVisible();
  });

  test("should allow downloading receipt", async ({ authenticatedPage }) => {
    await authenticatedPage.goto("/payment/receipt/pmt_001");

    // Download button should be available
    await expect(
      authenticatedPage.getByRole("button", { name: /download|save|pdf/i })
    ).toBeVisible();
  });
});
