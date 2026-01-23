/**
 * Notification Service Client
 *
 * HTTP client for communicating with the notification-service
 * to send SMS, email, and push notifications.
 */

import { authLogger } from "./logger.js";

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || "http://localhost:4006";
const SERVICE_API_KEY = process.env.SERVICE_API_KEY || "";

interface SendSMSParams {
  userId?: string;
  phone: string;
  message: string;
}

interface SendOTPParams {
  userId?: string;
  phone: string;
  purpose: "login" | "verification" | "password_reset" | "transaction";
  length?: number;
  expiresInMinutes?: number;
}

interface SendEmailParams {
  userId?: string;
  email: string;
  subject: string;
  body: string;
  templateId?: string;
  templateData?: Record<string, unknown>;
}

interface NotificationResponse {
  success: boolean;
  data?: {
    messageId?: string;
    otp?: string; // Only returned in development mode
  };
  error?: {
    code: string;
    message: string;
  };
}

class NotificationClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = NOTIFICATION_SERVICE_URL;
    this.apiKey = SERVICE_API_KEY;
  }

  private async request<T>(endpoint: string, data: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
          "X-Service-Name": "user-service",
        },
        body: JSON.stringify(data),
      });

      const result = (await response.json()) as { error?: { message: string } };

      if (!response.ok) {
        authLogger.error(
          { url, status: response.status, error: result },
          "Notification service request failed",
        );
        throw new Error(result.error?.message || "Notification service error");
      }

      return result as T;
    } catch (error) {
      authLogger.error(
        { url, error },
        "Failed to connect to notification service",
      );
      throw error;
    }
  }

  /**
   * Send an SMS message
   */
  async sendSMS(params: SendSMSParams): Promise<NotificationResponse> {
    return this.request<NotificationResponse>("/sms/send", params);
  }

  /**
   * Send an OTP via SMS
   * Returns the OTP in development mode for testing
   */
  async sendOTP(params: SendOTPParams): Promise<NotificationResponse> {
    return this.request<NotificationResponse>("/sms/otp", {
      ...params,
      length: params.length || 6,
      expiresInMinutes: params.expiresInMinutes || 5,
    });
  }

  /**
   * Verify an OTP
   */
  async verifyOTP(
    phone: string,
    code: string,
    purpose: SendOTPParams["purpose"],
  ): Promise<{ success: boolean; valid: boolean }> {
    return this.request("/sms/otp/verify", { phone, code, purpose });
  }

  /**
   * Send an email
   */
  async sendEmail(params: SendEmailParams): Promise<NotificationResponse> {
    return this.request<NotificationResponse>("/email/send", params);
  }

  /**
   * Send a templated email
   */
  async sendTemplatedEmail(
    templateId: string,
    params: Omit<SendEmailParams, "subject" | "body" | "templateId"> & {
      templateData: Record<string, unknown>;
    },
  ): Promise<NotificationResponse> {
    return this.request<NotificationResponse>("/email/template", {
      ...params,
      templateId,
    });
  }
}

// Singleton instance
export const notificationClient = new NotificationClient();

/**
 * Fallback OTP sender for when notification service is unavailable
 * Stores OTP in Redis and logs it in development
 */
export async function sendOTPFallback(
  phone: string,
  otp: string,
  redis: {
    setex: (key: string, ttl: number, value: string) => Promise<unknown>;
  },
): Promise<void> {
  // Store OTP in Redis with 5 minute expiry
  await redis.setex(`otp:${phone}`, 300, otp);

  // In development, log the OTP
  if (process.env.NODE_ENV === "development") {
    authLogger.warn(
      { phone, otp },
      "[FALLBACK] OTP stored locally - notification service unavailable",
    );
  }
}
