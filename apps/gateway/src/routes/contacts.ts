import { Hono } from 'hono';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { contacts, db } from '@pcb/db';

export const contactsRoutes = new Hono();

contactsRoutes.get('/', async (c) => {
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }
  const companyId = c.req.query('companyId');
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);

  const wheres = [eq(contacts.tenantId, tenantId), eq(contacts.active, true)];
  if (companyId) wheres.push(eq(contacts.companyId, companyId));
  const hasEmail = c.req.query('hasEmail');
  if (hasEmail === 'true') wheres.push(isNotNull(contacts.email));

  const rows = await db
    .select()
    .from(contacts)
    .where(and(...wheres))
    .orderBy(desc(contacts.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({
    total: rows.length,
    limit,
    offset,
    items: rows.map((r) => ({
      ...r,
      email: r.email ?? null,
      name: r.name ?? null,
      title: r.title ?? null,
      linkedinUrl: r.linkedinUrl ?? null,
      emailVerified: r.emailVerified ?? 'unknown',
      createdAt: (r.createdAt as unknown as Date).toISOString(),
      updatedAt: (r.updatedAt as unknown as Date).toISOString(),
    })),
  });
});

contactsRoutes.get('/first-by-company/:companyId', async (c) => {
  const tenantId = c.req.header('X-Tenant-Id');
  const companyId = c.req.param('companyId');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  const rows = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.tenantId, tenantId),
        eq(contacts.companyId, companyId),
        eq(contacts.active, true),
        isNotNull(contacts.email)
      )
    )
    .orderBy(desc(contacts.createdAt))
    .limit(1);

  if (rows.length === 0) {
    return c.json(
      { error: 'No active contact with email for this company', code: 'NO_CONTACT' },
      404
    );
  }

  const r = rows[0];
  return c.json({
    ...r,
    email: r.email ?? null,
    name: r.name ?? null,
    title: r.title ?? null,
    linkedinUrl: r.linkedinUrl ?? null,
    emailVerified: r.emailVerified ?? 'unknown',
    createdAt: (r.createdAt as unknown as Date).toISOString(),
    updatedAt: (r.updatedAt as unknown as Date).toISOString(),
  });
});
