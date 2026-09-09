import { ContentTemplate } from './base.ts';
import type { TemplateContext, ContentVariant, ParsedContent } from '../types.ts';

/**
 * 开发信模板（cold email）
 *
 * A/B 双版本策略：
 * - Variant A（痛点切入）：先点出客户在 PCB 采购上的具体痛点，再引出我们的解决方案
 * - Variant B（案例/数据切入）：先引用行业数据或同类案例，建立可信度，再介绍能力
 *
 * 长度：150-250 词
 * 结构：个性化开场 → 价值主张 → 简短能力证明 → 低门槛 CTA
 */
export class ColdEmailTemplate extends ContentTemplate {
  readonly format = 'cold_email';

  buildPrompt(ctx: TemplateContext, variant: ContentVariant): { system: string; user: string } {
    const variantInstruction =
      variant === 'A'
        ? `VARIANT A — Pain-point approach:
- Open by acknowledging a SPECIFIC pain point this company likely faces in PCB procurement (from their painPoints list)
- Show you understand their business before pitching
- Then introduce how your capabilities address that pain point`
        : `VARIANT B — Case/data approach:
- Open with a relevant industry data point or trend (from industryFacts if available)
- Show market context that makes your offer timely
- Then introduce your capabilities as a solution to that trend`;

    const system = `${this.systemConstraint}

Additional rules for cold emails:
1. Subject line: max 8 words, personalized (reference their company or product), no clickbait
2. Body length: 150-250 words. Short paragraphs (2-3 sentences each).
3. Opening line: MUST reference something specific about their company (product, industry, or recent activity). Do NOT start with "I hope this email finds you well".
4. Value proposition: 1-2 sentences on what you offer and why it matters to THEM specifically.
5. Social proof: one brief capability or certification from the brand profile. No case studies unless in facts.
6. CTA: low-friction — ask if they'd like a quick quote or sample, OR offer to send more info. Do NOT push for a meeting.
7. Sign-off: professional, include company name and a link to website if available.

${variantInstruction}`;

    const user = `# Prospect Profile
Company: ${ctx.company.name}
Website: ${ctx.company.website ?? 'N/A'}
Industry: ${ctx.company.industry ?? 'unknown'}
Contact: ${ctx.contact.name ?? 'there'}, ${ctx.contact.title ?? ''}

## Business Summary
${ctx.profile.businessSummary}

## Product Types
${ctx.profile.productTypes.join(', ') || 'unknown'}

## Customer Type
${ctx.profile.customerType}

## Likely PCB Pain Points
${ctx.profile.painPoints.map((p) => `- ${p}`).join('\n') || 'Not identified'}

## Buying Signals
${ctx.profile.buyingSignals.map((s) => `- ${s}`).join('\n') || 'Not identified'}

## Lead Score Grade
${ctx.score.grade} — ${ctx.score.reason}

# Our Company (Brand Profile)
${this.formatBrand(ctx.brand)}

# Industry Facts (optional, use only if relevant)
${this.formatFacts(ctx.industryFacts)}

# Output Format
Write the email in this exact format (no extra text):

SUBJECT: <subject line>
BODY:
<email body, multiple paragraphs allowed>`;

    return { system, user };
  }

  override parseOutput(text: string): ParsedContent {
    const subjectMatch = text.match(/^SUBJECT:\s*(.+)$/im);
    const bodyMatch = text.match(/^BODY:\s*([\s\S]*)$/im);

    const subject = subjectMatch?.[1]?.trim() ?? '';
    const body = bodyMatch?.[1]?.trim() ?? text.trim();
    const gaps = this.extractGaps(body);

    return {
      subject: subject || undefined,
      body,
      usedFacts: [],
      gaps,
    };
  }
}
