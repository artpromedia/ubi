/**
 * Custom Hooks for Data Fetching
 *
 * React hooks with SWR-like patterns for data fetching,
 * caching, and real-time updates.
 */

import { useDriverStore } from "@/store/driver-store";
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "./api-client";
import { authService } from "./auth-service";
import {
  driverService,
  type DriverDocument,
  type DriverEarnings,
  type DriverStats,
} from "./driver-service";
import { notificationService, type Notification } from "./notification-service";
import { tripService, type Trip, type TripHistory } from "./trip-service";

// ============================================
// Generic Fetch Hook
// ============================================

interface UseApiState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

function useApi<T>(
  fetcher: () => Promise<{
    success: boolean;
    data?: T;
    error?: { message: string };
  }>,
  dependencies: unknown[] = [],
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetcher();
      if (response.success && response.data) {
        setData(response.data);
      } else {
        setError(response.error?.message || "Failed to fetch data");
      }
    } catch (err) {
      setError("An unexpected error occurred");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, dependencies);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

// ============================================
// Auth Hooks
// ============================================

export function useAuth() {
  const store = useDriverStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (phone: string, code: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authService.verifyOTP(phone, code);

      if (response.success && response.data) {
        const { tokens, user } = response.data;
        apiClient.setAccessToken(tokens.accessToken);
        store.setAccessToken(tokens.accessToken);
        store.setProfile({
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email || "",
          phone: user.phone,
          photoUrl: user.photoUrl,
          rating: 0,
          totalTrips: 0,
          isVerified: user.isVerified,
          vehicleType: "",
          vehiclePlate: "",
          vehicleModel: "",
        });
        store.setAuthenticated(true);
        return { success: true };
      } else {
        setError(response.error?.message || "Login failed");
        return { success: false, error: response.error?.message };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Login failed";
      console.error("Login error:", err);
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  };

  const requestOTP = async (phone: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authService.requestOTP(phone);
      if (!response.success) {
        setError(response.error?.message || "Failed to send OTP");
      }
      return response;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    await authService.logout();
    apiClient.setAccessToken(null);
    store.logout();
  };

  return {
    isAuthenticated: store.isAuthenticated,
    profile: store.profile,
    isLoading,
    error,
    login,
    requestOTP,
    logout,
  };
}

// ============================================
// Driver Hooks
// ============================================

export function useDriverStats() {
  return useApi<DriverStats>(() => driverService.getStats(), []);
}

export function useDriverEarnings(period: "day" | "week" | "month" = "day") {
  return useApi<DriverEarnings>(
    () => driverService.getEarnings(period),
    [period],
  );
}

export function useDriverDocuments() {
  return useApi<DriverDocument[]>(() => driverService.getDocuments(), []);
}

export function useDriverStatus() {
  const store = useDriverStore();
  const [isUpdating, setIsUpdating] = useState(false);

  const updateStatus = async (isOnline: boolean) => {
    setIsUpdating(true);
    try {
      const response = await driverService.updateStatus(isOnline);
      if (response.success) {
        store.setStatus(isOnline ? "online" : "offline");
      }
      return response;
    } finally {
      setIsUpdating(false);
    }
  };

  return {
    status: store.status,
    isUpdating,
    updateStatus,
  };
}

// ============================================
// Trip Hooks
// ============================================

export function useActiveTrip() {
  return useApi<Trip | null>(() => tripService.getActiveTrip(), []);
}

export function useTripHistory(page = 1, limit = 20) {
  return useApi<TripHistory>(
    () => tripService.getHistory(page, limit),
    [page, limit],
  );
}

export function useTripActions() {
  const [isLoading, setIsLoading] = useState(false);

  const acceptTrip = async (tripId: string) => {
    setIsLoading(true);
    try {
      return await tripService.acceptTrip(tripId);
    } finally {
      setIsLoading(false);
    }
  };

  const declineTrip = async (tripId: string, reason?: string) => {
    setIsLoading(true);
    try {
      return await tripService.declineTrip(tripId, reason);
    } finally {
      setIsLoading(false);
    }
  };

  const startTrip = async (tripId: string) => {
    setIsLoading(true);
    try {
      return await tripService.startTrip(tripId);
    } finally {
      setIsLoading(false);
    }
  };

  const completeTrip = async (tripId: string) => {
    setIsLoading(true);
    try {
      return await tripService.completeTrip(tripId);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    isLoading,
    acceptTrip,
    declineTrip,
    startTrip,
    completeTrip,
  };
}

// ============================================
// Notification Hooks
// ============================================

export function useNotifications(page = 1) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await notificationService.getNotifications(page);
      if (response.success && response.data) {
        setNotifications(response.data.notifications);
        setUnreadCount(response.data.unreadCount);
      }
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const markAsRead = async (id: string) => {
    const response = await notificationService.markAsRead(id);
    if (response.success) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  };

  const markAllAsRead = async () => {
    const response = await notificationService.markAllAsRead();
    if (response.success) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    }
  };

  const deleteNotification = async (id: string) => {
    const response = await notificationService.deleteNotification(id);
    if (response.success) {
      const notification = notifications.find((n) => n.id === id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (notification && !notification.read) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    }
  };

  return {
    notifications,
    unreadCount,
    isLoading,
    refetch: fetchNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
}

// ============================================
// Location Hook
// ============================================

export function useLocationTracking() {
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported");
      return;
    }

    setIsTracking(true);
    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        await driverService.updateLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          heading: position.coords.heading || undefined,
          speed: position.coords.speed || undefined,
          accuracy: position.coords.accuracy,
        });
      },
      (err) => {
        setError(err.message);
        setIsTracking(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 10000,
      },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      setIsTracking(false);
    };
  }, []);

  return { isTracking, error, startTracking };
}
