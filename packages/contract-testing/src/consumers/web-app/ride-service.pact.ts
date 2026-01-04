/**
 * Web App Consumer Contract Tests - Ride Service
 *
 * Tests the contract between the Web App (consumer) and Ride Service (provider).
 */

import { MatchersV3, PactV3 } from "@pact-foundation/pact";
import { CONSUMERS, PACTS_DIR, PROVIDER_STATES, PROVIDERS } from "../../config";

const { like, eachLike, string, integer, boolean, decimal, regex, datetime } =
  MatchersV3;

const provider = new PactV3({
  consumer: CONSUMERS.WEB_APP,
  provider: PROVIDERS.RIDE_SERVICE,
  dir: PACTS_DIR,
  logLevel: "warn",
});

describe("Web App - Ride Service Contract", () => {
  describe("POST /api/v1/rides/estimate", () => {
    it("returns ride price estimates", async () => {
      await provider
        .given(PROVIDER_STATES.DRIVERS_AVAILABLE.replace("%s", "lagos"))
        .uponReceiving("a request for ride price estimates")
        .withRequest({
          method: "POST",
          path: "/api/v1/rides/estimate",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            pickup: {
              latitude: 6.4281,
              longitude: 3.4219,
            },
            dropoff: {
              latitude: 6.6018,
              longitude: 3.3515,
            },
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
              estimates: eachLike({
                rideType: regex(/^(economy|comfort|premium)$/, "economy"),
                price: integer(2500),
                currency: string("NGN"),
                estimatedDuration: integer(25),
                estimatedDistance: decimal(15.2),
                surgeMultiplier: like(1.0),
              }),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/rides/estimate`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer valid_token",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              pickup: { latitude: 6.4281, longitude: 3.4219 },
              dropoff: { latitude: 6.6018, longitude: 3.3515 },
            }),
          }
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.estimates).toBeInstanceOf(Array);
        expect(body.data.estimates.length).toBeGreaterThan(0);
      });
    });

    it("handles no drivers available", async () => {
      await provider
        .given(
          PROVIDER_STATES.NO_DRIVERS_AVAILABLE.replace("%s", "remote_area")
        )
        .uponReceiving("a request for estimates with no drivers")
        .withRequest({
          method: "POST",
          path: "/api/v1/rides/estimate",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            pickup: {
              latitude: 9.0765,
              longitude: 7.3986,
            },
            dropoff: {
              latitude: 9.0865,
              longitude: 7.4086,
            },
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
              estimates: [],
              message: string("No drivers available in your area"),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/rides/estimate`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer valid_token",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              pickup: { latitude: 9.0765, longitude: 7.3986 },
              dropoff: { latitude: 9.0865, longitude: 7.4086 },
            }),
          }
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.estimates).toHaveLength(0);
      });
    });
  });

  describe("POST /api/v1/rides", () => {
    it("creates a new ride request", async () => {
      await provider
        .given(PROVIDER_STATES.DRIVERS_AVAILABLE.replace("%s", "lagos"))
        .uponReceiving("a request to create a new ride")
        .withRequest({
          method: "POST",
          path: "/api/v1/rides",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            pickup: {
              latitude: 6.4281,
              longitude: 3.4219,
              address: "15 Victoria Island, Lagos",
            },
            dropoff: {
              latitude: 6.6018,
              longitude: 3.3515,
              address: "Ikeja City Mall, Lagos",
            },
            rideType: "economy",
            paymentMethod: "wallet",
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
              ride: {
                id: string("ride_abc123"),
                status: regex(
                  /^(searching|driver_assigned|driver_arrived|in_progress|completed|cancelled)$/,
                  "searching"
                ),
                pickup: {
                  latitude: decimal(6.4281),
                  longitude: decimal(3.4219),
                  address: string("15 Victoria Island, Lagos"),
                },
                dropoff: {
                  latitude: decimal(6.6018),
                  longitude: decimal(3.3515),
                  address: string("Ikeja City Mall, Lagos"),
                },
                rideType: string("economy"),
                pricing: {
                  baseFare: integer(500),
                  distanceFare: integer(1500),
                  timeFare: integer(500),
                  total: integer(2500),
                  currency: string("NGN"),
                },
                estimatedWait: integer(3),
                createdAt: datetime(
                  "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                  "2024-01-15T10:30:00.000Z"
                ),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/rides`, {
          method: "POST",
          headers: {
            Authorization: "Bearer valid_token",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            pickup: {
              latitude: 6.4281,
              longitude: 3.4219,
              address: "15 Victoria Island, Lagos",
            },
            dropoff: {
              latitude: 6.6018,
              longitude: 3.3515,
              address: "Ikeja City Mall, Lagos",
            },
            rideType: "economy",
            paymentMethod: "wallet",
          }),
        });

        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.data.ride.id).toBeDefined();
        expect(body.data.ride.status).toBe("searching");
      });
    });
  });

  describe("GET /api/v1/rides/:id", () => {
    it("returns ride details", async () => {
      await provider
        .given(PROVIDER_STATES.RIDE_IN_PROGRESS.replace("%s", "ride_123"))
        .uponReceiving("a request for ride details")
        .withRequest({
          method: "GET",
          path: "/api/v1/rides/ride_123",
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
              ride: {
                id: string("ride_123"),
                status: string("in_progress"),
                pickup: like({
                  latitude: 6.4281,
                  longitude: 3.4219,
                  address: "15 Victoria Island, Lagos",
                }),
                dropoff: like({
                  latitude: 6.6018,
                  longitude: 3.3515,
                  address: "Ikeja City Mall, Lagos",
                }),
                driver: {
                  id: string("driver_456"),
                  firstName: string("Emeka"),
                  lastName: string("Okonkwo"),
                  rating: decimal(4.8),
                  phoneNumber: regex(/^\+[0-9]{10,15}$/, "+2348098765432"),
                  vehicle: {
                    model: string("Toyota Corolla"),
                    color: string("Silver"),
                    plateNumber: string("ABC-123XY"),
                  },
                  location: {
                    latitude: decimal(6.45),
                    longitude: decimal(3.4),
                  },
                },
                pricing: like({
                  total: 2500,
                  currency: "NGN",
                }),
                estimatedArrival: integer(15),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/rides/ride_123`,
          {
            headers: {
              Authorization: "Bearer valid_token",
              Accept: "application/json",
            },
          }
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.ride.driver).toBeDefined();
      });
    });

    it("returns 404 for non-existent ride", async () => {
      await provider
        .given(PROVIDER_STATES.RIDE_EXISTS.replace("%s", "nonexistent"))
        .uponReceiving("a request for non-existent ride")
        .withRequest({
          method: "GET",
          path: "/api/v1/rides/nonexistent",
          headers: {
            Authorization: like("Bearer valid_token"),
            Accept: "application/json",
          },
        })
        .willRespondWith({
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(false),
            error: {
              code: string("RIDE_NOT_FOUND"),
              message: string("Ride not found"),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/rides/nonexistent`,
          {
            headers: {
              Authorization: "Bearer valid_token",
              Accept: "application/json",
            },
          }
        );

        expect(response.status).toBe(404);
      });
    });
  });

  describe("POST /api/v1/rides/:id/cancel", () => {
    it("cancels an active ride", async () => {
      await provider
        .given(PROVIDER_STATES.RIDE_SEARCHING.replace("%s", "ride_123"))
        .uponReceiving("a request to cancel a ride")
        .withRequest({
          method: "POST",
          path: "/api/v1/rides/ride_123/cancel",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            reason: "changed_mind",
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
              ride: {
                id: string("ride_123"),
                status: string("cancelled"),
                cancellationReason: string("changed_mind"),
                cancellationFee: integer(0),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/rides/ride_123/cancel`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer valid_token",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ reason: "changed_mind" }),
          }
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.ride.status).toBe("cancelled");
      });
    });
  });

  describe("POST /api/v1/rides/:id/rate", () => {
    it("rates a completed ride", async () => {
      await provider
        .given(PROVIDER_STATES.RIDE_COMPLETED.replace("%s", "ride_123"))
        .uponReceiving("a request to rate a ride")
        .withRequest({
          method: "POST",
          path: "/api/v1/rides/ride_123/rate",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            rating: 5,
            comment: "Great ride!",
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
              rating: {
                id: string("rating_001"),
                rideId: string("ride_123"),
                rating: integer(5),
                comment: string("Great ride!"),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/rides/ride_123/rate`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer valid_token",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ rating: 5, comment: "Great ride!" }),
          }
        );

        expect(response.status).toBe(200);
      });
    });
  });
});
