/**
 * Health Routes Tests
 */

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

// Mock dependencies before importing routes
vi.mock("../lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    restaurant: {
      count: vi.fn().mockResolvedValue(10),
    },
    order: {
      count: vi.fn().mockResolvedValue(5),
    },
  },
  checkConnection: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    ping: vi.fn().mockResolvedValue("PONG"),
  },
  checkConnection: vi.fn().mockResolvedValue(true),
}));

// Import after mocking
import { healthRoutes } from "./health";

describe("Health Routes", () => {
  const app = new Hono();
  app.route("/health", healthRoutes);

  describe("GET /health", () => {
    it("should return healthy status", async () => {
      const res = await app.request("/health");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("healthy");
      expect(body.service).toBe("food-service");
      expect(body.timestamp).toBeDefined();
    });
  });

  describe("GET /health/live", () => {
    it("should return alive status", async () => {
      const res = await app.request("/health/live");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("alive");
    });
  });

  describe("GET /health/ready", () => {
    it("should return ready when all checks pass", async () => {
      const res = await app.request("/health/ready");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("ready");
      expect(body.checks.database.status).toBe("healthy");
      expect(body.checks.redis.status).toBe("healthy");
    });
  });

  describe("GET /health/detailed", () => {
    it("should return detailed health information", async () => {
      const res = await app.request("/health/detailed");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("healthy");
      expect(body.version).toBeDefined();
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.checks.database).toBeDefined();
      expect(body.checks.redis).toBeDefined();
      expect(body.stats.totalRestaurants).toBe(10);
      expect(body.stats.ordersToday).toBe(5);
      expect(body.environment.nodeVersion).toBeDefined();
    });
  });
});
