/**
 * Notification Templates Tests
 *
 * Tests template creation, rendering, and variable validation.
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
  DRIVER_ASSIGNED = "DRIVER_ASSIGNED",
  RIDE_REQUEST = "RIDE_REQUEST",
  RIDE_COMPLETE = "RIDE_COMPLETE",
}

enum NotificationChannel {
  SMS = "SMS",
  EMAIL = "EMAIL",
  PUSH = "PUSH",
  IN_APP = "IN_APP",
  WHATSAPP = "WHATSAPP",
}

// Schemas
const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.nativeEnum(NotificationType),
  channel: z.nativeEnum(NotificationChannel),
  title: z.string().max(200),
  body: z.string().max(2000),
  htmlBody: z.string().max(50000).optional(),
  variables: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  title: z.string().max(200).optional(),
  body: z.string().max(2000).optional(),
  htmlBody: z.string().max(50000).optional(),
  variables: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
  isActive: z.boolean().optional(),
});

const listTemplatesSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  channel: z.nativeEnum(NotificationChannel).optional(),
  type: z.nativeEnum(NotificationType).optional(),
  activeOnly: z
    .string()
    .transform((v) => v === "true")
    .default("true"),
});

const previewTemplateSchema = z.object({
  variables: z.record(z.any()),
});

describe("Template Schema Validation", () => {
  describe("createTemplateSchema", () => {
    const validTemplate = {
      name: "Order Confirmation Email",
      type: NotificationType.ORDER_CONFIRMATION,
      channel: NotificationChannel.EMAIL,
      title: "Your order #{{orderId}} is confirmed!",
      body: "Hi {{customerName}}, your order has been confirmed.",
      htmlBody: "<h1>Order Confirmed</h1><p>Hi {{customerName}}!</p>",
      variables: ["orderId", "customerName", "orderTotal"],
      metadata: { category: "transactional" },
    };

    it("should validate valid template", () => {
      const result = createTemplateSchema.safeParse(validTemplate);
      expect(result.success).toBe(true);
    });

    it("should require name", () => {
      const { name, ...template } = validTemplate;
      const result = createTemplateSchema.safeParse(template);
      expect(result.success).toBe(false);
    });

    it("should reject name too long", () => {
      const result = createTemplateSchema.safeParse({
        ...validTemplate,
        name: "A".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("should require type", () => {
      const { type, ...template } = validTemplate;
      const result = createTemplateSchema.safeParse(template);
      expect(result.success).toBe(false);
    });

    it("should validate all notification types", () => {
      Object.values(NotificationType).forEach((type) => {
        const result = createTemplateSchema.safeParse({
          ...validTemplate,
          type,
        });
        expect(result.success).toBe(true);
      });
    });

    it("should validate all channels", () => {
      Object.values(NotificationChannel).forEach((channel) => {
        const result = createTemplateSchema.safeParse({
          ...validTemplate,
          channel,
        });
        expect(result.success).toBe(true);
      });
    });

    it("should reject title too long", () => {
      const result = createTemplateSchema.safeParse({
        ...validTemplate,
        title: "A".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("should reject body too long", () => {
      const result = createTemplateSchema.safeParse({
        ...validTemplate,
        body: "A".repeat(2001),
      });
      expect(result.success).toBe(false);
    });

    it("should reject htmlBody too long", () => {
      const result = createTemplateSchema.safeParse({
        ...validTemplate,
        htmlBody: "A".repeat(50001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateTemplateSchema", () => {
    it("should allow partial updates", () => {
      const result = updateTemplateSchema.safeParse({
        title: "Updated Title",
      });
      expect(result.success).toBe(true);
    });

    it("should allow updating isActive", () => {
      const result = updateTemplateSchema.safeParse({
        isActive: false,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("listTemplatesSchema", () => {
    it("should apply default values", () => {
      const result = listTemplatesSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
        expect(result.data.activeOnly).toBe(true);
      }
    });

    it("should coerce string to number", () => {
      const result = listTemplatesSchema.safeParse({
        page: "2",
        limit: "50",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(50);
      }
    });

    it("should reject limit over 100", () => {
      const result = listTemplatesSchema.safeParse({
        limit: "200",
      });
      expect(result.success).toBe(false);
    });

    it("should filter by channel", () => {
      const result = listTemplatesSchema.safeParse({
        channel: NotificationChannel.SMS,
      });
      expect(result.success).toBe(true);
    });
  });
});

describe("Template Variable Extraction", () => {
  function extractVariables(template: string): string[] {
    const regex = /\{\{(\w+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = regex.exec(template)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }

  function validateVariables(
    template: string,
    providedVariables: Record<string, any>,
  ): { valid: boolean; missing: string[] } {
    const required = extractVariables(template);
    const missing = required.filter((v) => providedVariables[v] === undefined);

    return {
      valid: missing.length === 0,
      missing,
    };
  }

  it("should extract simple variables", () => {
    const template = "Hello {{name}}, your order {{orderId}} is ready.";
    const variables = extractVariables(template);
    expect(variables).toContain("name");
    expect(variables).toContain("orderId");
    expect(variables.length).toBe(2);
  });

  it("should not duplicate variables", () => {
    const template = "Hi {{name}}, {{name}} again, and {{name}} once more.";
    const variables = extractVariables(template);
    expect(variables).toEqual(["name"]);
  });

  it("should handle no variables", () => {
    const template = "This is a static message.";
    const variables = extractVariables(template);
    expect(variables).toEqual([]);
  });

  it("should validate all required variables are provided", () => {
    const template = "Hi {{name}}, order {{orderId}} total: {{total}}";

    const valid = validateVariables(template, {
      name: "John",
      orderId: "123",
      total: "₦5,000",
    });
    expect(valid.valid).toBe(true);
    expect(valid.missing).toEqual([]);

    const invalid = validateVariables(template, {
      name: "John",
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.missing).toContain("orderId");
    expect(invalid.missing).toContain("total");
  });
});

describe("Template Rendering", () => {
  interface TemplateEngine {
    render(template: string, variables: Record<string, any>): string;
  }

  const templateEngine: TemplateEngine = {
    render(template: string, variables: Record<string, any>): string {
      return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => {
        const value = variables[key];
        if (value === undefined) return `{{${key}}}`;
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
      });
    },
  };

  it("should render simple variables", () => {
    const result = templateEngine.render("Hello {{name}}!", { name: "John" });
    expect(result).toBe("Hello John!");
  });

  it("should handle numeric values", () => {
    const result = templateEngine.render("Total: {{amount}}", { amount: 1000 });
    expect(result).toBe("Total: 1000");
  });

  it("should handle boolean values", () => {
    const result = templateEngine.render("Active: {{isActive}}", {
      isActive: true,
    });
    expect(result).toBe("Active: true");
  });

  it("should stringify object values", () => {
    const result = templateEngine.render("Data: {{data}}", {
      data: { key: "value" },
    });
    expect(result).toBe('Data: {"key":"value"}');
  });

  it("should preserve missing variables", () => {
    const result = templateEngine.render("Hi {{name}}, {{unknown}}", {
      name: "John",
    });
    expect(result).toBe("Hi John, {{unknown}}");
  });
});

describe("Template Localization", () => {
  interface LocalizedTemplate {
    id: string;
    type: NotificationType;
    channel: NotificationChannel;
    translations: Record<
      string,
      {
        title: string;
        body: string;
      }
    >;
  }

  function getLocalizedTemplate(
    template: LocalizedTemplate,
    locale: string,
    fallbackLocale: string = "en",
  ): { title: string; body: string } {
    return (
      template.translations[locale] || template.translations[fallbackLocale]
    );
  }

  const orderConfirmationTemplate: LocalizedTemplate = {
    id: "tmpl_order_confirm",
    type: NotificationType.ORDER_CONFIRMATION,
    channel: NotificationChannel.SMS,
    translations: {
      en: {
        title: "Order Confirmed",
        body: "Hi {{name}}, your order #{{orderId}} is confirmed!",
      },
      fr: {
        title: "Commande confirmée",
        body: "Bonjour {{name}}, votre commande #{{orderId}} est confirmée!",
      },
      yo: {
        title: "A ti jẹrisi Order",
        body: "Bawo {{name}}, a ti jẹrisi order #{{orderId}} rẹ!",
      },
    },
  };

  it("should return requested locale", () => {
    const result = getLocalizedTemplate(orderConfirmationTemplate, "fr");
    expect(result.title).toBe("Commande confirmée");
  });

  it("should fallback to default locale", () => {
    const result = getLocalizedTemplate(orderConfirmationTemplate, "de");
    expect(result.title).toBe("Order Confirmed");
  });

  it("should support Nigerian languages", () => {
    const result = getLocalizedTemplate(orderConfirmationTemplate, "yo");
    expect(result.title).toContain("Order");
  });
});

describe("Template Testing", () => {
  interface TemplateTestCase {
    name: string;
    variables: Record<string, any>;
    expected: {
      title: string;
      body: string;
    };
  }

  function runTemplateTests(
    template: { title: string; body: string },
    testCases: TemplateTestCase[],
    renderer: (template: string, variables: Record<string, any>) => string,
  ): { name: string; passed: boolean; error?: string }[] {
    return testCases.map((testCase) => {
      const renderedTitle = renderer(template.title, testCase.variables);
      const renderedBody = renderer(template.body, testCase.variables);

      const titleMatch = renderedTitle === testCase.expected.title;
      const bodyMatch = renderedBody === testCase.expected.body;

      let error: string | undefined;
      if (!titleMatch) {
        error = `Title mismatch: expected "${testCase.expected.title}", got "${renderedTitle}"`;
      } else if (!bodyMatch) {
        error = `Body mismatch: expected "${testCase.expected.body}", got "${renderedBody}"`;
      }

      return {
        name: testCase.name,
        passed: titleMatch && bodyMatch,
        error,
      };
    });
  }

  it("should run template test cases", () => {
    const template = {
      title: "Order {{orderId}}",
      body: "Hi {{name}}, total: {{total}}",
    };

    const testCases: TemplateTestCase[] = [
      {
        name: "Basic order",
        variables: { orderId: "123", name: "John", total: "₦1,000" },
        expected: { title: "Order 123", body: "Hi John, total: ₦1,000" },
      },
    ];

    const renderer = (t: string, v: Record<string, any>) =>
      t.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => v[key] ?? `{{${key}}}`);

    const results = runTemplateTests(template, testCases, renderer);
    expect(results[0].passed).toBe(true);
  });
});

describe("Template Versioning", () => {
  interface TemplateVersion {
    version: number;
    title: string;
    body: string;
    createdAt: Date;
    createdBy: string;
    isActive: boolean;
  }

  function getActiveVersion(
    versions: TemplateVersion[],
  ): TemplateVersion | undefined {
    return versions.find((v) => v.isActive);
  }

  function getVersionByNumber(
    versions: TemplateVersion[],
    versionNumber: number,
  ): TemplateVersion | undefined {
    return versions.find((v) => v.version === versionNumber);
  }

  function createNewVersion(
    existing: TemplateVersion[],
    data: Omit<TemplateVersion, "version">,
  ): TemplateVersion[] {
    const maxVersion = Math.max(...existing.map((v) => v.version), 0);

    // Deactivate all existing versions
    const updated = existing.map((v) => ({ ...v, isActive: false }));

    // Add new version
    updated.push({
      ...data,
      version: maxVersion + 1,
      isActive: true,
    });

    return updated;
  }

  it("should get active version", () => {
    const versions: TemplateVersion[] = [
      {
        version: 1,
        title: "V1",
        body: "Body 1",
        createdAt: new Date(),
        createdBy: "admin",
        isActive: false,
      },
      {
        version: 2,
        title: "V2",
        body: "Body 2",
        createdAt: new Date(),
        createdBy: "admin",
        isActive: true,
      },
    ];

    const active = getActiveVersion(versions);
    expect(active?.version).toBe(2);
  });

  it("should get specific version", () => {
    const versions: TemplateVersion[] = [
      {
        version: 1,
        title: "V1",
        body: "Body 1",
        createdAt: new Date(),
        createdBy: "admin",
        isActive: false,
      },
      {
        version: 2,
        title: "V2",
        body: "Body 2",
        createdAt: new Date(),
        createdBy: "admin",
        isActive: true,
      },
    ];

    const v1 = getVersionByNumber(versions, 1);
    expect(v1?.title).toBe("V1");
  });

  it("should create new version and deactivate others", () => {
    const versions: TemplateVersion[] = [
      {
        version: 1,
        title: "V1",
        body: "Body 1",
        createdAt: new Date(),
        createdBy: "admin",
        isActive: true,
      },
    ];

    const updated = createNewVersion(versions, {
      title: "V2",
      body: "Body 2",
      createdAt: new Date(),
      createdBy: "admin",
      isActive: true,
    });

    expect(updated.length).toBe(2);
    expect(updated[0].isActive).toBe(false);
    expect(updated[1].version).toBe(2);
    expect(updated[1].isActive).toBe(true);
  });
});

describe("Channel-Specific Template Constraints", () => {
  interface ChannelConstraints {
    maxTitleLength: number;
    maxBodyLength: number;
    supportsHtml: boolean;
    supportsImages: boolean;
  }

  const channelConstraints: Record<NotificationChannel, ChannelConstraints> = {
    [NotificationChannel.SMS]: {
      maxTitleLength: 0, // SMS doesn't have title
      maxBodyLength: 160,
      supportsHtml: false,
      supportsImages: false,
    },
    [NotificationChannel.EMAIL]: {
      maxTitleLength: 200,
      maxBodyLength: 50000,
      supportsHtml: true,
      supportsImages: true,
    },
    [NotificationChannel.PUSH]: {
      maxTitleLength: 100,
      maxBodyLength: 500,
      supportsHtml: false,
      supportsImages: true,
    },
    [NotificationChannel.IN_APP]: {
      maxTitleLength: 100,
      maxBodyLength: 1000,
      supportsHtml: true,
      supportsImages: true,
    },
    [NotificationChannel.WHATSAPP]: {
      maxTitleLength: 0,
      maxBodyLength: 4096,
      supportsHtml: false,
      supportsImages: true,
    },
  };

  function validateTemplateForChannel(
    template: { title: string; body: string; htmlBody?: string },
    channel: NotificationChannel,
  ): { valid: boolean; errors: string[] } {
    const constraints = channelConstraints[channel];
    const errors: string[] = [];

    if (
      template.title.length > constraints.maxTitleLength &&
      constraints.maxTitleLength > 0
    ) {
      errors.push(`Title exceeds ${constraints.maxTitleLength} characters`);
    }

    if (template.body.length > constraints.maxBodyLength) {
      errors.push(`Body exceeds ${constraints.maxBodyLength} characters`);
    }

    if (template.htmlBody && !constraints.supportsHtml) {
      errors.push("Channel does not support HTML content");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  it("should validate SMS template constraints", () => {
    const smsTemplate = {
      title: "",
      body: "Your order is confirmed!",
    };

    const result = validateTemplateForChannel(
      smsTemplate,
      NotificationChannel.SMS,
    );
    expect(result.valid).toBe(true);
  });

  it("should reject SMS with HTML", () => {
    const smsTemplate = {
      title: "",
      body: "Short message",
      htmlBody: "<p>HTML</p>",
    };

    const result = validateTemplateForChannel(
      smsTemplate,
      NotificationChannel.SMS,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Channel does not support HTML content");
  });

  it("should reject oversized SMS body", () => {
    const smsTemplate = {
      title: "",
      body: "A".repeat(200),
    };

    const result = validateTemplateForChannel(
      smsTemplate,
      NotificationChannel.SMS,
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Body exceeds");
  });

  it("should allow HTML in email templates", () => {
    const emailTemplate = {
      title: "Order Confirmation",
      body: "Your order is confirmed.",
      htmlBody: "<h1>Order Confirmed</h1>",
    };

    const result = validateTemplateForChannel(
      emailTemplate,
      NotificationChannel.EMAIL,
    );
    expect(result.valid).toBe(true);
  });
});
