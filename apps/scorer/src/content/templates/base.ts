import type { TemplateContext, ParsedContent, ContentVariant } from '../types.ts';

/**
 * 内容模板基类
 * 所有模板子类只需实现 buildPrompt，LLM 调用和结果解析由基类统一处理
 *
 * 设计原则：
 * - 防编造：system prompt 硬约束，事实包中没有的数据标 [数据缺口]
 * - 个性化：必须引用客户具体业务，禁止通用模板话术
 * - 不硬广：品牌信息只在指定位置出现一次
 */
export abstract class ContentTemplate {
  abstract readonly format: string;

  /**
   * 构建 system prompt 和 user prompt
   * 子类实现，差异只在这里
   */
  abstract buildPrompt(
    ctx: TemplateContext,
    variant: ContentVariant
  ): { system: string; user: string };

  /**
   * 共享的 system prompt 约束（防编造、防硬广）
   * 子类在 buildPrompt 中应以此为基础追加特定约束
   */
  protected get systemConstraint(): string {
    return `You are a B2B sales copywriter for a PCB/PCBA manufacturer based in China, targeting overseas buyers.

Hard rules:
1. Only use facts from the provided context. If a specific data point (number, price, lead time, specification) is NOT in the context, write "[data gap: need XX]" instead of guessing.
2. No superlatives: do NOT use "best", "#1", "industry-leading", "top", "perfect", "guaranteed".
3. Personalize based on the prospect's actual business. Do NOT use generic filler phrases. Reference their specific products, industry, or pain points.
4. Keep it concise. No fluff, no marketing jargon.
5. Brand mention appears only once, in the designated position. Do not repeat the company name multiple times.
6. Do not invent certifications, capabilities, or case studies. Only use what is in the brand profile.`;
  }

  /**
   * 解析 LLM 输出，提取 subject / body / usedFacts / gaps
   * 默认实现：直接把全文作为 body，gaps 和 usedFacts 通过正则提取
   * 子类可覆盖以处理结构化输出
   */
  parseOutput(text: string): ParsedContent {
    const gaps = this.extractGaps(text);
    const usedFacts = this.extractUsedFacts(text);
    const cleanedBody = this.stripFactMarkers(text.trim());
    return {
      body: cleanedBody,
      usedFacts,
      gaps,
    };
  }

  /**
   * 从文本中提取 [数据缺口] 标记
   */
  protected extractGaps(text: string): string[] {
    const matches = text.match(/\[data gap:[^\]]*\]/gi) ?? [];
    return matches.map((m) => m.replace(/^\[data gap:\s*/i, '').replace(/\]$/, ''));
  }

  /**
   * 从文本中提取引用的事实 ID（形如 [F-001]）
   */
  protected extractUsedFacts(text: string): string[] {
    const matches = text.match(/\[F-\d+\]/g) ?? [];
    const ids = new Set(matches.map((m) => m.replace(/^\[|\]$/g, '')));
    return Array.from(ids);
  }

  /**
   * 移除正文中的事实 ID 标记（保留在 usedFacts 中即可，正文给客户看不需要）
   */
  protected stripFactMarkers(text: string): string {
    return text.replace(/\s*\[F-\d+\]/g, '');
  }

  /**
   * 格式化事实包为 prompt 文本
   * 要求 LLM 引用事实时在句子末尾标注 [F-xxx]，用于 usedFacts 追踪
   */
  protected formatFacts(facts: TemplateContext['industryFacts']): string {
    if (!facts || facts.length === 0) {
      return [
        '(No industry facts available. Do NOT invent any market data, statistics, or benchmarks.)',
        'If you need a specific number, write "[data gap: need the specific fact]" instead of guessing.',
      ].join('\n');
    }
    const lines = facts.map(
      (f) => `- [${f.id}] ${f.claim} (Source: ${f.source}${f.year ? `, ${f.year}` : ''})`
    );
    lines.push(
      '',
      'Usage rules for facts:',
      '- When you use a fact, append its ID in brackets at the END of the sentence that uses it, e.g. "...trend continues [F-016]."',
      '- Only use facts that are listed above. Do not invent numbers or statistics.',
      '- If a specific data point is missing, write "[data gap: need XX]" instead of guessing.'
    );
    return lines.join('\n');
  }

  /**
   * 格式化品牌信息
   */
  protected formatBrand(brand: TemplateContext['brand']): string {
    return [
      `Company: ${brand.companyName}`,
      `Capabilities: ${brand.capabilities.join(', ')}`,
      `Certifications: ${brand.certifications.join(', ')}`,
      `Lead time: ${brand.leadTime}`,
      `Typical industries: ${brand.typicalIndustries.join(', ')}`,
    ].join('\n');
  }
}
