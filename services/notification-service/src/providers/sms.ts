/**
 * SMS Providers - Africa's Talking + Twilio Fallback
 */

import Twilio from "twilio";

// ============================================
// Types
// ============================================

export interface SMSPayload {
  to: string;
  message: string;
  senderId?: string;
}

export interface SMSResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
}

export interface BatchSMSPayload {
  recipients: Array<{ phone: string; message?: string }>;
  defaultMessage: string;
  senderId?: string;
}

export interface BatchSMSResult {
  success: boolean;
  total: number;
  successCount: number;
  failureCount: number;
  results: Array<{
    phone: string;
    success: boolean;
    messageId?: string;
    error?: string;
  }>;
}

// ============================================
// Africa's Talking Client
// ============================================

class AfricasTalkingClient {
  private apiKey: string;
  private username: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = process.env.AFRICASTALKING_API_KEY || "";
    this.username = process.env.AFRICASTALKING_USERNAME || "";
    this.baseUrl =
      process.env.AFRICASTALKING_ENV === "production"
        ? "https://api.africastalking.com/version1/messaging"
        : "https://api.sandbox.africastalking.com/version1/messaging";
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.username;
  }

  async send(payload: SMSPayload): Promise<SMSResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "Africa's Talking not configured" };
    }

    try {
      const formData = new URLSearchParams();
      formData.append("username", this.username);
      formData.append("to", payload.to);
      formData.append("message", payload.message);

      if (payload.senderId) {
        formData.append("from", payload.senderId);
      }

      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          apiKey: this.apiKey,
        },
        body: formData.toString(),
      });

      const data = (await response.json()) as {
        SMSMessageData?: {
          Recipients?: Array<{
            status: string;
            messageId?: string;
          }>;
        };
      };

      if (data.SMSMessageData?.Recipients?.[0]?.status === "Success") {
        return {
          success: true,
          messageId: data.SMSMessageData.Recipients[0].messageId,
          provider: "africas_talking",
        };
      }

      return {
        success: false,
        provider: "africas_talking",
        error: data.SMSMessageData?.Recipients?.[0]?.status || "Unknown error",
      };
    } catch (error) {
      console.error("Africa's Talking error:", error);
      return {
        success: false,
        provider: "africas_talking",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async sendBulk(payload: BatchSMSPayload): Promise<BatchSMSResult> {
    const results: BatchSMSResult["results"] = [];

    // Africa's Talking supports comma-separated numbers for same message
    // For different messages, we need to send individually
    const sameMessage = payload.recipients.every((r) => !r.message);

    if (sameMessage) {
      // Bulk send with same message
      const phones = payload.recipients.map((r) => r.phone).join(",");
      const result = await this.send({
        to: phones,
        message: payload.defaultMessage,
        senderId: payload.senderId,
      });

      // Mark all as success/failure based on bulk result
      payload.recipients.forEach((r) => {
        results.push({
          phone: r.phone,
          success: result.success,
          messageId: result.messageId,
          error: result.error,
        });
      });
    } else {
      // Send individually for different messages
      for (const recipient of payload.recipients) {
        const result = await this.send({
          to: recipient.phone,
          message: recipient.message || payload.defaultMessage,
          senderId: payload.senderId,
        });
        results.push({
          phone: recipient.phone,
          success: result.success,
          messageId: result.messageId,
          error: result.error,
        });
      }
    }

    return {
      success: results.every((r) => r.success),
      total: results.length,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
      results,
    };
  }
}

// ============================================
// Twilio Client
// ============================================

class TwilioClient {
  private client: ReturnType<typeof Twilio> | null = null;
  private fromNumber: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.fromNumber = process.env.TWILIO_FROM_NUMBER || "";

    if (accountSid && authToken) {
      this.client = Twilio(accountSid, authToken);
    }
  }

  isConfigured(): boolean {
    return !!this.client && !!this.fromNumber;
  }

  async send(payload: SMSPayload): Promise<SMSResult> {
    if (!this.isConfigured() || !this.client) {
      return { success: false, error: "Twilio not configured" };
    }

    try {
      const message = await this.client.messages.create({
        to: payload.to,
        from: payload.senderId || this.fromNumber,
        body: payload.message,
      });

      return {
        success: true,
        messageId: message.sid,
        provider: "twilio",
      };
    } catch (error) {
      console.error("Twilio error:", error);
      return {
        success: false,
        provider: "twilio",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async sendBulk(payload: BatchSMSPayload): Promise<BatchSMSResult> {
    const results: BatchSMSResult["results"] = [];

    for (const recipient of payload.recipients) {
      const result = await this.send({
        to: recipient.phone,
        message: recipient.message || payload.defaultMessage,
        senderId: payload.senderId,
      });
      results.push({
        phone: recipient.phone,
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      });
    }

    return {
      success: results.every((r) => r.success),
      total: results.length,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
      results,
    };
  }
}

// ============================================
// SMS Service (with fallback)
// ============================================

class SMSService {
  private africasTalking: AfricasTalkingClient;
  private twilio: TwilioClient;

  constructor() {
    this.africasTalking = new AfricasTalkingClient();
    this.twilio = new TwilioClient();
  }

  /**
   * Get best provider for phone number
   */
  private getProviderForNumber(phone: string): "africas_talking" | "twilio" {
    // African country codes that work better with Africa's Talking
    const africanCodes = [
      "+234", // Nigeria
      "+254", // Kenya
      "+233", // Ghana
      "+256", // Uganda
      "+255", // Tanzania
      "+27", // South Africa
      "+221", // Senegal
      "+225", // Ivory Coast
      "+237", // Cameroon
      "+250", // Rwanda
      "+260", // Zambia
      "+263", // Zimbabwe
      "+212", // Morocco
      "+20", // Egypt
    ];

    const isAfrican = africanCodes.some((code) => phone.startsWith(code));

    if (isAfrican && this.africasTalking.isConfigured()) {
      return "africas_talking";
    }

    if (this.twilio.isConfigured()) {
      return "twilio";
    }

    if (this.africasTalking.isConfigured()) {
      return "africas_talking";
    }

    return "twilio"; // Will fail with not configured error
  }

  /**
   * Send SMS with automatic provider selection and fallback
   */
  async send(payload: SMSPayload): Promise<SMSResult> {
    const primaryProvider = this.getProviderForNumber(payload.to);

    // Try primary provider
    let result: SMSResult;
    if (primaryProvider === "africas_talking") {
      result = await this.africasTalking.send(payload);
    } else {
      result = await this.twilio.send(payload);
    }

    // Fallback on failure
    if (!result.success) {
      console.log(
        `Primary SMS provider failed (${primaryProvider}), trying fallback...`
      );

      if (primaryProvider === "africas_talking" && this.twilio.isConfigured()) {
        result = await this.twilio.send(payload);
      } else if (
        primaryProvider === "twilio" &&
        this.africasTalking.isConfigured()
      ) {
        result = await this.africasTalking.send(payload);
      }
    }

    return result;
  }

  /**
   * Send batch SMS
   */
  async sendBatch(payload: BatchSMSPayload): Promise<BatchSMSResult> {
    // Group by provider
    const africanRecipients: typeof payload.recipients = [];
    const otherRecipients: typeof payload.recipients = [];

    for (const recipient of payload.recipients) {
      const provider = this.getProviderForNumber(recipient.phone);
      if (provider === "africas_talking") {
        africanRecipients.push(recipient);
      } else {
        otherRecipients.push(recipient);
      }
    }

    const allResults: BatchSMSResult["results"] = [];

    // Send to African recipients via Africa's Talking
    if (africanRecipients.length > 0 && this.africasTalking.isConfigured()) {
      const result = await this.africasTalking.sendBulk({
        recipients: africanRecipients,
        defaultMessage: payload.defaultMessage,
        senderId: payload.senderId,
      });
      allResults.push(...result.results);
    }

    // Send to other recipients via Twilio
    if (otherRecipients.length > 0 && this.twilio.isConfigured()) {
      const result = await this.twilio.sendBulk({
        recipients: otherRecipients,
        defaultMessage: payload.defaultMessage,
        senderId: payload.senderId,
      });
      allResults.push(...result.results);
    }

    return {
      success: allResults.every((r) => r.success),
      total: allResults.length,
      successCount: allResults.filter((r) => r.success).length,
      failureCount: allResults.filter((r) => !r.success).length,
      results: allResults,
    };
  }

  /**
   * Get message status (Twilio only)
   */
  async getStatus(
    messageId: string
  ): Promise<{ status: string; error?: string }> {
    if (!this.twilio.isConfigured()) {
      return { status: "unknown", error: "Status check not available" };
    }

    try {
      const accountSid = process.env.TWILIO_ACCOUNT_SID!;
      const authToken = process.env.TWILIO_AUTH_TOKEN!;
      const client = Twilio(accountSid, authToken);

      const message = await client.messages(messageId).fetch();
      return { status: message.status };
    } catch (error) {
      return {
        status: "unknown",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}

export const smsService = new SMSService();
