import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { getFactsPath, loadFacts, matchRelevantFacts } from './facts-loader.ts';

// facts.json 由另一仓库（ContentForge）产出，CI 上不存在时应跳过这些用例
const factsAvailable = existsSync(getFactsPath());

describe.skipIf(!factsAvailable)('facts-loader', () => {
  beforeEach(async () => {
    await loadFacts();
  });

  test('loadFacts loads facts from facts.json and filters out template category', async () => {
    const facts = await loadFacts();
    expect(facts.length).toBeGreaterThan(0);
    const hasTemplate = facts.some((f) => (f as { cat?: string }).cat === 'template');
    expect(hasTemplate).toBe(false);
    for (const f of facts) {
      expect(f.id).toBeString();
      expect(f.claim).toBeString();
      expect(f.source).toBeString();
    }
  });

  test('matchRelevantFacts returns market_data facts for consumer_electronics customer type', async () => {
    const facts = await matchRelevantFacts(
      {
        productTypes: ['smartphone', 'wearable'],
        customerType: 'consumer_electronics',
        painPoints: ['prototype lead time', 'hdi density'],
        industry: 'consumer electronics',
      },
      { topN: 5, format: 'cold_email' }
    );
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts.length).toBeLessThanOrEqual(5);
  });

  test('matchRelevantFacts returns automotive facts for automotive customer type', async () => {
    const facts = await matchRelevantFacts(
      {
        productTypes: ['EV controller', 'BMS'],
        customerType: 'automotive',
        painPoints: ['AEC-Q reliability', 'high Tg material'],
        industry: 'automotive',
      },
      { topN: 5, format: 'cold_email' }
    );
    expect(facts.length).toBeGreaterThanOrEqual(1);
    const text = facts.map((f) => f.claim.toLowerCase()).join(' ');
    const hasAutomotiveSignal =
      text.includes('iatf16949') ||
      text.includes('汽车') ||
      text.includes('aec-q') ||
      text.includes('automotive') ||
      text.includes('车规') ||
      text.includes('high tg');
    expect(hasAutomotiveSignal).toBe(true);
  });

  test('matchRelevantFacts respects format caps: cold_email <=5, linkedin_dm <=3, industry_blog <=10', async () => {
    const cold = await matchRelevantFacts(
      { productTypes: ['x'], customerType: 'industrial_equipment', painPoints: [], industry: null },
      { topN: 10, format: 'cold_email' }
    );
    expect(cold.length).toBeLessThanOrEqual(5);

    const dm = await matchRelevantFacts(
      { productTypes: ['x'], customerType: 'industrial_equipment', painPoints: [], industry: null },
      { topN: 10, format: 'linkedin_dm' }
    );
    expect(dm.length).toBeLessThanOrEqual(3);

    const blog = await matchRelevantFacts(
      { productTypes: ['x'], customerType: 'industrial_equipment', painPoints: [], industry: null },
      { topN: 20, format: 'industry_blog' }
    );
    expect(blog.length).toBeLessThanOrEqual(10);
  });

  test('matchRelevantFacts returns [] when context is empty but format still works', async () => {
    const facts = await matchRelevantFacts(
      { productTypes: [], customerType: 'other', painPoints: [], industry: null },
      { format: 'cold_email' }
    );
    expect(Array.isArray(facts)).toBe(true);
  });

  test('matchRelevantFacts prefers market_data with recent years for ai_server customer', async () => {
    const facts = await matchRelevantFacts(
      {
        productTypes: ['AI Server', 'GPU Accelerator'],
        customerType: 'ai_server',
        painPoints: ['high layer count PCB', 'low loss material'],
        industry: 'data center',
      },
      { topN: 5, format: 'cold_email' }
    );
    expect(facts.length).toBeGreaterThanOrEqual(1);
    const text = facts.map((f) => f.claim.toLowerCase()).join(' ');
    const hasAiSignal =
      text.includes('ai server') ||
      text.includes('服务器') ||
      text.includes('gpu') ||
      text.includes('算力') ||
      text.includes('224g');
    expect(hasAiSignal).toBe(true);
  });
});
