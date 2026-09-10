import { zValidator } from '@hono/zod-validator';
import { emailCampaigns, emailSends } from '@pcb/db/schema';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../lib/db.ts';

const app = new Hono();

const CampaignListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
  isWarmup: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});

app.get('/stats', async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);

  const statsRows = (await db
    .select({
      totalSent: sql<number>`COUNT(*)`,
      totalDelivered: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.deliveredAt} IS NOT NULL)`,
      totalOpened: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.firstOpenedAt} IS NOT NULL)`,
      totalClicked: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.firstClickedAt} IS NOT NULL)`,
      totalReplied: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.status} = 'replied')`,
      totalBouncedHard: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.bounceType} = 'hard')`,
      totalBouncedSoft: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.bounceType} = 'soft')`,
      totalComplained: sql<number>`COUNT(*) FILTER (WHERE ${emailSends.complainedAt} IS NOT NULL)`,
    })
    .from(emailSends)
    .where(eq(emailSends.tenantId, tenantId))) as unknown as Array<{
    totalSent: number;
    totalDelivered: number;
    totalOpened: number;
    totalClicked: number;
    totalReplied: number;
    totalBouncedHard: number;
    totalBouncedSoft: number;
    totalComplained: number;
  }>;

  const s = statsRows[0] ?? {
    totalSent: 0,
    totalDelivered: 0,
    totalOpened: 0,
    totalClicked: 0,
    totalReplied: 0,
    totalBouncedHard: 0,
    totalBouncedSoft: 0,
    totalComplained: 0,
  };

  const totalSent = Number(s.totalSent ?? 0);
  const totalDelivered = Number(s.totalDelivered ?? 0);
  const totalOpened = Number(s.totalOpened ?? 0);
  const totalClicked = Number(s.totalClicked ?? 0);
  const totalBounced = Number(s.totalBouncedHard ?? 0) + Number(s.totalBouncedSoft ?? 0);
  const totalComplained = Number(s.totalComplained ?? 0);

  return c.json({
    totalSent,
    totalDelivered,
    totalOpened,
    totalClicked,
    totalReplied: Number(s.totalReplied ?? 0),
    totalBouncedHard: Number(s.totalBouncedHard ?? 0),
    totalBouncedSoft: Number(s.totalBouncedSoft ?? 0),
    totalComplained,
    complaintRate: totalSent > 0 ? totalComplained / totalSent : 0,
    openRate: totalDelivered > 0 ? totalOpened / totalDelivered : 0,
    clickRate: totalOpened > 0 ? totalClicked / totalOpened : 0,
    bounceRate: totalSent > 0 ? totalBounced / totalSent : 0,
  });
});

app.get('/campaigns', zValidator('query', CampaignListQuerySchema), async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);
  const { limit, offset, isWarmup } = c.req.valid('query');

  const wheres = [eq(emailCampaigns.tenantId, tenantId)];
  if (isWarmup !== undefined) wheres.push(eq(emailCampaigns.isWarmup, isWarmup));

  const [list, countRows] = await Promise.all([
    db
      .select()
      .from(emailCampaigns)
      .where(and(...wheres))
      .orderBy(desc(emailCampaigns.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ id: emailCampaigns.id })
      .from(emailCampaigns)
      .where(and(...wheres)),
  ]);

  return c.json({
    total: countRows.length,
    limit,
    offset,
    items: list,
  });
});

export const statsAndCampaignsRoutes = app;
