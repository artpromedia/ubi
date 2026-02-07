/**
 * Notification Service
 *
 * Handles push notifications and in-app notifications.
 */

import apiClient, { type ApiResponse } from "./api-client";

// ============================================
// Types
// ============================================

export type NotificationType =
  | "promo"
  | "alert"
  | "info"
  | "success"
  | "trip"
  | "payment";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  tripRequests: boolean;
  promotions: boolean;
  payments: boolean;
  documents: boolean;
  systemUpdates: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
}

// ============================================
// Service
// ============================================

export const notificationService = {
  /**
   * Get all notifications
   */
  async getNotifications(
    page = 1,
    limit = 20,
    unreadOnly = false,
  ): Promise<
    ApiResponse<{
      notifications: Notification[];
      unreadCount: number;
      meta: { page: number; limit: number; total: number };
    }>
  > {
    return apiClient.get("/notifications", {
      page: page.toString(),
      limit: limit.toString(),
      unreadOnly: unreadOnly.toString(),
    });
  },

  /**
   * Mark notification as read
   */
  async markAsRead(
    notificationId: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.patch(`/notifications/${notificationId}/read`);
  },

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.post("/notifications/read-all");
  },

  /**
   * Delete notification
   */
  async deleteNotification(
    notificationId: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.delete(`/notifications/${notificationId}`);
  },

  /**
   * Get notification preferences
   */
  async getPreferences(): Promise<ApiResponse<NotificationPreferences>> {
    return apiClient.get("/notifications/preferences");
  },

  /**
   * Update notification preferences
   */
  async updatePreferences(
    preferences: Partial<NotificationPreferences>,
  ): Promise<ApiResponse<NotificationPreferences>> {
    return apiClient.patch("/notifications/preferences", preferences);
  },

  /**
   * Register push notification token
   */
  async registerPushToken(
    token: string,
    platform: "web" | "ios" | "android",
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.post("/notifications/push-token", { token, platform });
  },

  /**
   * Unregister push notification token
   */
  async unregisterPushToken(
    token: string,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.delete(
      `/notifications/push-token?token=${encodeURIComponent(token)}`,
    );
  },
};

export default notificationService;
