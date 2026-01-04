/**
 * Firebase Cloud Messaging (FCM) Provider
 */

import admin from "firebase-admin";
import type {
  Message,
  MulticastMessage,
  TopicMessage,
} from "firebase-admin/messaging";
import { NotificationPriority } from "../types";

// Initialize Firebase Admin
let app: admin.app.App | null = null;

function getApp(): admin.app.App {
  if (app) return app;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccount) {
    console.warn("Firebase service account not configured");
    throw new Error("Firebase not configured");
  }

  try {
    const credentials = JSON.parse(serviceAccount);
    app = admin.initializeApp({
      credential: admin.credential.cert(credentials),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
    return app;
  } catch (error) {
    console.error("Failed to initialize Firebase:", error);
    throw error;
  }
}

// ============================================
// Types
// ============================================

export interface PushPayload {
  token: string;
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  priority?: NotificationPriority;
  badge?: number;
  sound?: string;
  channelId?: string;
  collapseKey?: string;
  ttl?: number;
}

export interface MulticastPayload {
  tokens: string[];
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  priority?: NotificationPriority;
}

export interface TopicPayload {
  topic: string;
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  priority?: NotificationPriority;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  failedTokens?: string[];
  successCount?: number;
  failureCount?: number;
}

// ============================================
// Service
// ============================================

class FirebaseService {
  /**
   * Send push notification to single device
   */
  async send(payload: PushPayload): Promise<SendResult> {
    try {
      const messaging = getApp().messaging();

      const message: Message = {
        token: payload.token,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data,
        android: {
          priority: this.mapPriority(payload.priority),
          notification: {
            channelId: payload.channelId || "default",
            sound: payload.sound || "default",
          },
          ttl: (payload.ttl || 86400) * 1000, // Convert to ms
          ...(payload.collapseKey && { collapseKey: payload.collapseKey }),
        },
        apns: {
          payload: {
            aps: {
              badge: payload.badge,
              sound: payload.sound || "default",
              contentAvailable: true,
            },
          },
          headers: {
            "apns-priority":
              payload.priority === NotificationPriority.HIGH ? "10" : "5",
            ...(payload.collapseKey && {
              "apns-collapse-id": payload.collapseKey,
            }),
          },
        },
        webpush: {
          notification: {
            title: payload.title,
            body: payload.body,
            icon: payload.imageUrl,
            badge: "/badge-icon.png",
          },
          fcmOptions: {
            link: payload.data?.actionUrl,
          },
        },
      };

      const messageId = await messaging.send(message);
      return { success: true, messageId };
    } catch (error) {
      console.error("Firebase send error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send push notification to multiple devices (max 500)
   */
  async sendMulticast(payload: MulticastPayload): Promise<SendResult> {
    try {
      const messaging = getApp().messaging();

      // FCM limit is 500 tokens per multicast
      if (payload.tokens.length > 500) {
        throw new Error("Multicast limited to 500 tokens");
      }

      const message: MulticastMessage = {
        tokens: payload.tokens,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data,
        android: {
          priority: this.mapPriority(payload.priority),
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
            },
          },
        },
      };

      const response = await messaging.sendEachForMulticast(message);

      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const token = payload.tokens[idx];
          if (token) {
            failedTokens.push(token);
          }
        }
      });

      return {
        success: response.failureCount === 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        failedTokens: failedTokens.length > 0 ? failedTokens : undefined,
      };
    } catch (error) {
      console.error("Firebase multicast error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send push notification to topic subscribers
   */
  async sendToTopic(payload: TopicPayload): Promise<SendResult> {
    try {
      const messaging = getApp().messaging();

      const message: TopicMessage = {
        topic: payload.topic,
        notification: {
          title: payload.title,
          body: payload.body,
          imageUrl: payload.imageUrl,
        },
        data: payload.data,
        android: {
          priority: this.mapPriority(payload.priority),
        },
      };

      const messageId = await messaging.send(message);
      return { success: true, messageId };
    } catch (error) {
      console.error("Firebase topic send error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Subscribe tokens to topic
   */
  async subscribeToTopic(tokens: string[], topic: string): Promise<SendResult> {
    try {
      const messaging = getApp().messaging();
      const response = await messaging.subscribeToTopic(tokens, topic);

      return {
        success: response.failureCount === 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (error) {
      console.error("Firebase subscribe error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Unsubscribe tokens from topic
   */
  async unsubscribeFromTopic(
    tokens: string[],
    topic: string
  ): Promise<SendResult> {
    try {
      const messaging = getApp().messaging();
      const response = await messaging.unsubscribeFromTopic(tokens, topic);

      return {
        success: response.failureCount === 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (error) {
      console.error("Firebase unsubscribe error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send silent data message (for background updates)
   */
  async sendDataOnly(
    token: string,
    data: Record<string, string>
  ): Promise<SendResult> {
    try {
      const messaging = getApp().messaging();

      const message: Message = {
        token,
        data,
        android: {
          priority: "high",
        },
        apns: {
          payload: {
            aps: {
              contentAvailable: true,
            },
          },
        },
      };

      const messageId = await messaging.send(message);
      return { success: true, messageId };
    } catch (error) {
      console.error("Firebase data message error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Map priority enum to FCM priority
   */
  private mapPriority(priority?: NotificationPriority): "high" | "normal" {
    if (
      priority === NotificationPriority.HIGH ||
      priority === NotificationPriority.URGENT
    ) {
      return "high";
    }
    return "normal";
  }
}

export const firebaseService = new FirebaseService();
