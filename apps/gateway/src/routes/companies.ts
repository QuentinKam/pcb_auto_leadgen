import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, sql, desc } from 'drizzle-orm';
import { db, companies } from '@pcb/db';
import { companyCreateSchema, type CompanyResponse } from '@pcb/types';

export const companiesRoutes = new Hono();

/**
 * GET /api/companies?page=1&pageSize=20
 * 列出当前租户的企业
 */
companiesRoutes.get('/', async (c) => {
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  const page = Number(c.req.query('page') ?? 1);
  const pageSize = Math.min(Number(c.req.query('pageSize') ?? 20), 100);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(companies)
    .where(eq(companies.tenantId, tenantId));

  const rows = await db
    .select()
    .from(companies)
    .where(eq(companies.tenantId, tenantId))
    .orderBy(desc(companies.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = rows.map((r) => ({
    ...r,
    website: r.website ?? null,
    industry: r.industry ?? null,
    sizeBucket: r.sizeBucket ?? null,
    employeeCount: r.employeeCount ?? null,
    fundingStage: r.fundingStage ?? null,
    country: r.country ?? null,
    description: r.description ?? null,
    rawPayload: r.rawPayload ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })) as unknown as CompanyResponse[];

  return c.json({
    data,
    total: totalRow?.count ?? 0,
    page,
    pageSize,
  });
});

/**
 * GET /api/companies/:id
 */
companiesRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  const [row] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, id), eq(companies.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return c.json({ error: 'Company not found', code: 'NOT_FOUND' }, 404);
  }

  const data = {
    ...row,
    website: row.website ?? null,
    industry: row.industry ?? null,
    sizeBucket: row.sizeBucket ?? null,
    employeeCount: row.employeeCount ?? null,
    fundingStage: row.fundingStage ?? null,
    country: row.country ?? null,
    description: row.description ?? null,
    rawPayload: row.rawPayload ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as unknown as CompanyResponse;

  return c.json(data);
});

/**
 * POST /api/companies
 */
companiesRoutes.post(
  '/',
  zValidator('json', companyCreateSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400,
      );
    }
  }),
  async (c) => {
    const input = c.req.valid('json') as Omit<typeof companies.$inferInsert, 'tenantId'>;
    const [row] = await db
      .insert(companies)
      .values({ ...input, tenantId: c.req.header('X-Tenant-Id')! })
      .returning();
    if (!row) {
      return c.json({ error: 'Failed to create company', code: 'INSERT_FAILED' }, 500);
    }

    const data = {
      ...row,
      website: row.website ?? null,
      industry: row.industry ?? null,
      sizeBucket: row.sizeBucket ?? null,
      employeeCount: row.employeeCount ?? null,
      fundingStage: row.fundingStage ?? null,
      country: row.country ?? null,
      description: row.description ?? null,
      rawPayload: row.rawPayload ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    } as unknown as CompanyResponse;

    return c.json(data, 201);
  },
);
