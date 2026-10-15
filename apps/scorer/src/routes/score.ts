import { zValidator } from '@hono/zod-validator';
import { companies, db, leadScores } from '@pcb/db';
import type { LeadScoreResponse } from '@pcb/types';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { SCORING_MODEL_VERSION, scoreLead } from '../scoring/index.ts';

export const scoreRoutes = new Hono();

/**
 * POST /score/company/:companyId
 * 手动触发单条公司打分（v2 领域模型，公司级打分，不依赖联系人）
 */
scoreRoutes.post('/company/:companyId', async (c) => {
  const companyId = c.req.param('companyId');
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  const [company] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenantId)))
    .limit(1);
  if (!company) {
    return c.json({ error: 'Company not found', code: 'NOT_FOUND' }, 404);
  }

  const result = scoreLead({
    industry: company.industry,
    description: company.description,
    rawPayload: company.rawPayload,
    sizeBucket: company.sizeBucket,
    employeeCount: company.employeeCount,
    fundingStage: company.fundingStage,
  });

  const [inserted] = await db
    .insert(leadScores)
    .values({
      tenantId,
      companyId: company.id,
      score: result.score,
      grade: result.grade,
      finalGrade: result.grade,
      reason: result.reason,
      dimensionBreakdown: result.dimensionBreakdown,
      evidence: result.evidence,
      excluded: result.excluded,
      modelVersion: SCORING_MODEL_VERSION,
    })
    .returning();

  if (!inserted) {
    return c.json({ error: 'Failed to insert score', code: 'INSERT_FAILED' }, 500);
  }

  return c.json(serializeScore(inserted), 201);
});

/**
 * POST /score/batch
 * 批量打分：给某租户下所有未打分（或重新打分）的公司打分
 * 简化：前端按需触发，P3 接入 BullMQ 改为异步队列
 */
const batchSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

scoreRoutes.post(
  '/batch',
  zValidator('json', batchSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400
      );
    }
  }),
  async (c) => {
    const tenantId = c.req.header('X-Tenant-Id');
    if (!tenantId) {
      return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
    }
    const { limit } = c.req.valid('json');

    const companyRows = await db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .limit(limit);

    const results: Array<{
      companyId: string;
      score: number;
      grade: string;
      status: 'created' | 'skipped';
    }> = [];
    let skipped = 0;

    for (const company of companyRows) {
      const existing = await db
        .select({ id: leadScores.id })
        .from(leadScores)
        .where(
          and(
            eq(leadScores.tenantId, tenantId),
            eq(leadScores.companyId, company.id),
            isNull(leadScores.overriddenBy)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        results.push({
          companyId: company.id,
          score: 0,
          grade: 'skipped',
          status: 'skipped',
        });
        continue;
      }

      const result = scoreLead({
        industry: company.industry,
        description: company.description,
        rawPayload: company.rawPayload,
        sizeBucket: company.sizeBucket,
        employeeCount: company.employeeCount,
        fundingStage: company.fundingStage,
      });

      await db.insert(leadScores).values({
        tenantId,
        companyId: company.id,
        score: result.score,
        grade: result.grade,
        finalGrade: result.grade,
        reason: result.reason,
        dimensionBreakdown: result.dimensionBreakdown,
        evidence: result.evidence,
        excluded: result.excluded,
        modelVersion: SCORING_MODEL_VERSION,
      });
      results.push({
        companyId: company.id,
        score: result.score,
        grade: result.grade,
        status: 'created',
      });
    }

    return c.json({
      processed: results.length - skipped,
      skipped,
      results,
    });
  }
);

/**
 * GET /score/company/:companyId/latest
 * 获取该公司最新一条打分（按 created_at desc）
 */
scoreRoutes.get('/company/:companyId/latest', async (c) => {
  const companyId = c.req.param('companyId');
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  const rows = await db
    .select()
    .from(leadScores)
    .where(and(eq(leadScores.companyId, companyId), eq(leadScores.tenantId, tenantId)))
    .orderBy(sql`${leadScores.createdAt} DESC`)
    .limit(1);

  if (!rows[0]) {
    return c.json({ error: 'No score found for this company', code: 'NOT_FOUND' }, 404);
  }

  return c.json(serializeScore(rows[0]));
});

function serializeScore(row: typeof leadScores.$inferSelect): LeadScoreResponse {
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
