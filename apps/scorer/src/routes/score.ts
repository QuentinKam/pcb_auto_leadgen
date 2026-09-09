import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db, companies, contacts, leadScores } from '@pcb/db';
import { scoreLead, SCORING_MODEL_VERSION } from '../scoring/index.ts';
import type { LeadScoreResponse } from '@pcb/types';

export const scoreRoutes = new Hono();

/**
 * POST /score/company/:companyId
 * 手动触发单条公司打分
 * 查询 company + 关联的 primary contact（取 title 最匹配决策权的）
 * 调用 scoreLead 写入 lead_scores 表
 */
scoreRoutes.post('/company/:companyId', async (c) => {
  const companyId = c.req.param('companyId');
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  // 查 company
  const [company] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenantId)))
    .limit(1);
  if (!company) {
    return c.json({ error: 'Company not found', code: 'NOT_FOUND' }, 404);
  }

  // 查该公司的联系人，按决策权粗排序：采购/硬件/项目经理优先
  // P1 简化：取第一条 active contact
  const contactRows = await db
    .select()
    .from(contacts)
    .where(and(eq(contacts.companyId, company.id), eq(contacts.tenantId, tenantId), eq(contacts.active, true)))
    .limit(1);
  const contact = contactRows[0] ?? null;

  // 打分
  const result = scoreLead(company, contact);

  // 写入 lead_scores
  const [inserted] = await db
    .insert(leadScores)
    .values({
      tenantId,
      companyId: company.id,
      contactId: contact?.id ?? null,
      score: result.score,
      grade: result.grade,
      finalGrade: result.grade, // 模型分 = 最终分（未被人工覆盖）
      reason: result.reason,
      dimensionBreakdown: result.dimensionBreakdown,
      modelVersion: SCORING_MODEL_VERSION,
    })
    .returning();

  if (!inserted) {
    return c.json({ error: 'Failed to insert score', code: 'INSERT_FAILED' }, 500);
  }

  const data = {
    ...inserted,
    contactId: inserted.contactId ?? null,
    overriddenBy: inserted.overriddenBy ?? null,
    overrideReason: inserted.overrideReason ?? null,
    createdAt: inserted.createdAt.toISOString(),
  } as unknown as LeadScoreResponse;

  return c.json(data, 201);
});

/**
 * POST /score/batch
 * 批量打分：给某租户下所有未打分（或重新打分）的公司打分
 * 入参：{ tenantId, limit?, grade? }
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
        400,
      );
    }
  }),
  async (c) => {
    const tenantId = c.req.header('X-Tenant-Id');
    if (!tenantId) {
      return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
    }
    const { limit } = c.req.valid('json');

    // 拿到 tenant 下所有 companies
    const companyRows = await db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .limit(limit);

    const results: Array<{ companyId: string; score: number; grade: string; status: 'created' | 'skipped' }> = [];
    let skipped = 0;

    for (const company of companyRows) {
      // 检查是否已有未被覆盖的打分（partial unique index 约束）
      const existing = await db
        .select({ id: leadScores.id })
        .from(leadScores)
        .where(
          and(
            eq(leadScores.tenantId, tenantId),
            eq(leadScores.companyId, company.id),
            isNull(leadScores.overriddenBy),
          ),
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

      // 取 primary contact（简化）
      const contactRows = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.companyId, company.id), eq(contacts.tenantId, tenantId), eq(contacts.active, true)))
        .limit(1);
      const contact = contactRows[0] ?? null;

      const result = scoreLead(company, contact);
      await db.insert(leadScores).values({
        tenantId,
        companyId: company.id,
        contactId: contact?.id ?? null,
        score: result.score,
        grade: result.grade,
        finalGrade: result.grade,
        reason: result.reason,
        dimensionBreakdown: result.dimensionBreakdown,
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
  },
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

  // 窗口函数：DISTINCT ON 拿每个 company 最新一条
  const rows = await db
    .select()
    .from(leadScores)
    .where(and(eq(leadScores.companyId, companyId), eq(leadScores.tenantId, tenantId)))
    .orderBy(sql`${leadScores.createdAt} DESC`)
    .limit(1);

  if (!rows[0]) {
    return c.json({ error: 'No score found for this company', code: 'NOT_FOUND' }, 404);
  }

  const row = rows[0];
  const data = {
    ...row,
    contactId: row.contactId ?? null,
    overriddenBy: row.overriddenBy ?? null,
    overrideReason: row.overrideReason ?? null,
    createdAt: row.createdAt.toISOString(),
  } as unknown as LeadScoreResponse;

  return c.json(data);
});
