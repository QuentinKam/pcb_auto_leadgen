import { ContentTemplate } from './base.ts';
import type { TemplateContext, ContentVariant, ParsedContent } from '../types.ts';

/**
 * LinkedIn 私信模板
 *
 * A/B 双版本策略：
 * - Variant A（提问式）：以一个相关问题开场，引导对方回应
 * - Variant B（资源分享式）：提供一个有价值的资源/洞察，建立好感
 *
 * 长度：60-120 词（LinkedIn 私信不宜过长）
 * 风格：口语化，像真人发的，不要像营销邮件
 */
export class LinkedInDmTemplate extends ContentTemplate {
  readonly format = 'linkedin_dm';

  buildPrompt(ctx: TemplateContext, variant: ContentVariant): { system: string; user: string } {
    const variantInstruction =
      variant === 'A'
        ? `VARIANT A — Question approach:
- Open with a genuine question related to their role or industry
- The question should be easy to answer and show you've done your research
- Then briefly mention your relevant capability
- End with the question again or a soft follow-up`
        : `VARIANT B — Resource/insight approach:
- Open by sharing a brief, useful insight or resource relevant to their work
- The insight can come from industry facts (if available) or their pain points
- Then briefly connect it to what your company does
- End with a soft offer to share more if interested`;

    const system = `${this.systemConstraint}

Additional rules for LinkedIn DMs:
1. Length: 60-120 words. Short, conversational.
2. Tone: like a real person reaching out, NOT a marketing email. No formal greetings.
3. Opening: reference their specific role, company, or a recent post/activity. Do NOT start with "Hi, I came across your profile".
4. Do NOT include email subject lines or signatures. This is a chat message.
5. CTA: ask a question or offer value. Do NOT ask for a meeting or sale in the first message.
6. No links in the first message (LinkedIn flags them as spam).

${variantInstruction}`;

    const user = `# Prospect
Name: ${ctx.contact.name ?? 'there'}
Title: ${ctx.contact.title ?? 'unknown'}
Company: ${ctx.company.name}
Industry: ${ctx.company.industry ?? 'unknown'}

## Business Summary
${ctx.profile.businessSummary}

## Product Types
${ctx.profile.productTypes.join(', ') || 'unknown'}

## Likely PCB Pain Points
${ctx.profile.painPoints.map((p) => `- ${p}`).join('\n') || 'Not identified'}

## Buying Signals
${ctx.profile.buyingSignals.map((s) => `- ${s}`).join('\n') || 'Not identified'}

# Our Company (Brand Profile)
${this.formatBrand(ctx.brand)}

# Industry Facts (optional, use only if relevant)
${this.formatFacts(ctx.industryFacts)}

# Output
Write the LinkedIn DM message directly. No subject line, no labels, just the message text.`;

    return { system, user };
  }

  override parseOutput(text: string): ParsedContent {
    const body = text.trim();
    const gaps = this.extractGaps(body);
    return {
      body,
      usedFacts: [],
      gaps,
    };
  }
}
