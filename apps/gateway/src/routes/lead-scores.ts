import { zValidator } from '@hono/zod-validator';
import { auditLogs, db, leadScores } from '@pcb/db';
import {
  type LeadScoreResponse,
  leadScoreListQuerySchema,
  leadScoreOverrideSchema,
} from '@pcb/types';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { resolveTenantId } from '../middleware/auth.ts';
import type { AppEnv } from '../middleware/trace.ts';

export const leadScoresRoutes = new Hono<AppEnv>();

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
        400
      );
    }
  }),
  async (c) => {
    const { page, pageSize, grade } = c.req.valid('query');
    const tenantId = resolveTenantId(c);
    if (!tenantId) {
      return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
    }

    // 打分与覆盖都会产生新记录（不 in-place 更新），看板每家公司只展示最新一条。
    // 内层 DISTINCT ON 取每公司最新记录，外层再做 grade 筛选 + 分页
    // （grade 筛选必须在内层之后，否则会把被覆盖公司的旧记录误当最新）。
    const latestPerCompany = db
      .selectDistinctOn([leadScores.companyId])
      .from(leadScores)
      .where(eq(leadScores.tenantId, tenantId))
      .orderBy(leadScores.companyId, desc(leadScores.createdAt))
      .as('latest_per_company');

    const latestWhere = grade ? eq(latestPerCompany.finalGrade, grade) : undefined;

    const [totalRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(latestPerCompany)
      .where(latestWhere);

    const rows = await db
      .select()
      .from(latestPerCompany)
      .where(latestWhere)
      .orderBy(desc(latestPerCompany.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    // 序列化：Drizzle 返回 Date + jsonb，需补充 v2 模型的 buyerFit/demandSignal/negativePenalty/evidence/excluded
    const data = rows.map((r) => serializeLeadScore(r));

    return c.json({
      data,
      total: totalRow?.count ?? 0,
      page,
      pageSize,
    });
  }
);

/**
 * GET /api/lead-scores/:id
 * 单条详情
 */
leadScoresRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tenantId = resolveTenantId(c);
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

  return c.json(serializeLeadScore(row));
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
        400
      );
    }
  }),
  async (c) => {
    const id = c.req.param('id');
    const tenantId = resolveTenantId(c);
    const userId = c.req.header('X-User-Id');
    if (!tenantId) {
      return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
    }
    // 人工覆盖必须有操作者：overridden_by 非空才能避开
    // lead_scores_latest_per_company_idx 部分唯一索引（WHERE overridden_by IS NULL）
    if (!userId) {
      return c.json({ error: 'Missing X-User-Id header', code: 'MISSING_USER' }, 400);
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
        evidence: original.evidence,
        excluded: original.excluded,
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
      userId,
      action: 'score.override',
      entityType: 'lead_score',
      entityId: original.id,
      before: { finalGrade: original.finalGrade },
      after: { finalGrade, overrideReason },
      note: `Overridden by ${userId}`,
    });

    const data = serializeLeadScore(newScore);

    return c.json(data, 201);
  }
);

/**
 * 序列化 lead_scores 行为 v2 模型响应：补充 buyerFit/demandSignal/negativePenalty/evidence/excluded。
 */
function serializeLeadScore(row: typeof leadScores.$inferSelect): LeadScoreResponse {
  const dims = row.dimensionBreakdown as LeadScoreResponse['dimensionBreakdown'];
  const evidence = (row.evidence ?? []) as LeadScoreResponse['evidence'];
  const buyerFit = dims.industryFit + dims.hardwareProductFit + dims.pcbRelevance + dims.companyFit;

  return {
    id: row.id,
    tenantId: row.tenantId,
    companyId: row.companyId,
    contactId: row.contactId ?? null,
    score: row.score,
    grade: row.grade as 'A' | 'B' | 'C',
    reason: row.reason,
    dimensionBreakdown: dims,
    evidence,
    buyerFit,
    demandSignal: dims.demandSignal,
    negativePenalty: dims.negativePenalty,
    excluded: row.excluded,
    modelVersion: row.modelVersion as LeadScoreResponse['modelVersion'],
    overriddenBy: row.overriddenBy ?? null,
    overrideReason: row.overrideReason ?? null,
    finalGrade: row.finalGrade as 'A' | 'B' | 'C',
    createdAt: row.createdAt.toISOString(),
  };
}
