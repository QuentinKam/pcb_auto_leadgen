import { zValidator } from '@hono/zod-validator';
import { companies, contacts, contentDrafts, db, leadScores, profiles } from '@pcb/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { matchRelevantFacts } from '../content/facts-loader.ts';
import {
  decideDraftReuse,
  generateContent,
  generateContentAB,
  getBrandInfo,
} from '../content/generator.ts';
import { getActiveModelName } from '../content/llm.ts';
import { type ProfileGeneration, generateProfile } from '../content/profile.ts';
import type {
  ContentFormat,
  ContentResult,
  ContentVariant,
  ProfileResult,
} from '../content/types.ts';
import { type AppEnv, getTraceId } from '../middleware/trace.ts';

export const contentRoutes = new Hono<AppEnv>();

/**
 * GET /content/profile/:companyId
 * 只读查询已存画像：不存在返回 404，不调用 LLM
 * （POST 同路径才是"生成/重算"，前端切公司必须走 GET，否则每次点击都在烧 token）
 */
contentRoutes.get('/profile/:companyId', async (c) => {
  const companyId = c.req.param('companyId');
  const tenantId = c.req.header('X-Tenant-Id');
  if (!tenantId) {
    return c.json({ error: 'Missing X-Tenant-Id header', code: 'MISSING_TENANT' }, 400);
  }

  const [profile] = await db
    .select()
    .from(profiles)
    .where(and(eq(profiles.companyId, companyId), eq(profiles.tenantId, tenantId)))
    .limit(1);

  if (!profile) {
    return c.json({ error: 'Profile not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json(profile);
});

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

  // 调用画像 Agent：EDGAR 公司的 description 只是 SEC 元数据 snippet，
  // 拼接 10-K Item 1 业务章节（截断）作为主要分析素材
  const item1 = readBusinessOverview(company.rawPayload);
  const profileInput = item1
    ? `${item1}\n\nSEC filing metadata: ${company.description ?? ''}`
    : company.description;

  let generation: ProfileGeneration;
  try {
    generation = await generateProfile(company.name, profileInput, company.industry);
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

  const profileResult = generation.profile;

  if (generation.degraded) {
    console.warn(
      `[scorer][profile] trace=${getTraceId(c)} degraded company=${companyId} error=${generation.error}`
    );
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

  // degraded=true 时 profile 是兜底值，前端据此提示「画像生成失败，可重试」
  return c.json(
    { ...saved, degraded: generation.degraded, degradationError: generation.error },
    201
  );
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
  /** 忽略已有 generated 草稿强制重新生成（前端「重新生成」按钮使用） */
  force: z.boolean().optional(),
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

    const { companyId, contactId, format, variant, force } = c.req.valid('json');

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

    // 幂等：已有 generated 草稿时直接返回，避免重复点击重复烧 token、插重复草稿。
    // force=true 时先清掉旧的 generated 草稿再重新生成，防止列表无限堆积。
    const draftFilter = and(
      eq(contentDrafts.tenantId, tenantId),
      eq(contentDrafts.companyId, companyId),
      eq(contentDrafts.format, format),
      eq(contentDrafts.status, 'generated'),
      contactId ? eq(contentDrafts.contactId, contactId) : isNull(contentDrafts.contactId)
    );

    const existingDrafts = force
      ? []
      : await db
          .select()
          .from(contentDrafts)
          .where(draftFilter)
          .orderBy(desc(contentDrafts.createdAt));

    if (decideDraftReuse(force, existingDrafts.length) === 'reuse') {
      return c.json(existingDrafts, 200);
    }

    if (force) {
      await db.delete(contentDrafts).where(draftFilter);
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
    const startedAt = Date.now();
    let results: Array<Omit<ContentResult, 'id' | 'status'>>;
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
      console.error(
        `[scorer][generate] trace=${getTraceId(c)} failed company=${companyId} format=${format} ms=${Date.now() - startedAt} error=${msg}`
      );
      throw err;
    }

    console.log(
      `[scorer][generate] trace=${getTraceId(c)} ok company=${companyId} format=${format} variants=${results.length} ms=${Date.now() - startedAt}`
    );

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

/** 画像 prompt 取用的 Item 1 最大字符数（约 3k tokens，覆盖业务/产品/市场/员工章节） */
const ITEM1_MAX_CHARS = 12_000;

/** 从 raw_payload 取 10-K Item 1 章节并截断；无则返回 null */
function readBusinessOverview(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const value = (rawPayload as Record<string, unknown>).businessOverview;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.slice(0, ITEM1_MAX_CHARS);
}
