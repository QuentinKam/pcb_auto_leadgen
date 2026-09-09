import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, desc, and, sql } from 'drizzle-orm';
import { db, leadScores, auditLogs } from '@pcb/db';
import {
  leadScoreListQuerySchema,
  leadScoreOverrideSchema,
  type LeadScoreResponse,
} from '@pcb/types';

export const leadScoresRoutes = new Hono();

/**
 * GET /api/lead-scores?page=1&pageSize=20&grade=A
 * 列表查询：按 grade 筛选 + 分页
 * 多租户：从 header X-Tenant-Id 读取（开发期简化，生产用 JWT 解析）
 */
leadScoresRoutes.get(
  '/',
  zValidator('query', leadScoreListQuerySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid query', code: 'INVALID_QUERY', details: result.error.issues },
        400,
      );
    }
  }),
  async (c) => {
    const { page, pageSize, grade } = c.req.valid('query');
    const tenantId = c.req.header('X-Tenant-Id');
    if (!tenantId) {
      return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
    }

    const where = grade
      ? and(eq(leadScores.tenantId, tenantId), eq(leadScores.finalGrade, grade))
      : eq(leadScores.tenantId, tenantId);

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leadScores)
      .where(where);

    const rows = await db
      .select()
      .from(leadScores)
      .where(where)
      .orderBy(desc(leadScores.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // 序列化：Drizzle 返回 Date + 推导 grade 为 string，需断言到 zod 推导的字面量联合
    const data = rows.map((r) => ({
      ...r,
      contactId: r.contactId ?? null,
      overriddenBy: r.overriddenBy ?? null,
      overrideReason: r.overrideReason ?? null,
      createdAt: r.createdAt.toISOString(),
    })) as unknown as LeadScoreResponse[];

    return c.json({
      data,
      total: totalRow?.count ?? 0,
      page,
      pageSize,
    });
  },
);

/**
 * GET /api/lead-scores/:id
 * 单条详情
 */
leadScoresRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  const [row] = await db
    .select()
    .from(leadScores)
    .where(and(eq(leadScores.id, id), eq(leadScores.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    return c.json({ error: 'Lead score not found', code: 'NOT_FOUND' }, 404);
  }

  const data = {
    ...row,
    contactId: row.contactId ?? null,
    overriddenBy: row.overriddenBy ?? null,
    overrideReason: row.overrideReason ?? null,
    createdAt: row.createdAt.toISOString(),
  } as unknown as LeadScoreResponse;

  return c.json(data);
});

/**
 * PATCH /api/lead-scores/:id/override
 * 业务员人工覆盖等级
 * - 创建新打分记录（finalGrade 为业务员指定，grade 保留原模型分）
 * - 写入 audit_logs（覆盖原因审计）
 */
leadScoresRoutes.patch(
  '/:id/override',
  zValidator('json', leadScoreOverrideSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400,
      );
    }
  }),
  async (c) => {
    const id = c.req.param('id');
    const tenantId = c.req.header('X-Tenant-Id');
    const userId = c.req.header('X-User-Id');
    if (!tenantId) {
      return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
    }
    const { finalGrade, overrideReason } = c.req.valid('json');

    const [original] = await db
      .select()
      .from(leadScores)
      .where(and(eq(leadScores.id, id), eq(leadScores.tenantId, tenantId)))
      .limit(1);

    if (!original) {
      return c.json({ error: 'Lead score not found', code: 'NOT_FOUND' }, 404);
    }

    // 创建新打分记录：grade 保留模型分，finalGrade 是业务员覆盖值
    const [newScore] = await db
      .insert(leadScores)
      .values({
        tenantId,
        companyId: original.companyId,
        contactId: original.contactId,
        score: original.score,
        grade: original.grade,
        reason: original.reason,
        dimensionBreakdown: original.dimensionBreakdown,
        modelVersion: original.modelVersion,
        overriddenBy: userId ?? null,
        overrideReason,
        finalGrade,
      })
      .returning();

    if (!newScore) {
      return c.json({ error: 'Failed to create override record', code: 'INSERT_FAILED' }, 500);
    }

    // 写审计日志
    await db.insert(auditLogs).values({
      tenantId,
      userId: userId ?? null,
      action: 'score.override',
      entityType: 'lead_score',
      entityId: original.id,
      before: { finalGrade: original.finalGrade },
      after: { finalGrade, overrideReason },
      note: `Overridden by ${userId ?? 'unknown'}`,
    });

    const data = {
      ...newScore,
      contactId: newScore.contactId ?? null,
      overriddenBy: newScore.overriddenBy ?? null,
      overrideReason: newScore.overrideReason ?? null,
      createdAt: newScore.createdAt.toISOString(),
    } as unknown as LeadScoreResponse;

    return c.json(data, 201);
  },
);
