/**
 * Notification Service Client
 *
 * HTTP client for communicating with the notification-service
 * to send SMS, email, and push notifications using the per-surface
 * X-Service-Key (`NOTIFICATION_SERVICE_KEY`).
 */

import { authLogger } from "./logger.js";

export const MIN_NOTIFICATION_SERVICE_KEY_LENGTH = 32;
export const NOTIFICATION_CALLER_NAME = "user-service";

export interface NotificationClientOptions {
  baseUrl?: string;
  serviceKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Refuses to start user-service in production without a >= 32-character
 * `NOTIFICATION_SERVICE_KEY`.
 */
export function assertNotificationClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  const key = env.NOTIFICATION_SERVICE_KEY;
  if (
    key === undefined ||
    key.trim().length < MIN_NOTIFICATION_SERVICE_KEY_LENGTH
  ) {
    throw new Error(
      `NOTIFICATION_SERVICE_KEY is required in production (at least ${MIN_NOTIFICATION_SERVICE_KEY_LENGTH} characters)`,
    );
  }
}

export interface SendSMSParams {
  userId?: string;
  phone: string;
  message: string;
}

export interface SendOTPParams {
  userId?: string;
  phone: string;
  purpose: "login" | "verification" | "password_reset" | "transaction";
  length?: number;
  expiresInMinutes?: number;
}

export interface SendEmailParams {
  userId?: string;
  email: string;
  subject: string;
  body: string;
  templateId?: string;
  templateData?: Record<string, unknown>;
}

export interface NotificationResponse {
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

export class NotificationClient {
  private readonly configuredBaseUrl: string | undefined;
  private readonly configuredServiceKey: string | undefined;
  private readonly configuredFetchImpl: typeof fetch | undefined;

  constructor(options: NotificationClientOptions = {}) {
    this.configuredBaseUrl = options.baseUrl;
    this.configuredServiceKey = options.serviceKey;
    this.configuredFetchImpl = options.fetchImpl;
  }

  private resolveBaseUrl(): string {
    return (
      this.configuredBaseUrl ??
      process.env.NOTIFICATION_SERVICE_URL ??
      "http://localhost:4006"
    ).replace(/\/+$/, "");
  }

  private resolveServiceKey(): string {
    return (
      this.configuredServiceKey ?? process.env.NOTIFICATION_SERVICE_KEY ?? ""
    );
  }

  private async request<T>(endpoint: string, data: unknown): Promise<T> {
    const url = `${this.resolveBaseUrl()}/api/v1${endpoint}`;
    const serviceKey = this.resolveServiceKey();
    const fetchFn = this.configuredFetchImpl ?? globalThis.fetch;

    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(serviceKey.length > 0 && { "X-Service-Key": serviceKey }),
          "X-Service-Name": NOTIFICATION_CALLER_NAME,
        },
        body: JSON.stringify(data),
      });

      const result = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: { message?: string };
      };

      if (!response.ok) {
        authLogger.error(
          { endpoint, status: response.status },
          "Notification service request failed",
        );
        throw new Error(
          result.error?.message ??
            result.message ??
            `Notification service error (${response.status})`,
        );
      }

      return result as T;
    } catch (error) {
      authLogger.error(
        {
          endpoint,
          err: error instanceof Error ? error.message : "request_failed",
        },
        "Failed to deliver notification request",
      );
      throw error;
    }
  }

  /**
   * Send an SMS message
   */
  async sendSMS(params: SendSMSParams): Promise<NotificationResponse> {
    const result = await this.request<NotificationResponse>(
      "/sms/send",
      params,
    );
    return result;
  }

  /**
   * Send an OTP via SMS
   */
  async sendOTP(params: SendOTPParams): Promise<NotificationResponse> {
    const result = await this.request<NotificationResponse>("/sms/otp", {
      ...params,
      length: params.length || 6,
      expiresInMinutes: params.expiresInMinutes || 5,
    });
    return result;
  }

  /**
   * Verify an OTP
   */
  async verifyOTP(
    phone: string,
    code: string,
    purpose: SendOTPParams["purpose"],
  ): Promise<{ success: boolean; valid: boolean }> {
    const result = await this.request<{ success: boolean; valid: boolean }>(
      "/sms/otp/verify",
      { phone, code, purpose },
    );
    return result;
  }

  /**
   * Send an email
   */
  async sendEmail(params: SendEmailParams): Promise<NotificationResponse> {
    const result = await this.request<NotificationResponse>(
      "/email/send",
      params,
    );
    return result;
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
    const result = await this.request<NotificationResponse>("/email/template", {
      ...params,
      templateId,
    });
    return result;
  }
}

// Singleton instance
export const notificationClient = new NotificationClient();
