import { ContentTemplate } from './base.ts';
import type { TemplateContext, ContentVariant, ParsedContent } from '../types.ts';

/**
 * 行业博客模板（OPC 叙事预留）
 *
 * 这是对接文档「项目 5：获客内容智能体」的模板
 * 与 ContentForge 的区别：
 * - ContentForge：重型质量门禁（FactChecker/GEOChecker），中文多平台
 * - 本模板：轻量英文博客，用于 LinkedIn/独立站发布，作为获客入口
 *
 * A/B 双版本：
 * - Variant A（技术深度）：面向硬件工程师，深入技术细节和选型建议
 * - Variant B（采购决策视角）：面向采购/管理层，侧重成本、交期、供应链
 *
 * 长度：600-1000 词
 * 输入：ctx.company.name 复用为博客主题/关键词，ctx.industryFacts 为内容素材
 */
export class IndustryBlogTemplate extends ContentTemplate {
  readonly format = 'industry_blog';

  buildPrompt(ctx: TemplateContext, variant: ContentVariant): { system: string; user: string } {
    const topic = ctx.company.name || 'PCB manufacturing trends';

    const variantInstruction =
      variant === 'A'
        ? `VARIANT A — Technical deep-dive:
- Target audience: hardware engineers, R&D, technical decision makers
- Focus on technical specifications, material choices, design considerations
- Include specific PCB parameters (layer count, impedance, finish, etc.) from facts
- End with a technical recommendation or design tip`
        : `VARIANT B — Procurement/decision perspective:
- Target audience: procurement managers, supply chain, business owners
- Focus on cost drivers, lead times, quality control, supplier selection
- Use market data and industry trends from facts to support arguments
- End with a practical sourcing recommendation`;

    const system = `${this.systemConstraint}

Additional rules for industry blog posts:
1. Length: 600-1000 words.
2. Structure: Title → Introduction (problem/context) → 3-4 main sections with H2 headings → Conclusion with actionable takeaway.
3. Every data claim (number, percentage, timeframe) MUST come from the industry facts. If a needed number is not in facts, write "[data gap: need XX]".
4. Cite sources inline as (Source, Year) where available.
5. Brand mention appears once in the conclusion, naturally. No hard selling.
6. Write in professional but accessible English. Avoid overly academic tone.
7. Include a meta description (1-2 sentences) at the top for SEO.

${variantInstruction}`;

    const user = `# Blog Topic
${topic}

# Industry Facts (your ONLY source for data)
${this.formatFacts(ctx.industryFacts)}

# Our Company (for brand mention in conclusion)
${this.formatBrand(ctx.brand)}

# Output Format
Write the blog post in this exact format:

TITLE: <SEO-friendly title, 50-60 chars>
META: <1-2 sentence meta description>
BODY:
<full blog post with H2 headings using ##>`;

    return { system, user };
  }

  override parseOutput(text: string): ParsedContent {
    const titleMatch = text.match(/^TITLE:\s*(.+)$/im);
    const metaMatch = text.match(/^META:\s*(.+)$/im);
    const bodyMatch = text.match(/^BODY:\s*([\s\S]*)$/im);

    const title = titleMatch?.[1]?.trim() ?? '';
    const meta = metaMatch?.[1]?.trim() ?? '';
    const body = bodyMatch?.[1]?.trim() ?? text.trim();
    const gaps = this.extractGaps(body);

    // 把 title 和 meta 拼到 body 前面，作为 subject 存储 title
    const fullBody = meta ? `> ${meta}\n\n${body}` : body;

    return {
      subject: title || undefined,
      body: fullBody,
      usedFacts: [],
      gaps,
    };
  }
}
