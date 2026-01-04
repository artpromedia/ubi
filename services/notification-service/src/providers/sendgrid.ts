/**
 * SendGrid Email Provider
 */

import sgMail from "@sendgrid/mail";

// Initialize SendGrid
const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

// ============================================
// Types
// ============================================

export interface EmailPayload {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;
  templateData?: Record<string, any>;
  from?: string;
  replyTo?: string;
  attachments?: Array<{
    filename: string;
    content: string; // Base64
    contentType: string;
  }>;
  categories?: string[];
  customArgs?: Record<string, string>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface BatchEmailPayload {
  recipients: Array<{
    email: string;
    templateData?: Record<string, any>;
  }>;
  subject: string;
  templateId: string;
  from?: string;
}

export interface BatchEmailResult {
  success: boolean;
  total: number;
  successCount: number;
  failureCount: number;
}

// ============================================
// Service
// ============================================

class EmailService {
  private defaultFrom: string;
  private defaultFromName: string;

  constructor() {
    this.defaultFrom = process.env.SENDGRID_FROM_EMAIL || "noreply@ubi.africa";
    this.defaultFromName = process.env.SENDGRID_FROM_NAME || "UBI";
  }

  isConfigured(): boolean {
    return !!process.env.SENDGRID_API_KEY;
  }

  /**
   * Send single email
   */
  async send(payload: EmailPayload): Promise<EmailResult> {
    if (!this.isConfigured()) {
      console.warn("SendGrid not configured");
      return { success: false, error: "Email service not configured" };
    }

    try {
      const msg: Partial<sgMail.MailDataRequired> & {
        to: string;
        from: { email: string; name: string };
        subject: string;
      } = {
        to: payload.to,
        from: {
          email: payload.from || this.defaultFrom,
          name: this.defaultFromName,
        },
        subject: payload.subject,
        ...(payload.replyTo && { replyTo: payload.replyTo }),
        ...(payload.categories && { categories: payload.categories }),
        ...(payload.customArgs && { customArgs: payload.customArgs }),
      };

      // Use template or content
      if (payload.templateId) {
        msg.templateId = payload.templateId;
        if (payload.templateData) {
          msg.dynamicTemplateData = payload.templateData;
        }
      } else {
        msg.html = payload.html;
        msg.text = payload.text || this.stripHtml(payload.html || "");
      }

      // Attachments
      if (payload.attachments && payload.attachments.length > 0) {
        msg.attachments = payload.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          type: a.contentType,
          disposition: "attachment",
        }));
      }

      const [response] = await sgMail.send(msg as sgMail.MailDataRequired);

      return {
        success: response.statusCode >= 200 && response.statusCode < 300,
        messageId: response.headers["x-message-id"] as string,
      };
    } catch (error) {
      console.error("SendGrid error:", error);

      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      // Extract SendGrid error details
      if (typeof error === "object" && error !== null && "response" in error) {
        const sgError = error as {
          response?: { body?: { errors?: Array<{ message: string }> } };
        };
        if (sgError.response?.body?.errors?.[0]?.message) {
          errorMessage = sgError.response.body.errors[0].message;
        }
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send batch emails with personalization
   */
  async sendBatch(payload: BatchEmailPayload): Promise<BatchEmailResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        total: 0,
        successCount: 0,
        failureCount: payload.recipients.length,
      };
    }

    try {
      // SendGrid supports up to 1000 personalizations
      const batchSize = 1000;
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < payload.recipients.length; i += batchSize) {
        const batch = payload.recipients.slice(i, i + batchSize);

        const msg: sgMail.MailDataRequired = {
          from: {
            email: payload.from || this.defaultFrom,
            name: this.defaultFromName,
          },
          subject: payload.subject,
          templateId: payload.templateId,
          personalizations: batch.map((r) => ({
            to: r.email,
            dynamicTemplateData: r.templateData,
          })),
        };

        try {
          await sgMail.send(msg);
          successCount += batch.length;
        } catch {
          failureCount += batch.length;
        }
      }

      return {
        success: failureCount === 0,
        total: payload.recipients.length,
        successCount,
        failureCount,
      };
    } catch (error) {
      console.error("SendGrid batch error:", error);
      return {
        success: false,
        total: payload.recipients.length,
        successCount: 0,
        failureCount: payload.recipients.length,
      };
    }
  }

  /**
   * Send transactional email with template
   */
  async sendTransactional(
    templateId: string,
    to: string,
    data: Record<string, any>
  ): Promise<EmailResult> {
    return this.send({
      to,
      subject: "", // Subject from template
      templateId,
      templateData: data,
    });
  }

  /**
   * Send verification email
   */
  async sendVerification(
    to: string,
    code: string,
    name: string
  ): Promise<EmailResult> {
    const templateId = process.env.SENDGRID_VERIFICATION_TEMPLATE_ID;

    if (templateId) {
      return this.send({
        to,
        subject: "Verify your UBI account",
        templateId,
        templateData: { code, name },
      });
    }

    // Fallback to plain HTML
    return this.send({
      to,
      subject: "Verify your UBI account",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a2e;">Verify your email</h1>
          <p>Hi ${name},</p>
          <p>Your verification code is:</p>
          <div style="background: #f0f0f0; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px;">
            ${code}
          </div>
          <p>This code expires in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <p>— The UBI Team</p>
        </div>
      `,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(
    to: string,
    resetLink: string,
    name: string
  ): Promise<EmailResult> {
    const templateId = process.env.SENDGRID_PASSWORD_RESET_TEMPLATE_ID;

    if (templateId) {
      return this.send({
        to,
        subject: "Reset your UBI password",
        templateId,
        templateData: { resetLink, name },
      });
    }

    return this.send({
      to,
      subject: "Reset your UBI password",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a2e;">Reset your password</h1>
          <p>Hi ${name},</p>
          <p>Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background: #1a1a2e; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px;">
              Reset Password
            </a>
          </div>
          <p>This link expires in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <p>— The UBI Team</p>
        </div>
      `,
    });
  }

  /**
   * Send receipt email
   */
  async sendReceipt(
    to: string,
    data: {
      name: string;
      orderId: string;
      orderType: string;
      items?: Array<{ name: string; quantity: number; price: number }>;
      subtotal: number;
      tax: number;
      total: number;
      currency: string;
      date: string;
    }
  ): Promise<EmailResult> {
    const templateId = process.env.SENDGRID_RECEIPT_TEMPLATE_ID;

    if (templateId) {
      return this.send({
        to,
        subject: `Your UBI ${data.orderType} receipt - ${data.orderId}`,
        templateId,
        templateData: data,
        categories: ["receipt", data.orderType],
      });
    }

    const itemsHtml = data.items
      ? data.items
          .map(
            (item) => `
            <tr>
              <td style="padding: 10px; border-bottom: 1px solid #eee;">${item.name}</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
              <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">${data.currency} ${item.price.toFixed(2)}</td>
            </tr>
          `
          )
          .join("")
      : "";

    return this.send({
      to,
      subject: `Your UBI ${data.orderType} receipt - ${data.orderId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a2e;">Receipt</h1>
          <p>Hi ${data.name},</p>
          <p>Thank you for using UBI! Here's your receipt:</p>
          
          <div style="background: #f9f9f9; padding: 20px; margin: 20px 0;">
            <p><strong>Order ID:</strong> ${data.orderId}</p>
            <p><strong>Date:</strong> ${data.date}</p>
            <p><strong>Type:</strong> ${data.orderType}</p>
          </div>
          
          ${
            data.items
              ? `
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #f0f0f0;">
                  <th style="padding: 10px; text-align: left;">Item</th>
                  <th style="padding: 10px; text-align: center;">Qty</th>
                  <th style="padding: 10px; text-align: right;">Price</th>
                </tr>
              </thead>
              <tbody>
                ${itemsHtml}
              </tbody>
            </table>
          `
              : ""
          }
          
          <div style="margin-top: 20px; text-align: right;">
            <p>Subtotal: ${data.currency} ${data.subtotal.toFixed(2)}</p>
            <p>Tax: ${data.currency} ${data.tax.toFixed(2)}</p>
            <p style="font-size: 18px; font-weight: bold;">Total: ${data.currency} ${data.total.toFixed(2)}</p>
          </div>
          
          <p style="margin-top: 30px;">— The UBI Team</p>
        </div>
      `,
      categories: ["receipt", data.orderType],
    });
  }

  /**
   * Strip HTML tags for plain text version
   */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}

export const emailService = new EmailService();
