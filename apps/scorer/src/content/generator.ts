import { chat } from './llm.ts';
import { ContentTemplate } from './templates/base.ts';
import { ColdEmailTemplate } from './templates/cold-email.ts';
import { LinkedInDmTemplate } from './templates/linkedin-dm.ts';
import { IndustryBlogTemplate } from './templates/industry-blog.ts';
import type {
  TemplateContext,
  ContentFormat,
  ContentVariant,
  ContentResult,
  BrandInfo,
} from './types.ts';

/**
 * 模板注册表 —— 按 format 分发到对应模板
 */
const TEMPLATES: Record<ContentFormat, ContentTemplate> = {
  cold_email: new ColdEmailTemplate(),
  linkedin_dm: new LinkedInDmTemplate(),
  industry_blog: new IndustryBlogTemplate(),
};

/**
 * 获取品牌信息
 * 优先从环境变量读取（便于不同租户配置），后续可改为从 DB 读取租户级品牌配置
 */
export function getBrandInfo(): BrandInfo {
  return {
    companyName: process.env.BRAND_COMPANY_NAME ?? 'PCB Manufacturer',
    capabilities: (
      process.env.BRAND_CAPABILITIES ?? '4-32 layer PCB, HDI, Flexible PCB, PCBA'
    ).split(','),
    certifications: (process.env.BRAND_CERTIFICATIONS ?? 'ISO9001, IATF16949, ISO13485').split(','),
    leadTime: process.env.BRAND_LEAD_TIME ?? 'Prototype: 3-7 days, Mass production: 2-4 weeks',
    typicalIndustries: (
      process.env.BRAND_INDUSTRIES ?? 'Industrial, Medical, Automotive, Consumer'
    ).split(','),
  };
}

/**
 * 生成单条内容
 * @param ctx 模板上下文（画像 + 公司 + 联系人 + 打分 + 品牌）
 * @param format 内容格式
 * @param variant A/B 变体
 * @returns 生成结果（含 subject/body/gaps）
 */
export async function generateContent(
  ctx: TemplateContext,
  format: ContentFormat,
  variant: ContentVariant
): Promise<Omit<ContentResult, 'id' | 'status'>> {
  const template = TEMPLATES[format];
  if (!template) {
    throw new Error(`Unknown content format: ${format}`);
  }

  const { system, user } = template.buildPrompt(ctx, variant);
  const raw = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    {
      temperature: variant === 'A' ? 0.5 : 0.6,
      maxTokens: format === 'industry_blog' ? 3000 : 1500,
    }
  );

  const parsed = template.parseOutput(raw);

  return {
    format,
    variant,
    subject: parsed.subject ?? null,
    body: parsed.body,
    usedFacts: parsed.usedFacts,
    gaps: parsed.gaps,
  };
}

/**
 * 生成 A/B 双版本（当请求未指定 variant 时）
 */
export async function generateContentAB(
  ctx: TemplateContext,
  format: ContentFormat
): Promise<Array<Omit<ContentResult, 'id' | 'status'>>> {
  const [a, b] = await Promise.all([
    generateContent(ctx, format, 'A'),
    generateContent(ctx, format, 'B'),
  ]);
  return [a, b];
}
