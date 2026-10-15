import { describe, expect, test } from 'bun:test';
import {
  companyCreateSchema,
  contactCreateSchema,
  dimensionBreakdownSchema,
  keywordCreateSchema,
  leadScoreCreateSchema,
  leadScoreListQuerySchema,
  leadScoreOverrideSchema,
  leadScoreResponseSchema,
  listResponseSchema,
  tenantCreateSchema,
  userCreateSchema,
} from './index.ts';

describe('zod schemas parse valid input', () => {
  test('tenantCreateSchema accepts minimal input', () => {
    const parsed = tenantCreateSchema.parse({
      name: 'ACME Trading',
      slug: 'acme-trading',
    });
    expect(parsed.plan).toBe('free'); // 默认值
  });

  test('tenantCreateSchema rejects bad slug', () => {
    expect(() => tenantCreateSchema.parse({ name: 'x', slug: 'UPPER Case' })).toThrow();
  });

  test('userCreateSchema accepts valid email', () => {
    const parsed = userCreateSchema.parse({
      tenantId: crypto.randomUUID(),
      email: 'alice@example.com',
      name: 'Alice',
    });
    expect(parsed.role).toBe('viewer');
  });

  test('userCreateSchema rejects invalid email', () => {
    expect(() =>
      userCreateSchema.parse({
        tenantId: crypto.randomUUID(),
        email: 'not-an-email',
        name: 'Alice',
      })
    ).toThrow();
  });

  test('keywordCreateSchema accepts negative weight (排除词)', () => {
    const parsed = keywordCreateSchema.parse({
      tenantId: crypto.randomUUID(),
      type: 'keyword',
      value: 'recruiting',
      weight: -5,
    });
    expect(parsed.weight).toBe(-5);
  });

  test('companyCreateSchema accepts website URL', () => {
    const parsed = companyCreateSchema.parse({
      tenantId: crypto.randomUUID(),
      name: 'ACME Hardware',
      website: 'https://acme.example.com',
      industry: 'industrial_equipment',
      sizeBucket: '51-200',
      rawPayload: { source: 'apollo', id: '123' },
    });
    expect(parsed.rawPayload?.source).toBe('apollo');
  });

  test('companyCreateSchema rejects bad URL', () => {
    expect(() =>
      companyCreateSchema.parse({
        tenantId: crypto.randomUUID(),
        name: 'x',
        website: 'not-a-url',
      })
    ).toThrow();
  });

  test('contactCreateSchema accepts partial contact', () => {
    const parsed = contactCreateSchema.parse({
      tenantId: crypto.randomUUID(),
      companyId: crypto.randomUUID(),
      name: 'Bob',
      title: 'CTO',
    });
    expect(parsed.emailVerified).toBe('unknown');
  });

  test('leadScoreCreateSchema accepts valid score', () => {
    const parsed = leadScoreCreateSchema.parse({
      tenantId: crypto.randomUUID(),
      companyId: crypto.randomUUID(),
      score: 82,
      grade: 'A',
      reason: 'High industry match + PCB keywords on website',
      dimensionBreakdown: {
        industryFit: 13,
        hardwareProductFit: 18,
        pcbRelevance: 14,
        companyFit: 9,
        demandSignal: 28,
        negativePenalty: 0,
      },
    });
    expect(parsed.modelVersion).toBe('v2');
    expect(parsed.grade).toBe('A');
  });

  test('leadScoreCreateSchema rejects score out of range', () => {
    expect(() =>
      leadScoreCreateSchema.parse({
        tenantId: crypto.randomUUID(),
        companyId: crypto.randomUUID(),
        score: 150, // > 100
        grade: 'A',
        reason: 'x',
        dimensionBreakdown: {
          industryFit: 13,
          hardwareProductFit: 18,
          pcbRelevance: 14,
          companyFit: 9,
          demandSignal: 28,
          negativePenalty: 0,
        },
      })
    ).toThrow();
  });

  test('dimensionBreakdownSchema rejects weight exceeding max', () => {
    expect(() =>
      dimensionBreakdownSchema.parse({
        industryFit: 16, // max 15
        hardwareProductFit: 0,
        pcbRelevance: 0,
        companyFit: 0,
        demandSignal: 0,
        negativePenalty: 0,
      })
    ).toThrow();
  });

  test('leadScoreOverrideSchema requires reason', () => {
    expect(() => leadScoreOverrideSchema.parse({ finalGrade: 'A' })).toThrow(); // 缺 overrideReason
  });

  test('leadScoreListQuerySchema coerces page string to number', () => {
    const parsed = leadScoreListQuerySchema.parse({
      page: '2',
      pageSize: '50',
    });
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(50);
  });

  test('leadScoreListQuerySchema applies defaults', () => {
    const parsed = leadScoreListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });

  test('leadScoreListQuerySchema caps pageSize at 100', () => {
    expect(() => leadScoreListQuerySchema.parse({ pageSize: '500' })).toThrow();
  });
});

describe('listResponseSchema generic helper', () => {
  test('construct list response for leadScore', () => {
    const schema = listResponseSchema(leadScoreResponseSchema);
    const valid = {
      data: [],
      total: 0,
      page: 1,
      pageSize: 20,
    };
    const parsed = schema.parse(valid);
    expect(parsed.total).toBe(0);

    expect(() => schema.parse({ data: [], total: -1, page: 1, pageSize: 20 })).toThrow(); // total < 0
  });
});
