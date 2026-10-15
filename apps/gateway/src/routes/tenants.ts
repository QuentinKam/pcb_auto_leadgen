import { zValidator } from '@hono/zod-validator';
import { db, tenants } from '@pcb/db';
import { type TenantResponse, tenantCreateSchema } from '@pcb/types';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from '../middleware/trace.ts';

export const tenantsRoutes = new Hono<AppEnv>();

/**
 * GET /api/tenants
 * 列出所有租户（仅 admin 应访问，鉴权待加）
 */
tenantsRoutes.get('/', async (c) => {
  const rows = await db.select().from(tenants).orderBy(tenants.createdAt);
  const data = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })) as unknown as TenantResponse[];
  return c.json({ data });
});

/**
 * GET /api/tenants/:id
 */
tenantsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!row) {
    return c.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, 404);
  }
  const data = {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as unknown as TenantResponse;
  return c.json(data);
});

/**
 * POST /api/tenants
 * 创建租户（仅 superadmin 应访问，鉴权待加）
 */
tenantsRoutes.post(
  '/',
  zValidator('json', tenantCreateSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400
      );
    }
  }),
  async (c) => {
    const input = c.req.valid('json');
    const [row] = await db.insert(tenants).values(input).returning();
    if (!row) {
      return c.json({ error: 'Failed to create tenant', code: 'INSERT_FAILED' }, 500);
    }
    const data = {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } as unknown as TenantResponse;
    return c.json(data, 201);
  }
);
