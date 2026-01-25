/**
 * Email Routes Tests
 *
 * Tests email sending, templates, and delivery.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Enums
enum NotificationType {
  ORDER_CONFIRMATION = "ORDER_CONFIRMATION",
  ORDER_STATUS = "ORDER_STATUS",
  DELIVERY_UPDATE = "DELIVERY_UPDATE",
  PAYMENT_SUCCESS = "PAYMENT_SUCCESS",
  PAYMENT_FAILED = "PAYMENT_FAILED",
  WELCOME = "WELCOME",
  PASSWORD_RESET = "PASSWORD_RESET",
  PROMOTIONAL = "PROMOTIONAL",
  ACCOUNT_UPDATE = "ACCOUNT_UPDATE",
}

// Schemas
const sendEmailSchema = z.object({
  userId: z.string().optional(),
  to: z.string().email(),
  subject: z.string().max(200),
  html: z.string().optional(),
  text: z.string().optional(),
  templateId: z.string().optional(),
  templateData: z.record(z.any()).optional(),
  from: z.string().email().optional(),
  replyTo: z.string().email().optional(),
  attachments: z
    .array(
      z.object({
        filename: z.string(),
        content: z.string(),
        contentType: z.string(),
      }),
    )
    .optional(),
});

const sendBatchEmailSchema = z.object({
  recipients: z
    .array(
      z.object({
        email: z.string().email(),
        templateData: z.record(z.any()).optional(),
      }),
    )
    .min(1)
    .max(1000),
  subject: z.string().max(200),
  templateId: z.string(),
  from: z.string().email().optional(),
});

const sendTransactionalSchema = z.object({
  userId: z.string(),
  type: z.nativeEnum(NotificationType),
  data: z.record(z.any()),
});

describe("Email Schema Validation", () => {
  describe("sendEmailSchema", () => {
    it("should validate valid email", () => {
      const result = sendEmailSchema.safeParse({
        to: "user@example.com",
        subject: "Order Confirmation",
        html: "<h1>Your order is confirmed!</h1>",
      });
      expect(result.success).toBe(true);
    });

    it("should validate with all fields", () => {
      const result = sendEmailSchema.safeParse({
        userId: "user_123",
        to: "user@example.com",
        subject: "Test Email",
        html: "<p>HTML content</p>",
        text: "Plain text content",
        templateId: "tmpl_welcome",
        templateData: { name: "John" },
        from: "support@ubi.com",
        replyTo: "help@ubi.com",
        attachments: [
          {
            filename: "receipt.pdf",
            content: "base64encodedcontent",
            contentType: "application/pdf",
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("should require valid email address", () => {
      const result = sendEmailSchema.safeParse({
        to: "not-an-email",
        subject: "Test",
      });
      expect(result.success).toBe(false);
    });

    it("should require subject", () => {
      const result = sendEmailSchema.safeParse({
        to: "user@example.com",
      });
      expect(result.success).toBe(false);
    });

    it("should reject subject over 200 chars", () => {
      const result = sendEmailSchema.safeParse({
        to: "user@example.com",
        subject: "A".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("should validate attachment structure", () => {
      const result = sendEmailSchema.safeParse({
        to: "user@example.com",
        subject: "Test",
        attachments: [
          { filename: "file.pdf" }, // Missing content and contentType
        ],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sendBatchEmailSchema", () => {
    it("should validate valid batch email", () => {
      const result = sendBatchEmailSchema.safeParse({
        recipients: [
          { email: "user1@example.com", templateData: { name: "User 1" } },
          { email: "user2@example.com", templateData: { name: "User 2" } },
        ],
        subject: "Newsletter",
        templateId: "tmpl_newsletter",
      });
      expect(result.success).toBe(true);
    });

    it("should require at least one recipient", () => {
      const result = sendBatchEmailSchema.safeParse({
        recipients: [],
        subject: "Test",
        templateId: "tmpl_test",
      });
      expect(result.success).toBe(false);
    });

    it("should reject more than 1000 recipients", () => {
      const recipients = new Array(1001).fill({ email: "user@example.com" });
      const result = sendBatchEmailSchema.safeParse({
        recipients,
        subject: "Test",
        templateId: "tmpl_test",
      });
      expect(result.success).toBe(false);
    });

    it("should require templateId", () => {
      const result = sendBatchEmailSchema.safeParse({
        recipients: [{ email: "user@example.com" }],
        subject: "Test",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("sendTransactionalSchema", () => {
    it("should validate valid transactional email", () => {
      const result = sendTransactionalSchema.safeParse({
        userId: "user_123",
        type: NotificationType.ORDER_CONFIRMATION,
        data: { orderId: "order_456", items: [] },
      });
      expect(result.success).toBe(true);
    });

    it("should validate all notification types", () => {
      Object.values(NotificationType).forEach((type) => {
        const result = sendTransactionalSchema.safeParse({
          userId: "user_123",
          type,
          data: {},
        });
        expect(result.success).toBe(true);
      });
    });

    it("should reject invalid notification type", () => {
      const result = sendTransactionalSchema.safeParse({
        userId: "user_123",
        type: "INVALID_TYPE",
        data: {},
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("Email Template Rendering", () => {
  function renderTemplate(
    template: string,
    variables: Record<string, any>,
  ): string {
    return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => {
      return variables[key] === undefined
        ? `{{${key}}}`
        : String(variables[key]);
    });
  }

  function renderHTMLTemplate(
    template: string,
    variables: Record<string, any>,
  ): string {
    let rendered = template;

    // Handle conditionals {{#if variable}}...{{/if}}
    rendered = rendered.replaceAll(
      /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, varName, content) => {
        return variables[varName] ? content : "";
      },
    );

    // Handle loops {{#each items}}...{{/each}}
    rendered = rendered.replaceAll(
      /\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_, arrayName, itemTemplate) => {
        const items = variables[arrayName];
        if (!Array.isArray(items)) return "";
        return items
          .map((item) => {
            return itemTemplate.replaceAll(
              /\{\{this\.(\w+)\}\}/g,
              (__, prop) => {
                return item[prop] === undefined ? "" : String(item[prop]);
              },
            );
          })
          .join("");
      },
    );

    // Handle simple variables
    rendered = renderTemplate(rendered, variables);

    return rendered;
  }

  it("should render simple variables", () => {
    const template = "Hello {{name}}, your order #{{orderId}} is confirmed!";
    const result = renderTemplate(template, { name: "John", orderId: "12345" });
    expect(result).toBe("Hello John, your order #12345 is confirmed!");
  });

  it("should preserve unmatched variables", () => {
    const template = "Hello {{name}}, {{unknownVar}}!";
    const result = renderTemplate(template, { name: "John" });
    expect(result).toBe("Hello John, {{unknownVar}}!");
  });

  it("should handle conditional blocks", () => {
    const template =
      "Order: {{orderId}}{{#if hasDiscount}} (Discount applied!){{/if}}";

    const withDiscount = renderHTMLTemplate(template, {
      orderId: "123",
      hasDiscount: true,
    });
    expect(withDiscount).toBe("Order: 123 (Discount applied!)");

    const withoutDiscount = renderHTMLTemplate(template, {
      orderId: "123",
      hasDiscount: false,
    });
    expect(withoutDiscount).toBe("Order: 123");
  });

  it("should handle loops", () => {
    const template =
      "<ul>{{#each items}}<li>{{this.name}} - {{this.price}}</li>{{/each}}</ul>";
    const result = renderHTMLTemplate(template, {
      items: [
        { name: "Pizza", price: "₦2,500" },
        { name: "Drink", price: "₦500" },
      ],
    });
    expect(result).toContain("<li>Pizza - ₦2,500</li>");
    expect(result).toContain("<li>Drink - ₦500</li>");
  });
});

describe("Email Validation", () => {
  function isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  function isDisposableEmail(email: string): boolean {
    const disposableDomains = [
      "tempmail.com",
      "throwaway.com",
      "mailinator.com",
      "guerrillamail.com",
      "10minutemail.com",
    ];
    const domain = email.split("@")[1]?.toLowerCase();
    return disposableDomains.includes(domain);
  }

  function sanitizeEmailContent(html: string): string {
    // Remove potentially dangerous content
    return html
      .replaceAll(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replaceAll(/on\w+="[^"]*"/gi, "")
      .replaceAll(/on\w+='[^']*'/gi, "")
      .replaceAll(/javascript:/gi, "");
  }

  it("should validate email format", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("user.name@sub.domain.com")).toBe(true);
    expect(isValidEmail("invalid")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
  });

  it("should detect disposable emails", () => {
    expect(isDisposableEmail("user@mailinator.com")).toBe(true);
    expect(isDisposableEmail("user@tempmail.com")).toBe(true);
    expect(isDisposableEmail("user@gmail.com")).toBe(false);
    expect(isDisposableEmail("user@company.com")).toBe(false);
  });

  it("should sanitize email content", () => {
    const malicious =
      '<p>Hello</p><script>alert("xss")</script><a onclick="evil()">Link</a>';
    const sanitized = sanitizeEmailContent(malicious);
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).toContain("<p>Hello</p>");
    expect(sanitized).toContain("<a");
  });
});

describe("Email Delivery Status", () => {
  enum DeliveryStatus {
    PENDING = "PENDING",
    SENT = "SENT",
    DELIVERED = "DELIVERED",
    OPENED = "OPENED",
    CLICKED = "CLICKED",
    BOUNCED = "BOUNCED",
    COMPLAINED = "COMPLAINED",
    UNSUBSCRIBED = "UNSUBSCRIBED",
  }

  interface EmailLog {
    id: string;
    status: DeliveryStatus;
    sentAt?: Date;
    deliveredAt?: Date;
    openedAt?: Date;
    clickedAt?: Date;
    bouncedAt?: Date;
    bounceReason?: string;
  }

  function getEmailMetrics(logs: EmailLog[]): {
    totalSent: number;
    deliveredRate: number;
    openRate: number;
    clickRate: number;
    bounceRate: number;
  } {
    const totalSent = logs.filter((l) =>
      [
        DeliveryStatus.SENT,
        DeliveryStatus.DELIVERED,
        DeliveryStatus.OPENED,
        DeliveryStatus.CLICKED,
      ].includes(l.status),
    ).length;

    const delivered = logs.filter((l) =>
      [
        DeliveryStatus.DELIVERED,
        DeliveryStatus.OPENED,
        DeliveryStatus.CLICKED,
      ].includes(l.status),
    ).length;

    const opened = logs.filter((l) =>
      [DeliveryStatus.OPENED, DeliveryStatus.CLICKED].includes(l.status),
    ).length;

    const clicked = logs.filter(
      (l) => l.status === DeliveryStatus.CLICKED,
    ).length;
    const bounced = logs.filter(
      (l) => l.status === DeliveryStatus.BOUNCED,
    ).length;

    return {
      totalSent,
      deliveredRate: totalSent > 0 ? (delivered / totalSent) * 100 : 0,
      openRate: delivered > 0 ? (opened / delivered) * 100 : 0,
      clickRate: opened > 0 ? (clicked / opened) * 100 : 0,
      bounceRate: totalSent > 0 ? (bounced / (totalSent + bounced)) * 100 : 0,
    };
  }

  it("should calculate email metrics", () => {
    const logs: EmailLog[] = [
      { id: "1", status: DeliveryStatus.CLICKED },
      { id: "2", status: DeliveryStatus.OPENED },
      { id: "3", status: DeliveryStatus.DELIVERED },
      { id: "4", status: DeliveryStatus.SENT },
      { id: "5", status: DeliveryStatus.BOUNCED },
    ];

    const metrics = getEmailMetrics(logs);
    expect(metrics.totalSent).toBe(4);
    expect(metrics.bounceRate).toBeGreaterThan(0);
  });
});

describe("Email Throttling", () => {
  interface ThrottleConfig {
    maxPerSecond: number;
    maxPerMinute: number;
    maxPerHour: number;
  }

  function calculateDelay(
    currentCount: number,
    config: ThrottleConfig,
    period: "second" | "minute" | "hour",
  ): number {
    let limit: number;
    let periodMs: number;

    switch (period) {
      case "second":
        limit = config.maxPerSecond;
        periodMs = 1000;
        break;
      case "minute":
        limit = config.maxPerMinute;
        periodMs = 60000;
        break;
      case "hour":
        limit = config.maxPerHour;
        periodMs = 3600000;
        break;
    }

    if (currentCount < limit) {
      return 0;
    }

    // Calculate delay to spread remaining emails
    return periodMs / limit;
  }

  const config: ThrottleConfig = {
    maxPerSecond: 10,
    maxPerMinute: 500,
    maxPerHour: 10000,
  };

  it("should return 0 delay when under limit", () => {
    expect(calculateDelay(5, config, "second")).toBe(0);
    expect(calculateDelay(100, config, "minute")).toBe(0);
  });

  it("should calculate delay when at limit", () => {
    expect(calculateDelay(10, config, "second")).toBe(100); // 1000ms / 10
    expect(calculateDelay(500, config, "minute")).toBe(120); // 60000ms / 500
  });
});

describe("Email Unsubscribe", () => {
  interface UnsubscribeToken {
    userId: string;
    email: string;
    categories: string[];
    expiresAt: Date;
  }

  function generateUnsubscribeLink(baseUrl: string, token: string): string {
    return `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
  }

  function parseUnsubscribeToken(tokenString: string): UnsubscribeToken | null {
    try {
      const decoded = Buffer.from(tokenString, "base64").toString("utf-8");
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }

  function createUnsubscribeToken(
    userId: string,
    email: string,
    categories: string[],
  ): string {
    const token: UnsubscribeToken = {
      userId,
      email,
      categories,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    };
    return Buffer.from(JSON.stringify(token)).toString("base64");
  }

  it("should generate unsubscribe link", () => {
    const link = generateUnsubscribeLink("https://api.ubi.com", "abc123");
    expect(link).toBe("https://api.ubi.com/unsubscribe?token=abc123");
  });

  it("should create and parse unsubscribe token", () => {
    const token = createUnsubscribeToken("user_123", "user@example.com", [
      "marketing",
    ]);
    const parsed = parseUnsubscribeToken(token);

    expect(parsed).not.toBeNull();
    expect(parsed?.userId).toBe("user_123");
    expect(parsed?.email).toBe("user@example.com");
    expect(parsed?.categories).toContain("marketing");
  });

  it("should return null for invalid token", () => {
    expect(parseUnsubscribeToken("invalid")).toBeNull();
  });
});
