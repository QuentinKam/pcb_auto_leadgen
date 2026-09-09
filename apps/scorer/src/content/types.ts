/**
 * P2 内容生成模块类型定义
 */

/** 客户类型分类 */
export type CustomerType =
  | 'startup_hardware'
  | 'industrial_equipment'
  | 'consumer_electronics'
  | 'medical_device'
  | 'automotive'
  | 'aerospace'
  | 'telecom'
  | 'iot'
  | 'other';

/** 客户画像结果（由画像 Agent 输出） */
export interface ProfileResult {
  businessSummary: string;
  productTypes: string[];
  customerType: CustomerType;
  painPoints: string[];
  buyingSignals: string[];
}

/** 内容格式 */
export type ContentFormat = 'cold_email' | 'linkedin_dm' | 'industry_blog';

/** A/B 测试变体 */
export type ContentVariant = 'A' | 'B';

/** 语气风格 */
export type ContentTone = 'formal' | 'friendly' | 'concise';

/** 草稿状态 */
export type ContentStatus = 'generated' | 'approved' | 'rejected' | 'sent';

/** 模板上下文 —— 所有模板共享的输入数据 */
export interface TemplateContext {
  profile: ProfileResult;
  company: {
    name: string;
    website?: string | null;
    industry?: string | null;
  };
  contact: {
    name?: string | null;
    title?: string | null;
  };
  score: {
    grade: 'A' | 'B' | 'C';
    reason: string;
  };
  brand: BrandInfo;
  industryFacts?: IndustryFact[];
}

/** 我方品牌/工厂能力（来自 brand.md 或环境配置） */
export interface BrandInfo {
  companyName: string;
  capabilities: string[]; // 如：4-32 层 PCB、HDI、柔性板、PCBA 一站式
  certifications: string[]; // 如：ISO9001、IATF16949、ISO13485
  leadTime: string; // 如：打样 3-7 天，量产 2-4 周
  typicalIndustries: string[]; // 典型服务行业
}

/** 行业事实（来自 ContentForge facts.json，可选注入） */
export interface IndustryFact {
  id: string;
  claim: string;
  source: string;
  year?: number;
}

/** 内容生成请求 */
export interface ContentRequest {
  companyId: string;
  contactId?: string;
  format: ContentFormat;
  variant?: ContentVariant; // 不传则 A/B 都生成
  tone?: ContentTone;
}

/** 内容生成结果 */
export interface ContentResult {
  id: string;
  format: ContentFormat;
  variant: ContentVariant;
  subject: string | null;
  body: string;
  status: ContentStatus;
  usedFacts: string[];
  gaps: string[];
}

/** LLM 响应解析后的结构化内容 */
export interface ParsedContent {
  subject?: string;
  body: string;
  usedFacts: string[];
  gaps: string[];
}
