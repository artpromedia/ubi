/**
 * MSW Request Handlers
 *
 * Mock API handlers for UBI services.
 */

import { delay, http, HttpResponse } from "msw";
import { createFoodOrder } from "../factories/food.factory";
import { createRide, createRides } from "../factories/ride.factory";
import {
  TEST_PAYMENT_METHODS,
  TEST_TRANSACTIONS,
  TEST_WALLETS,
} from "../fixtures/payments.fixture";
import {
  TEST_FOOD_ORDERS,
  TEST_MENU_ITEMS,
  TEST_RESTAURANTS,
} from "../fixtures/restaurants.fixture";
import { TEST_RIDES } from "../fixtures/rides.fixture";
import {
  TEST_AUTH_TOKENS,
  TEST_DRIVERS,
  TEST_RIDERS,
  TEST_USERS,
} from "../fixtures/users.fixture";

// Base URL for API mocking
const API_BASE_URL = process.env.VITE_API_URL || "http://localhost:3000/api";

// =============================================================================
// Auth Handlers
// =============================================================================

export const authHandlers = [
  // Login with phone number
  http.post(`${API_BASE_URL}/auth/login`, async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as { phone: string; otp?: string };

    if (!body.phone) {
      return HttpResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    // Request OTP
    if (!body.otp) {
      return HttpResponse.json({
        success: true,
        message: "OTP sent successfully",
        data: { otpSent: true, expiresIn: 300 },
      });
    }

    // Verify OTP
    if (body.otp === "123456") {
      const user = Object.values(TEST_USERS).find(
        (u) => u.phone === body.phone
      );
      return HttpResponse.json({
        success: true,
        data: {
          user: user || TEST_USERS.CHUKWUEMEKA,
          token: TEST_AUTH_TOKENS.VALID_TOKEN,
          refreshToken: "refresh_token_xxx",
        },
      });
    }

    return HttpResponse.json({ error: "Invalid OTP" }, { status: 401 });
  }),

  // Refresh token
  http.post(`${API_BASE_URL}/auth/refresh`, async () => {
    await delay(100);
    return HttpResponse.json({
      success: true,
      data: {
        token: TEST_AUTH_TOKENS.VALID_TOKEN,
        refreshToken: "new_refresh_token_xxx",
      },
    });
  }),

  // Logout
  http.post(`${API_BASE_URL}/auth/logout`, async () => {
    await delay(100);
    return HttpResponse.json({ success: true });
  }),

  // Get current user
  http.get(`${API_BASE_URL}/auth/me`, async ({ request }) => {
    await delay(150);
    const authHeader = request.headers.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return HttpResponse.json({
      success: true,
      data: { user: TEST_RIDERS.ADAOBI_RIDER },
    });
  }),
];

// =============================================================================
// User Handlers
// =============================================================================

export const userHandlers = [
  // Get user profile
  http.get(`${API_BASE_URL}/users/:id`, async ({ params }) => {
    await delay(150);
    const { id } = params;
    const user = Object.values(TEST_USERS).find((u) => u.id === id);

    if (!user) {
      return HttpResponse.json({ error: "User not found" }, { status: 404 });
    }

    return HttpResponse.json({ success: true, data: { user } });
  }),

  // Update user profile
  http.patch(`${API_BASE_URL}/users/:id`, async ({ params, request }) => {
    await delay(200);
    const { id } = params;
    const updates = (await request.json()) as Record<string, unknown>;

    return HttpResponse.json({
      success: true,
      data: {
        user: { ...TEST_USERS.CHUKWUEMEKA, ...updates, id },
      },
    });
  }),

  // Get saved addresses
  http.get(`${API_BASE_URL}/users/:id/addresses`, async () => {
    await delay(150);
    const rider = TEST_RIDERS.ADAOBI_RIDER;
    const addresses = rider
      ? [rider.homeAddress, rider.workAddress].filter(Boolean)
      : [];
    return HttpResponse.json({
      success: true,
      data: { addresses },
    });
  }),
];

// =============================================================================
// Ride Handlers
// =============================================================================

export const rideHandlers = [
  // Get ride estimate
  http.post(`${API_BASE_URL}/rides/estimate`, async () => {
    await delay(300);

    return HttpResponse.json({
      success: true,
      data: {
        estimates: [
          {
            rideType: "economy",
            price: 2500,
            currency: "NGN",
            estimatedDuration: 25,
            estimatedDistance: 10.5,
            surgeMultiplier: 1,
          },
          {
            rideType: "comfort",
            price: 3800,
            currency: "NGN",
            estimatedDuration: 25,
            estimatedDistance: 10.5,
            surgeMultiplier: 1,
          },
          {
            rideType: "premium",
            price: 5500,
            currency: "NGN",
            estimatedDuration: 25,
            estimatedDistance: 10.5,
            surgeMultiplier: 1,
          },
        ],
      },
    });
  }),

  // Request a ride
  http.post(`${API_BASE_URL}/rides`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as any;

    const newRide = createRide({
      status: "matching",
      rideType: body.rideType || "economy",
      city: "lagos",
    });

    return HttpResponse.json({
      success: true,
      data: { ride: newRide },
    });
  }),

  // Get ride by ID
  http.get(`${API_BASE_URL}/rides/:id`, async ({ params }) => {
    await delay(150);
    const { id } = params;
    const ride = Object.values(TEST_RIDES).find((r) => r.id === id);

    if (!ride) {
      return HttpResponse.json({ error: "Ride not found" }, { status: 404 });
    }

    return HttpResponse.json({ success: true, data: { ride } });
  }),

  // Get ride history
  http.get(`${API_BASE_URL}/rides`, async ({ request }) => {
    await delay(200);
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "10");

    const rides = createRides(limit, { status: "completed" });

    return HttpResponse.json({
      success: true,
      data: {
        rides,
        meta: {
          page,
          limit,
          total: 50,
          totalPages: 5,
        },
      },
    });
  }),

  // Cancel ride
  http.post(`${API_BASE_URL}/rides/:id/cancel`, async ({ params, request }) => {
    await delay(300);
    const body = (await request.json()) as any;

    return HttpResponse.json({
      success: true,
      data: {
        ride: {
          ...TEST_RIDES.CANCELLED,
          id: params.id,
          cancellationReason: body.reason,
        },
      },
    });
  }),

  // Rate ride
  http.post(`${API_BASE_URL}/rides/:id/rate`, async ({ params, request }) => {
    await delay(200);
    const body = (await request.json()) as any;

    return HttpResponse.json({
      success: true,
      data: {
        ride: {
          ...TEST_RIDES.COMPLETED,
          id: params.id,
          rating: {
            riderRating: body.rating,
            riderComment: body.comment,
          },
        },
      },
    });
  }),

  // Get nearby drivers
  http.get(`${API_BASE_URL}/rides/nearby-drivers`, async () => {
    await delay(300);

    const drivers = [
      { ...TEST_DRIVERS.EMEKA_DRIVER, eta: 3 },
      { ...TEST_DRIVERS.KAMAU_BODA, eta: 5 },
    ];

    return HttpResponse.json({
      success: true,
      data: { drivers },
    });
  }),
];

// =============================================================================
// Food Handlers
// =============================================================================

export const foodHandlers = [
  // Get restaurants
  http.get(`${API_BASE_URL}/restaurants`, async ({ request }) => {
    await delay(250);
    const url = new URL(request.url);
    const cuisine = url.searchParams.get("cuisine");
    const isOpen = url.searchParams.get("isOpen");

    let restaurants = Object.values(TEST_RESTAURANTS);

    if (cuisine) {
      restaurants = restaurants.filter((r) =>
        r.cuisineTypes.some((c: string) =>
          c.toLowerCase().includes(cuisine.toLowerCase())
        )
      );
    }

    if (isOpen === "true") {
      restaurants = restaurants.filter((r) => r.isOpen);
    }

    return HttpResponse.json({
      success: true,
      data: { restaurants },
    });
  }),

  // Get restaurant by ID
  http.get(`${API_BASE_URL}/restaurants/:id`, async ({ params }) => {
    await delay(150);
    const restaurant = Object.values(TEST_RESTAURANTS).find(
      (r) => r.id === params.id
    );

    if (!restaurant) {
      return HttpResponse.json(
        { error: "Restaurant not found" },
        { status: 404 }
      );
    }

    return HttpResponse.json({
      success: true,
      data: { restaurant },
    });
  }),

  // Get restaurant menu
  http.get(`${API_BASE_URL}/restaurants/:id/menu`, async () => {
    await delay(200);
    const menuItems = Object.values(TEST_MENU_ITEMS).filter(
      (item) => item.isAvailable
    );

    return HttpResponse.json({
      success: true,
      data: { menuItems },
    });
  }),

  // Create food order
  http.post(`${API_BASE_URL}/orders`, async ({ request }) => {
    await delay(400);
    const body = (await request.json()) as any;

    const order = createFoodOrder({
      status: "pending",
      itemCount: body.items?.length || 1,
    });

    return HttpResponse.json({
      success: true,
      data: { order },
    });
  }),

  // Get order by ID
  http.get(`${API_BASE_URL}/orders/:id`, async ({ params }) => {
    await delay(150);
    const order = Object.values(TEST_FOOD_ORDERS).find(
      (o) => o.id === params.id
    );

    if (!order) {
      return HttpResponse.json({ error: "Order not found" }, { status: 404 });
    }

    return HttpResponse.json({
      success: true,
      data: { order },
    });
  }),

  // Get order history
  http.get(`${API_BASE_URL}/orders`, async () => {
    await delay(200);
    return HttpResponse.json({
      success: true,
      data: {
        orders: Object.values(TEST_FOOD_ORDERS),
        meta: { page: 1, limit: 10, total: 2 },
      },
    });
  }),
];

// =============================================================================
// Payment Handlers
// =============================================================================

export const paymentHandlers = [
  // Get payment methods
  http.get(`${API_BASE_URL}/payment-methods`, async () => {
    await delay(150);
    return HttpResponse.json({
      success: true,
      data: {
        paymentMethods: Object.values(TEST_PAYMENT_METHODS).slice(0, 3),
      },
    });
  }),

  // Add payment method
  http.post(`${API_BASE_URL}/payment-methods`, async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as any;

    return HttpResponse.json({
      success: true,
      data: {
        paymentMethod: {
          id: `pm_new_${Date.now()}`,
          type: body.type,
          isDefault: false,
          createdAt: new Date(),
          ...body,
        },
      },
    });
  }),

  // Get wallet
  http.get(`${API_BASE_URL}/wallet`, async () => {
    await delay(150);
    return HttpResponse.json({
      success: true,
      data: { wallet: TEST_WALLETS.ADAOBI_WALLET },
    });
  }),

  // Top up wallet
  http.post(`${API_BASE_URL}/wallet/topup`, async ({ request }) => {
    await delay(400);
    const body = (await request.json()) as any;

    return HttpResponse.json({
      success: true,
      data: {
        transaction: {
          ...TEST_TRANSACTIONS.WALLET_TOPUP,
          amount: body.amount,
        },
        newBalance: TEST_WALLETS.ADAOBI_WALLET.balance + body.amount,
      },
    });
  }),

  // Get transaction history
  http.get(`${API_BASE_URL}/transactions`, async () => {
    await delay(200);
    return HttpResponse.json({
      success: true,
      data: {
        transactions: Object.values(TEST_TRANSACTIONS),
        meta: { page: 1, limit: 20, total: 6 },
      },
    });
  }),

  // Process payment
  http.post(`${API_BASE_URL}/payments`, async ({ request }) => {
    await delay(500);
    const body = (await request.json()) as any;

    // Simulate different payment outcomes
    if (body.paymentMethodId === "pm_card_fail") {
      return HttpResponse.json(
        {
          error: "Payment failed",
          details: { reason: "Insufficient funds" },
        },
        { status: 402 }
      );
    }

    return HttpResponse.json({
      success: true,
      data: {
        transaction: {
          ...TEST_TRANSACTIONS.RIDE_PAYMENT_SUCCESS,
          amount: body.amount,
          reference: `TXN_${Date.now()}`,
        },
      },
    });
  }),
];

// =============================================================================
// Driver Handlers (for driver apps)
// =============================================================================

export const driverHandlers = [
  // Get driver profile
  http.get(`${API_BASE_URL}/driver/profile`, async () => {
    await delay(150);
    return HttpResponse.json({
      success: true,
      data: { driver: TEST_DRIVERS.EMEKA_DRIVER },
    });
  }),

  // Toggle online status
  http.post(`${API_BASE_URL}/driver/status`, async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as any;

    return HttpResponse.json({
      success: true,
      data: {
        driver: {
          ...TEST_DRIVERS.EMEKA_DRIVER,
          isOnline: body.isOnline,
        },
      },
    });
  }),

  // Update location
  http.post(`${API_BASE_URL}/driver/location`, async ({ request }) => {
    await delay(100);
    const body = (await request.json()) as any;

    return HttpResponse.json({
      success: true,
      data: {
        location: body,
        timestamp: new Date().toISOString(),
      },
    });
  }),

  // Get earnings
  http.get(`${API_BASE_URL}/driver/earnings`, async () => {
    await delay(200);
    return HttpResponse.json({
      success: true,
      data: {
        today: 15000,
        thisWeek: 85000,
        thisMonth: 320000,
        currency: "NGN",
        trips: {
          today: 12,
          thisWeek: 67,
          thisMonth: 245,
        },
      },
    });
  }),

  // Accept ride request
  http.post(`${API_BASE_URL}/driver/rides/:id/accept`, async ({ params }) => {
    await delay(300);
    return HttpResponse.json({
      success: true,
      data: {
        ride: {
          ...TEST_RIDES.IN_PROGRESS,
          id: params.id,
          status: "driver_assigned",
        },
      },
    });
  }),
];

// =============================================================================
// All Handlers Combined
// =============================================================================

export const handlers = [
  ...authHandlers,
  ...userHandlers,
  ...rideHandlers,
  ...foodHandlers,
  ...paymentHandlers,
  ...driverHandlers,
];
