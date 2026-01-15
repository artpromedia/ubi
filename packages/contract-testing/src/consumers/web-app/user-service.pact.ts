/**
 * Web App Consumer Contract Tests - User Service
 *
 * Tests the contract between the Web App (consumer) and User Service (provider).
 */

import { MatchersV3, PactV3 } from "@pact-foundation/pact";
import { CONSUMERS, PACTS_DIR, PROVIDER_STATES, PROVIDERS } from "../../config";

const { like, eachLike, string, integer, boolean, regex, datetime } =
  MatchersV3;

const provider = new PactV3({
  consumer: CONSUMERS.WEB_APP,
  provider: PROVIDERS.USER_SERVICE,
  dir: PACTS_DIR,
  logLevel: "warn",
});

describe("Web App - User Service Contract", () => {
  describe("GET /api/v1/users/me", () => {
    it("returns authenticated user profile", async () => {
      await provider
        .given(PROVIDER_STATES.USER_AUTHENTICATED.replace("%s", "user_123"))
        .uponReceiving("a request for the authenticated user profile")
        .withRequest({
          method: "GET",
          path: "/api/v1/users/me",
          headers: {
            Authorization: like("Bearer valid_token"),
            Accept: "application/json",
          },
        })
        .willRespondWith({
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              user: {
                id: string("user_123"),
                phoneNumber: regex(/^\+[0-9]{10,15}$/, "+2348012345678"),
                firstName: string("Oluwaseun"),
                lastName: string("Adeyemi"),
                email: like("seun@example.com"),
                avatarUrl: like("https://cdn.ubi.com/avatars/user_123.jpg"),
                rating: like(4.8),
                createdAt: datetime(
                  "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                  "2024-01-15T10:30:00.000Z",
                ),
              },
            },
            meta: {
              requestId: string("req_abc123"),
              timestamp: datetime(
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                "2024-01-15T10:30:00.000Z",
              ),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/users/me`, {
          headers: {
            Authorization: "Bearer valid_token",
            Accept: "application/json",
          },
        });

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.user.id).toBeDefined();
        expect(body.data.user.phoneNumber).toMatch(/^\+[0-9]+$/);
      });
    });

    it("returns 401 for invalid token", async () => {
      await provider
        .given("an invalid authentication token")
        .uponReceiving("a request with invalid token")
        .withRequest({
          method: "GET",
          path: "/api/v1/users/me",
          headers: {
            Authorization: "Bearer invalid_token",
            Accept: "application/json",
          },
        })
        .willRespondWith({
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(false),
            error: {
              code: string("UNAUTHORIZED"),
              message: string("Invalid or expired authentication token"),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/users/me`, {
          headers: {
            Authorization: "Bearer invalid_token",
            Accept: "application/json",
          },
        });

        expect(response.status).toBe(401);
      });
    });
  });

  describe("PUT /api/v1/users/me", () => {
    it("updates user profile", async () => {
      await provider
        .given(PROVIDER_STATES.USER_AUTHENTICATED.replace("%s", "user_123"))
        .uponReceiving("a request to update user profile")
        .withRequest({
          method: "PUT",
          path: "/api/v1/users/me",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            firstName: "Oluwaseun",
            lastName: "Adeyemi-Johnson",
            email: "seun.updated@example.com",
          },
        })
        .willRespondWith({
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              user: {
                id: string("user_123"),
                phoneNumber: regex(/^\+[0-9]{10,15}$/, "+2348012345678"),
                firstName: string("Oluwaseun"),
                lastName: string("Adeyemi-Johnson"),
                email: string("seun.updated@example.com"),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/users/me`, {
          method: "PUT",
          headers: {
            Authorization: "Bearer valid_token",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            firstName: "Oluwaseun",
            lastName: "Adeyemi-Johnson",
            email: "seun.updated@example.com",
          }),
        });

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.user.lastName).toBe("Adeyemi-Johnson");
      });
    });
  });

  describe("GET /api/v1/users/me/addresses", () => {
    it("returns user saved addresses", async () => {
      await provider
        .given("user has saved addresses")
        .uponReceiving("a request for saved addresses")
        .withRequest({
          method: "GET",
          path: "/api/v1/users/me/addresses",
          headers: {
            Authorization: like("Bearer valid_token"),
            Accept: "application/json",
          },
        })
        .willRespondWith({
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              addresses: eachLike({
                id: string("addr_001"),
                name: string("Home"),
                address: string("15 Victoria Island, Lagos"),
                latitude: like(6.4281),
                longitude: like(3.4219),
                isDefault: boolean(true),
              }),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/users/me/addresses`,
          {
            headers: {
              Authorization: "Bearer valid_token",
              Accept: "application/json",
            },
          },
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.addresses).toBeInstanceOf(Array);
        expect(body.data.addresses.length).toBeGreaterThan(0);
      });
    });
  });

  describe("POST /api/v1/users/me/addresses", () => {
    it("adds a new address", async () => {
      await provider
        .given(PROVIDER_STATES.USER_AUTHENTICATED.replace("%s", "user_123"))
        .uponReceiving("a request to add a new address")
        .withRequest({
          method: "POST",
          path: "/api/v1/users/me/addresses",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            name: "Work",
            address: "Ikeja City Mall, Lagos",
            latitude: 6.6018,
            longitude: 3.3515,
          },
        })
        .willRespondWith({
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              address: {
                id: string("addr_002"),
                name: string("Work"),
                address: string("Ikeja City Mall, Lagos"),
                latitude: like(6.6018),
                longitude: like(3.3515),
                isDefault: boolean(false),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/users/me/addresses`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer valid_token",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              name: "Work",
              address: "Ikeja City Mall, Lagos",
              latitude: 6.6018,
              longitude: 3.3515,
            }),
          },
        );

        expect(response.status).toBe(201);
      });
    });
  });
});
