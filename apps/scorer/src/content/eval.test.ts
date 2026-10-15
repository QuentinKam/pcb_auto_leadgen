import { describe, expect, it } from 'bun:test';
import { EVAL_CASES } from './eval-cases.ts';
import { ColdEmailTemplate } from './templates/cold-email.ts';
import { IndustryBlogTemplate } from './templates/industry-blog.ts';
import { LinkedInDmTemplate } from './templates/linkedin-dm.ts';
import type { ContentFormat, TemplateContext } from './types.ts';

const TEMPLATES: Record<
  ContentFormat,
  {
    parseOutput: (
      text: string,
      ctx: TemplateContext
    ) => {
      subject?: string;
      body: string;
      usedFacts: string[];
      suspectFacts: string[];
      gaps: string[];
    };
  }
> = {
  cold_email: new ColdEmailTemplate(),
  linkedin_dm: new LinkedInDmTemplate(),
  industry_blog: new IndustryBlogTemplate(),
};

function makeCtx(facts: TemplateContext['industryFacts']): TemplateContext {
  return {
    profile: {
      businessSummary: 'Designs and builds industrial sensing equipment.',
      productTypes: ['industrial sensor', 'gateway'],
      customerType: 'industrial_equipment',
      painPoints: ['prototype lead time'],
      buyingSignals: ['hiring hardware engineers'],
    },
    company: { name: 'ACME Sensing', website: 'https://acme.test', industry: 'industrial' },
    contact: { name: 'Jane', title: 'VP Engineering' },
    score: { grade: 'B', reason: 'test fixture' },
    brand: {
      companyName: 'GAN PCB',
      capabilities: ['4-32 layer PCB', 'HDI'],
      certifications: ['ISO9001', 'IATF16949'],
      leadTime: 'Prototype: 3-7 days',
      typicalIndustries: ['Industrial', 'Automotive'],
    },
    industryFacts: facts,
  };
}

describe('内容生成评测集', () => {
  it(`评测集规模达标（当前 ${EVAL_CASES.length} 条）`, () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it('覆盖正常 / 边界 / 对抗三类', () => {
    const categories = new Set(EVAL_CASES.map((c) => c.category));
    expect(categories).toContain('normal');
    expect(categories).toContain('boundary');
    expect(categories).toContain('adversarial');
  });

  for (const testCase of EVAL_CASES) {
    it(`[${testCase.category}] ${testCase.id} — ${testCase.description}`, () => {
      const ctx = makeCtx(testCase.facts);
      const template = TEMPLATES[testCase.format];
      const parsed = template.parseOutput(testCase.rawOutput, ctx);

      if (testCase.expect.subject !== undefined) {
        expect(parsed.subject).toBe(testCase.expect.subject);
      }
      if (testCase.expect.usedFacts) {
        expect(parsed.usedFacts).toEqual(testCase.expect.usedFacts);
      }
      if (testCase.expect.suspectFacts) {
        expect(parsed.suspectFacts).toEqual(testCase.expect.suspectFacts);
      }
      if (testCase.expect.gaps) {
        expect(parsed.gaps).toEqual(testCase.expect.gaps);
      }
      for (const forbidden of testCase.expect.bodyNotContains ?? []) {
        expect(parsed.body).not.toContain(forbidden);
      }
    });
  }
});
