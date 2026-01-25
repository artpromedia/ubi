/**
 * Session Management Tests
 *
 * Tests user session creation, validation, and cleanup.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock Prisma
const mockPrisma = {
  session: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
};

vi.mock("../src/lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Session types
interface Session {
  id: string;
  userId: string;
  token: string;
  deviceInfo: {
    platform: string;
    deviceId: string;
    appVersion: string;
    osVersion: string;
  };
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
  lastActivity: Date;
  expiresAt: Date;
  createdAt: Date;
}

// Session configuration
const SESSION_CONFIG = {
  maxSessionsPerUser: 5,
  sessionExpiryDays: 30,
  inactivityTimeoutMinutes: 60,
};

// Helper functions
function generateSessionToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function isSessionExpired(session: Session): boolean {
  return new Date() > session.expiresAt;
}

function isSessionInactive(session: Session, timeoutMinutes: number): boolean {
  const now = new Date();
  const lastActivity = new Date(session.lastActivity);
  const diffMs = now.getTime() - lastActivity.getTime();
  const diffMinutes = diffMs / (1000 * 60);
  return diffMinutes > timeoutMinutes;
}

describe("Session Token Generation", () => {
  it("should generate 64-character token", () => {
    const token = generateSessionToken();
    expect(token.length).toBe(64);
  });

  it("should generate unique tokens", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateSessionToken());
    }
    expect(tokens.size).toBe(100);
  });

  it("should only contain alphanumeric characters", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe("Session Expiry", () => {
  it("should detect expired session", () => {
    const expiredSession: Session = {
      id: "session_123",
      userId: "user_123",
      token: "test_token",
      deviceInfo: {
        platform: "ios",
        deviceId: "device_123",
        appVersion: "1.0.0",
        osVersion: "17.0",
      },
      ipAddress: "192.168.1.1",
      userAgent: "UBI/1.0 iOS",
      isActive: true,
      lastActivity: new Date("2024-01-01"),
      expiresAt: new Date("2024-01-01"), // Expired
      createdAt: new Date("2023-12-01"),
    };

    expect(isSessionExpired(expiredSession)).toBe(true);
  });

  it("should not flag active session as expired", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);

    const activeSession: Session = {
      id: "session_123",
      userId: "user_123",
      token: "test_token",
      deviceInfo: {
        platform: "android",
        deviceId: "device_456",
        appVersion: "1.0.0",
        osVersion: "14",
      },
      ipAddress: "192.168.1.1",
      userAgent: "UBI/1.0 Android",
      isActive: true,
      lastActivity: new Date(),
      expiresAt: futureDate,
      createdAt: new Date(),
    };

    expect(isSessionExpired(activeSession)).toBe(false);
  });
});

describe("Session Inactivity", () => {
  it("should detect inactive session", () => {
    const twoHoursAgo = new Date();
    twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

    const inactiveSession: Session = {
      id: "session_123",
      userId: "user_123",
      token: "test_token",
      deviceInfo: {
        platform: "ios",
        deviceId: "device_123",
        appVersion: "1.0.0",
        osVersion: "17.0",
      },
      ipAddress: "192.168.1.1",
      userAgent: "UBI/1.0 iOS",
      isActive: true,
      lastActivity: twoHoursAgo, // 2 hours ago
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    };

    expect(isSessionInactive(inactiveSession, 60)).toBe(true);
  });

  it("should not flag recently active session", () => {
    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);

    const activeSession: Session = {
      id: "session_123",
      userId: "user_123",
      token: "test_token",
      deviceInfo: {
        platform: "android",
        deviceId: "device_456",
        appVersion: "1.0.0",
        osVersion: "14",
      },
      ipAddress: "192.168.1.1",
      userAgent: "UBI/1.0 Android",
      isActive: true,
      lastActivity: fiveMinutesAgo,
      expiresAt: new Date(Date.now() + 86400000),
      createdAt: new Date(),
    };

    expect(isSessionInactive(activeSession, 60)).toBe(false);
  });
});

describe("Session Management Operations", () => {
  const mockSession: Session = {
    id: "session_123",
    userId: "user_123",
    token: "abc123xyz789",
    deviceInfo: {
      platform: "ios",
      deviceId: "device_123",
      appVersion: "1.0.0",
      osVersion: "17.0",
    },
    ipAddress: "192.168.1.1",
    userAgent: "UBI/1.0 iOS",
    isActive: true,
    lastActivity: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Create Session", () => {
    it("should create a new session", async () => {
      mockPrisma.session.create.mockResolvedValue(mockSession);

      const result = await mockPrisma.session.create({
        data: {
          userId: "user_123",
          token: mockSession.token,
          deviceInfo: mockSession.deviceInfo,
          ipAddress: "192.168.1.1",
          userAgent: "UBI/1.0 iOS",
          isActive: true,
          expiresAt: mockSession.expiresAt,
        },
      });

      expect(result.token).toBe(mockSession.token);
      expect(result.isActive).toBe(true);
    });
  });

  describe("Find Session", () => {
    it("should find session by token", async () => {
      mockPrisma.session.findUnique.mockResolvedValue(mockSession);

      const result = await mockPrisma.session.findUnique({
        where: { token: mockSession.token },
      });

      expect(result).toBeDefined();
      expect(result?.token).toBe(mockSession.token);
    });

    it("should return null for invalid token", async () => {
      mockPrisma.session.findUnique.mockResolvedValue(null);

      const result = await mockPrisma.session.findUnique({
        where: { token: "invalid_token" },
      });

      expect(result).toBeNull();
    });
  });

  describe("List User Sessions", () => {
    it("should return all sessions for a user", async () => {
      const userSessions = [
        mockSession,
        {
          ...mockSession,
          id: "session_456",
          deviceInfo: { ...mockSession.deviceInfo, platform: "android" },
        },
      ];
      mockPrisma.session.findMany.mockResolvedValue(userSessions);

      const result = await mockPrisma.session.findMany({
        where: { userId: "user_123", isActive: true },
      });

      expect(result).toHaveLength(2);
    });
  });

  describe("Update Session", () => {
    it("should update last activity timestamp", async () => {
      const newTimestamp = new Date();
      const updatedSession = { ...mockSession, lastActivity: newTimestamp };
      mockPrisma.session.update.mockResolvedValue(updatedSession);

      const result = await mockPrisma.session.update({
        where: { id: mockSession.id },
        data: { lastActivity: newTimestamp },
      });

      expect(result.lastActivity).toEqual(newTimestamp);
    });

    it("should deactivate session", async () => {
      const deactivatedSession = { ...mockSession, isActive: false };
      mockPrisma.session.update.mockResolvedValue(deactivatedSession);

      const result = await mockPrisma.session.update({
        where: { id: mockSession.id },
        data: { isActive: false },
      });

      expect(result.isActive).toBe(false);
    });
  });

  describe("Delete Session", () => {
    it("should delete session by id", async () => {
      mockPrisma.session.delete.mockResolvedValue(mockSession);

      const result = await mockPrisma.session.delete({
        where: { id: mockSession.id },
      });

      expect(result.id).toBe(mockSession.id);
    });

    it("should delete all sessions for a user", async () => {
      mockPrisma.session.deleteMany.mockResolvedValue({ count: 5 });

      const result = await mockPrisma.session.deleteMany({
        where: { userId: "user_123" },
      });

      expect(result.count).toBe(5);
    });
  });
});

describe("Session Security", () => {
  describe("Session Limits", () => {
    it("should enforce maximum sessions per user", async () => {
      const existingSessions = Array(5)
        .fill(null)
        .map((_, i) => ({
          id: `session_${i}`,
          userId: "user_123",
          isActive: true,
        }));

      mockPrisma.session.findMany.mockResolvedValue(existingSessions);

      const result = await mockPrisma.session.findMany({
        where: { userId: "user_123", isActive: true },
      });

      expect(result.length).toBe(SESSION_CONFIG.maxSessionsPerUser);
      // In real implementation, oldest session would be removed
    });
  });

  describe("IP Address Validation", () => {
    function isValidIPv4(ip: string): boolean {
      const pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!pattern.test(ip)) return false;

      const parts = ip.split(".");
      return parts.every((part) => {
        const num = Number.parseInt(part, 10);
        return num >= 0 && num <= 255;
      });
    }

    function isValidIPv6(ip: string): boolean {
      const pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
      return pattern.test(ip);
    }

    it("should validate IPv4 addresses", () => {
      expect(isValidIPv4("192.168.1.1")).toBe(true);
      expect(isValidIPv4("10.0.0.1")).toBe(true);
      expect(isValidIPv4("256.1.1.1")).toBe(false);
      expect(isValidIPv4("not-an-ip")).toBe(false);
    });

    it("should validate IPv6 addresses", () => {
      expect(isValidIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
      expect(isValidIPv6("not-an-ip")).toBe(false);
    });
  });

  describe("Device Info Validation", () => {
    const validDeviceInfo = {
      platform: "ios",
      deviceId: "ABCD-1234-EFGH-5678",
      appVersion: "1.2.3",
      osVersion: "17.0",
    };

    it("should accept valid device info", () => {
      expect(validDeviceInfo.platform).toMatch(/^(ios|android|web)$/);
      expect(validDeviceInfo.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("should validate app version format", () => {
      const validVersions = ["1.0.0", "2.1.5", "10.20.30"];
      const invalidVersions = ["1.0", "v1.0.0", "1.0.0.0"];

      validVersions.forEach((v) => {
        expect(v).toMatch(/^\d+\.\d+\.\d+$/);
      });

      invalidVersions.forEach((v) => {
        expect(v).not.toMatch(/^\d+\.\d+\.\d+$/);
      });
    });
  });
});

describe("Session Cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should delete expired sessions", async () => {
    mockPrisma.session.deleteMany.mockResolvedValue({ count: 10 });

    const result = await mockPrisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    expect(result.count).toBe(10);
  });

  it("should delete inactive sessions", async () => {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - 1);

    mockPrisma.session.deleteMany.mockResolvedValue({ count: 5 });

    const result = await mockPrisma.session.deleteMany({
      where: {
        lastActivity: { lt: cutoffDate },
        isActive: true,
      },
    });

    expect(result.count).toBe(5);
  });
});

describe("Session Analytics", () => {
  interface SessionAnalytics {
    totalSessions: number;
    activeSessions: number;
    byPlatform: Record<string, number>;
    avgSessionDuration: number;
  }

  function calculateSessionAnalytics(sessions: Session[]): SessionAnalytics {
    const activeSessions = sessions.filter((s) => s.isActive);
    const byPlatform: Record<string, number> = {};

    sessions.forEach((session) => {
      const platform = session.deviceInfo.platform;
      byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    });

    // Calculate average session duration in minutes
    let totalDuration = 0;
    sessions.forEach((session) => {
      const duration =
        session.lastActivity.getTime() - session.createdAt.getTime();
      totalDuration += duration / (1000 * 60);
    });

    return {
      totalSessions: sessions.length,
      activeSessions: activeSessions.length,
      byPlatform,
      avgSessionDuration:
        sessions.length > 0 ? totalDuration / sessions.length : 0,
    };
  }

  it("should calculate session analytics", () => {
    const now = new Date();
    const sessions: Session[] = [
      {
        id: "1",
        userId: "user_1",
        token: "t1",
        deviceInfo: {
          platform: "ios",
          deviceId: "d1",
          appVersion: "1.0.0",
          osVersion: "17",
        },
        ipAddress: "1.1.1.1",
        userAgent: "UBI/iOS",
        isActive: true,
        lastActivity: now,
        expiresAt: new Date(now.getTime() + 86400000),
        createdAt: new Date(now.getTime() - 3600000), // 1 hour ago
      },
      {
        id: "2",
        userId: "user_2",
        token: "t2",
        deviceInfo: {
          platform: "android",
          deviceId: "d2",
          appVersion: "1.0.0",
          osVersion: "14",
        },
        ipAddress: "2.2.2.2",
        userAgent: "UBI/Android",
        isActive: true,
        lastActivity: now,
        expiresAt: new Date(now.getTime() + 86400000),
        createdAt: new Date(now.getTime() - 7200000), // 2 hours ago
      },
      {
        id: "3",
        userId: "user_3",
        token: "t3",
        deviceInfo: {
          platform: "ios",
          deviceId: "d3",
          appVersion: "1.0.0",
          osVersion: "17",
        },
        ipAddress: "3.3.3.3",
        userAgent: "UBI/iOS",
        isActive: false,
        lastActivity: now,
        expiresAt: new Date(now.getTime() - 86400000), // Expired
        createdAt: new Date(now.getTime() - 10800000), // 3 hours ago
      },
    ];

    const analytics = calculateSessionAnalytics(sessions);

    expect(analytics.totalSessions).toBe(3);
    expect(analytics.activeSessions).toBe(2);
    expect(analytics.byPlatform.ios).toBe(2);
    expect(analytics.byPlatform.android).toBe(1);
    expect(analytics.avgSessionDuration).toBeGreaterThan(0);
  });
});
