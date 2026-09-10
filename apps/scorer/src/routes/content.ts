import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, companies, contacts, leadScores, profiles, contentDrafts } from '@pcb/db';
import { generateProfile } from '../content/profile.ts';
import { generateContent, generateContentAB, getBrandInfo } from '../content/generator.ts';
import { getActiveModelName } from '../content/llm.ts';
import { matchRelevantFacts } from '../content/facts-loader.ts';
import type { ProfileResult, ContentFormat, ContentVariant } from '../content/types.ts';

export const contentRoutes = new Hono();

/**
 * POST /content/profile/:companyId
 * 生成客户画像：从公司描述提取业务摘要、产品类型、痛点、采购信号
 * 写入 profiles 表
 */
contentRoutes.post('/profile/:companyId', async (c) => {
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

  // 调用画像 Agent
  let profileResult: ProfileResult;
  try {
    profileResult = await generateProfile(company.name, company.description, company.industry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('API_KEY is not set')) {
      return c.json(
        {
          error:
            'LLM API key not configured. Set ANTHROPIC_API_KEY (for Claude) or OPENAI_API_KEY (for DeepSeek/OpenAI-compatible) in apps/scorer/.env.',
          code: 'LLM_NOT_CONFIGURED',
        },
        503
      );
    }
    throw err;
  }

  // upsert：已存在则更新，不存在则插入
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.tenantId, tenantId), eq(profiles.companyId, companyId)))
    .limit(1);

  let saved: typeof profiles.$inferSelect | undefined;
  const existingRow = existing[0];
  if (existingRow) {
    [saved] = await db
      .update(profiles)
      .set({
        businessSummary: profileResult.businessSummary,
        productTypes: profileResult.productTypes,
        customerType: profileResult.customerType,
        painPoints: profileResult.painPoints,
        buyingSignals: profileResult.buyingSignals,
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, existingRow.id))
      .returning();
  } else {
    [saved] = await db
      .insert(profiles)
      .values({
        tenantId,
        companyId,
        businessSummary: profileResult.businessSummary,
        productTypes: profileResult.productTypes,
        customerType: profileResult.customerType,
        painPoints: profileResult.painPoints,
        buyingSignals: profileResult.buyingSignals,
      })
      .returning();
  }

  if (!saved) {
    return c.json({ error: 'Failed to save profile', code: 'SAVE_FAILED' }, 500);
  }

  return c.json(saved, 201);
});

/**
 * POST /content/generate
 * 生成个性化触达内容（开发信/LinkedIn 私信/行业博客）
 * 入参：{ companyId, contactId?, format, variant? }
 */
const generateSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid().optional(),
  format: z.enum(['cold_email', 'linkedin_dm', 'industry_blog']),
  variant: z.enum(['A', 'B']).optional(),
});

contentRoutes.post(
  '/generate',
  zValidator('json', generateSchema, (result, c) => {
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

    const { companyId, contactId, format, variant } = c.req.valid('json');

    // 查询公司
    const [company] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenantId)))
      .limit(1);
    if (!company) {
      return c.json({ error: 'Company not found', code: 'NOT_FOUND' }, 404);
    }

    // 查询画像（必须先生成画像）
    const [profile] = await db
      .select()
      .from(profiles)
      .where(and(eq(profiles.tenantId, tenantId), eq(profiles.companyId, companyId)))
      .limit(1);
    if (!profile) {
      return c.json(
        {
          error: 'Profile not found. Call POST /content/profile/:companyId first.',
          code: 'PROFILE_NOT_FOUND',
        },
        400
      );
    }

    // 查询联系人（可选）
    let contact = { name: null as string | null, title: null as string | null };
    if (contactId) {
      const [contactRow] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.tenantId, tenantId)))
        .limit(1);
      if (contactRow) {
        contact = { name: contactRow.name, title: contactRow.title };
      }
    }

    // 查询最新打分
    const [score] = await db
      .select({ grade: leadScores.finalGrade, reason: leadScores.reason })
      .from(leadScores)
      .where(and(eq(leadScores.companyId, companyId), eq(leadScores.tenantId, tenantId)))
      .orderBy(desc(leadScores.createdAt))
      .limit(1);

    const industryFacts = await matchRelevantFacts(
      {
        productTypes: profile.productTypes ?? [],
        customerType: profile.customerType as ProfileResult['customerType'],
        painPoints: profile.painPoints ?? [],
        industry: company.industry,
      },
      { format: format as ContentFormat }
    );

    // 组装模板上下文
    const ctx = {
      profile: {
        businessSummary: profile.businessSummary ?? '',
        productTypes: profile.productTypes ?? [],
        customerType: profile.customerType as ProfileResult['customerType'],
        painPoints: profile.painPoints ?? [],
        buyingSignals: profile.buyingSignals ?? [],
      },
      company: {
        name: company.name,
        website: company.website,
        industry: company.industry,
      },
      contact,
      score: {
        grade: (score?.grade as 'A' | 'B' | 'C') ?? 'C',
        reason: score?.reason ?? 'No score available',
      },
      brand: getBrandInfo(),
      industryFacts,
    };

    // 生成内容
    let results;
    try {
      results = variant
        ? [await generateContent(ctx, format as ContentFormat, variant as ContentVariant)]
        : await generateContentAB(ctx, format as ContentFormat);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('API_KEY is not set')) {
        return c.json(
          {
            error:
              'LLM API key not configured. Set ANTHROPIC_API_KEY (for Claude) or OPENAI_API_KEY (for DeepSeek/OpenAI-compatible) in apps/scorer/.env.',
            code: 'LLM_NOT_CONFIGURED',
          },
          503
        );
      }
      throw err;
    }

    // 写入 content_drafts 表
    const saved = await Promise.all(
      results.map(async (r) => {
        const [inserted] = await db
          .insert(contentDrafts)
          .values({
            tenantId,
            companyId,
            contactId: contactId ?? null,
            profileId: profile.id,
            format: r.format,
            variant: r.variant,
            subject: r.subject,
            body: r.body,
            status: 'generated',
            usedFacts: r.usedFacts,
            gaps: r.gaps,
            model: getActiveModelName(),
          })
          .returning();
        return inserted;
      })
    );

    return c.json(saved, 201);
  }
);

/**
 * GET /content/drafts/:companyId
 * 获取某公司的所有内容草稿
 */
contentRoutes.get('/drafts/:companyId', async (c) => {
  const companyId = c.req.param('companyId');
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  const drafts = await db
    .select()
    .from(contentDrafts)
    .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.tenantId, tenantId)))
    .orderBy(desc(contentDrafts.createdAt));

  return c.json(drafts);
});

/**
 * PATCH /content/drafts/:draftId
 * 更新草稿状态（approved / rejected / sent）或编辑内容
 */
const updateDraftSchema = z.object({
  status: z.enum(['generated', 'approved', 'rejected', 'sent']).optional(),
  body: z.string().optional(),
  subject: z.string().optional(),
});

contentRoutes.patch(
  '/drafts/:draftId',
  zValidator('json', updateDraftSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'Invalid body', code: 'INVALID_BODY', details: result.error.issues },
        400
      );
    }
  }),
  async (c) => {
    const draftId = c.req.param('draftId');
    const tenantId = c.req.header('X-Tenant-Id');
    if (!tenantId) {
      return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
    }

    const body = c.req.valid('json');
    const updateData: Record<string, unknown> = {};
    if (body.status) updateData.status = body.status;
    if (body.body !== undefined) updateData.body = body.body;
    if (body.subject !== undefined) updateData.subject = body.subject;
    if (body.status === 'approved') {
      updateData.approvedAt = new Date();
    }

    const [updated] = await db
      .update(contentDrafts)
      .set(updateData)
      .where(and(eq(contentDrafts.id, draftId), eq(contentDrafts.tenantId, tenantId)))
      .returning();

    if (!updated) {
      return c.json({ error: 'Draft not found', code: 'NOT_FOUND' }, 404);
    }

    return c.json(updated);
  }
);
