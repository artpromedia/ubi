/**
 * Notification Templates Routes
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { generateId } from '../lib/utils';
import { adminOnly, serviceAuth } from '../middleware/auth';
import { NotificationChannel, NotificationType } from '../types';

const templatesRoutes = new Hono();

// ============================================
// Schemas
// ============================================

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
  activeOnly: z.string().transform((v) => v === 'true').default('true'),
});

const previewTemplateSchema = z.object({
  variables: z.record(z.any()),
});

// ============================================
// Routes
// ============================================

/**
 * GET /templates - List templates
 */
templatesRoutes.get('/', adminOnly, zValidator('query', listTemplatesSchema), async (c) => {
  const { page, limit, channel, type, activeOnly } = c.req.valid('query');

  const where: Record<string, unknown> = {};

  if (channel) {
    where.channel = channel;
  }
  if (type) {
    where.type = type;
  }
  if (activeOnly) {
    where.isActive = true;
  }

  const [templates, total] = await Promise.all([
    prisma.notificationTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notificationTemplate.count({ where }),
  ]);

  return c.json({
    success: true,
    data: {
      templates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

/**
 * GET /templates/:id - Get template
 */
templatesRoutes.get('/:id', adminOnly, async (c) => {
  const id = c.req.param('id');

  const template = await prisma.notificationTemplate.findUnique({
    where: { id },
  });

  if (!template) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Template not found' },
    }, 404);
  }

  return c.json({ success: true, data: { template } });
});

/**
 * POST /templates - Create template
 */
templatesRoutes.post('/', adminOnly, zValidator('json', createTemplateSchema), async (c) => {
  const data = c.req.valid('json');

  // Check for existing template with same type and channel
  const existing = await prisma.notificationTemplate.findFirst({
    where: { type: data.type, channel: data.channel },
  });

  if (existing) {
    return c.json({
      success: false,
      error: { code: 'TEMPLATE_EXISTS', message: 'Template for this type and channel already exists' },
    }, 409);
  }

  const template = await prisma.notificationTemplate.create({
    data: {
      id: generateId('tmpl'),
      ...data,
      isActive: true,
    },
  });

  return c.json({ success: true, data: { template } }, 201);
});

/**
 * PATCH /templates/:id - Update template
 */
templatesRoutes.patch('/:id', adminOnly, zValidator('json', updateTemplateSchema), async (c) => {
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const existing = await prisma.notificationTemplate.findUnique({
    where: { id },
  });

  if (!existing) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Template not found' },
    }, 404);
  }

  const template = await prisma.notificationTemplate.update({
    where: { id },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });

  return c.json({ success: true, data: { template } });
});

/**
 * DELETE /templates/:id - Delete template
 */
templatesRoutes.delete('/:id', adminOnly, async (c) => {
  const id = c.req.param('id');

  const existing = await prisma.notificationTemplate.findUnique({
    where: { id },
  });

  if (!existing) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Template not found' },
    }, 404);
  }

  await prisma.notificationTemplate.delete({ where: { id } });

  return c.json({ success: true });
});

/**
 * POST /templates/:id/preview - Preview template with variables
 */
templatesRoutes.post(
  '/:id/preview',
  adminOnly,
  zValidator('json', previewTemplateSchema),
  async (c) => {
    const id = c.req.param('id');
    const { variables } = c.req.valid('json');

    const template = await prisma.notificationTemplate.findUnique({
      where: { id },
    });

    if (!template) {
      return c.json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Template not found' },
      }, 404);
    }

    const title = interpolateTemplate(template.title, variables);
    const body = interpolateTemplate(template.body, variables);
    const htmlBody = template.htmlBody
      ? interpolateTemplate(template.htmlBody, variables)
      : undefined;

    return c.json({
      success: true,
      data: {
        title,
        body,
        htmlBody,
      },
    });
  }
);

/**
 * POST /templates/:id/duplicate - Duplicate template
 */
templatesRoutes.post('/:id/duplicate', adminOnly, async (c) => {
  const id = c.req.param('id');

  const existing = await prisma.notificationTemplate.findUnique({
    where: { id },
  });

  if (!existing) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Template not found' },
    }, 404);
  }

  const template = await prisma.notificationTemplate.create({
    data: {
      id: generateId('tmpl'),
      name: `${existing.name} (Copy)`,
      type: existing.type,
      channel: existing.channel,
      title: existing.title,
      body: existing.body,
      htmlBody: existing.htmlBody,
      variables: existing.variables as string[],
      metadata: existing.metadata || {},
      isActive: false, // Start inactive
    },
  });

  return c.json({ success: true, data: { template } }, 201);
});

/**
 * POST /templates/:id/activate - Activate template
 */
templatesRoutes.post('/:id/activate', adminOnly, async (c) => {
  const id = c.req.param('id');

  const template = await prisma.notificationTemplate.update({
    where: { id },
    data: { isActive: true },
  });

  return c.json({ success: true, data: { template } });
});

/**
 * POST /templates/:id/deactivate - Deactivate template
 */
templatesRoutes.post('/:id/deactivate', adminOnly, async (c) => {
  const id = c.req.param('id');

  const template = await prisma.notificationTemplate.update({
    where: { id },
    data: { isActive: false },
  });

  return c.json({ success: true, data: { template } });
});

/**
 * GET /templates/by-type/:type/:channel - Get template by type and channel (service-to-service)
 */
templatesRoutes.get('/by-type/:type/:channel', serviceAuth, async (c) => {
  const type = c.req.param('type') as NotificationType;
  const channel = c.req.param('channel') as NotificationChannel;

  const template = await prisma.notificationTemplate.findFirst({
    where: { type, channel, isActive: true },
  });

  if (!template) {
    return c.json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Template not found' },
    }, 404);
  }

  return c.json({ success: true, data: { template } });
});

// ============================================
// Helpers
// ============================================

function interpolateTemplate(template: string, variables: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

export { templatesRoutes };
