import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, pool, tenants, users, companies, contacts, leadScores } from '@pcb/db';

import {
  scoreIndustry,
  scoreKeywords,
  scoreRole,
  scoreSize,
  scoreReachability,
  scoreLead,
  SCORING_MODEL_VERSION,
} from './scoring/index.ts';

// 导入 Hono app（命名导出，不触发 server 启动）
const appPromise = import('./index.ts').then((m) => m.app);

let testTenantId: string;
let testUserId: string;
let testCompanyId: string;
let testContactId: string;

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: 'Scorer Test Tenant', slug: `scorer-test-${Date.now()}` })
    .returning();
  if (!tenant) throw new Error('failed to insert tenant');
  testTenantId = tenant.id;

  const [user] = await db
    .insert(users)
    .values({
      tenantId: testTenantId,
      email: `scorer-test-${Date.now()}@example.com`,
      name: 'Scorer Tester',
      role: 'admin',
    })
    .returning();
  if (!user) throw new Error('failed to insert user');
  testUserId = user.id;
});

afterAll(async () => {
  if (testTenantId) {
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  }
  await pool.end();
});

// ============ 单元测试：5 个维度打分 ============
describe('scoring dimensions (unit)', () => {
  test('scoreIndustry: target industry gets full 30', () => {
    const r = scoreIndustry({ industry: 'industrial_equipment' });
    expect(r.score).toBe(30);
    expect(r.matched).toBe('target');
  });

  test('scoreIndustry: related industry gets 15', () => {
    const r = scoreIndustry({ industry: 'telecom' });
    expect(r.score).toBe(15);
    expect(r.matched).toBe('related');
  });

  test('scoreIndustry: unrelated industry gets 0', () => {
    const r = scoreIndustry({ industry: 'fashion_retail' });
    expect(r.score).toBe(0);
    expect(r.matched).toBe('none');
  });

  test('scoreIndustry: empty industry gets 0', () => {
    const r = scoreIndustry({ industry: null });
    expect(r.score).toBe(0);
  });

  test('scoreKeywords: 6+ hits gets full 25', () => {
    const r = scoreKeywords({
      description: 'We design PCB and PCBA. Our PCB assembly service covers SMT and through-hole. We accept Gerber files.',
      rawPayload: null,
    });
    expect(r.score).toBe(25);
    expect(r.hitCount).toBeGreaterThanOrEqual(6);
    expect(r.matchedKeywords).toContain('pcb');
  });

  test('scoreKeywords: 3-5 hits gets 18', () => {
    const r = scoreKeywords({
      description: 'We make PCB and PCBA. Also do SMT.',
      rawPayload: null,
    });
    expect(r.score).toBe(18);
  });

  test('scoreKeywords: 1-2 hits gets 10', () => {
    const r = scoreKeywords({ description: 'We use PCB sometimes.', rawPayload: null });
    expect(r.score).toBe(10);
  });

  test('scoreKeywords: no hits gets 0', () => {
    const r = scoreKeywords({ description: 'We sell shoes online.', rawPayload: null });
    expect(r.score).toBe(0);
    expect(r.matchedKeywords.length).toBe(0);
  });

  test('scoreKeywords: scans raw_payload fields too', () => {
    const r = scoreKeywords({
      description: '',
      rawPayload: {
        about: 'We do PCB assembly and PCBA fabrication.',
        products: ['SMT service', 'reflow oven'],
      },
    });
    expect(r.hitCount).toBeGreaterThanOrEqual(3);
  });

  test('scoreRole: high authority title gets 20', () => {
    const r = scoreRole({ title: 'Procurement Manager' });
    expect(r.score).toBe(20);
    expect(r.authority).toBe('high');
  });

  test('scoreRole: CTO gets 20', () => {
    const r = scoreRole({ title: 'CTO' });
    expect(r.score).toBe(20);
  });

  test('scoreRole: medium authority gets 10', () => {
    const r = scoreRole({ title: 'Product Manager' });
    expect(r.score).toBe(10);
    expect(r.authority).toBe('medium');
  });

  test('scoreRole: recruiter gets 0 (excluded)', () => {
    const r = scoreRole({ title: 'Technical Recruiter' });
    expect(r.score).toBe(0);
    expect(r.authority).toBe('none');
  });

  test('scoreRole: sales engineer gets 0 (sales wins over engineer)', () => {
    const r = scoreRole({ title: 'Sales Engineer' });
    expect(r.score).toBe(0);
    expect(r.authority).toBe('none');
  });

  test('scoreRole: null contact gets 0', () => {
    const r = scoreRole(null);
    expect(r.score).toBe(0);
  });

  test('scoreSize: 51-200 gets full 15', () => {
    const r = scoreSize({ sizeBucket: '51-200', employeeCount: 120 });
    expect(r.score).toBe(15);
  });

  test('scoreSize: 201-500 gets full 15', () => {
    const r = scoreSize({ sizeBucket: '201-500', employeeCount: 300 });
    expect(r.score).toBe(15);
  });

  test('scoreSize: 11-50 gets 10', () => {
    const r = scoreSize({ sizeBucket: '11-50', employeeCount: 30 });
    expect(r.score).toBe(10);
  });

  test('scoreSize: 5000+ gets 0 (in-house likely)', () => {
    const r = scoreSize({ sizeBucket: '5000+', employeeCount: 8000 });
    expect(r.score).toBe(0);
  });

  test('scoreSize: fallback to employeeCount when no bucket', () => {
    const r = scoreSize({ sizeBucket: null, employeeCount: 250 });
    expect(r.score).toBe(15);
  });

  test('scoreReachability: valid email + LinkedIn gets 10', () => {
    const r = scoreReachability({ emailVerified: 'valid', linkedinUrl: 'https://linkedin.com/in/x' });
    expect(r.score).toBe(10);
  });

  test('scoreReachability: valid email no LinkedIn gets 7', () => {
    const r = scoreReachability({ emailVerified: 'valid', linkedinUrl: null });
    expect(r.score).toBe(7);
  });

  test('scoreReachability: unknown email + LinkedIn gets 5', () => {
    const r = scoreReachability({ emailVerified: 'unknown', linkedinUrl: 'https://linkedin.com/in/y' });
    expect(r.score).toBe(5);
  });

  test('scoreReachability: invalid email gets 0', () => {
    const r = scoreReachability({ emailVerified: 'invalid', linkedinUrl: 'https://linkedin.com/in/z' });
    expect(r.score).toBe(0);
  });

  test('scoreReachability: null contact gets 0', () => {
    const r = scoreReachability(null);
    expect(r.score).toBe(0);
  });
});

// ============ 聚合测试：scoreLead 整体 ============
describe('scoreLead aggregation', () => {
  test('perfect lead (all dimensions max) gets 100 and grade A', () => {
    const r = scoreLead(
      {
        industry: 'hardware',
        description: 'We design PCB, PCBA, do SMT, through-hole, accept Gerber, BOM.',
        rawPayload: null,
        sizeBucket: '51-200',
        employeeCount: 150,
      },
      {
        title: 'Procurement Manager',
        emailVerified: 'valid',
        linkedinUrl: 'https://linkedin.com/in/ceo',
      },
    );
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
    expect(r.modelVersion).toBe(SCORING_MODEL_VERSION);
    expect(r.dimensionBreakdown).toEqual({
      industry: 30,
      pcb_keywords: 25,
      role: 20,
      size: 15,
      reachability: 10,
    });
    expect(r.reason).toContain('[Industry 30/30]');
    expect(r.reason).toContain('[Keywords 25/25]');
  });

  test('poor lead gets low score and grade C', () => {
    const r = scoreLead(
      {
        industry: 'fashion_retail',
        description: 'We sell clothes online.',
        rawPayload: null,
        sizeBucket: '1-10',
        employeeCount: 5,
      },
      { title: 'Marketing Intern', emailVerified: 'invalid', linkedinUrl: null },
    );
    expect(r.score).toBeLessThanOrEqual(20);
    expect(r.grade).toBe('C');
  });

  test('medium lead gets grade B', () => {
    const r = scoreLead(
      {
        industry: 'telecom',
        description: 'We use PCB in our routers.',
        rawPayload: null,
        sizeBucket: '201-500',
        employeeCount: 250,
      },
      { title: 'Product Manager', emailVerified: 'valid', linkedinUrl: null },
    );
    // industry 15 + keywords 10 + role 10 + size 15 + reachability 7 = 57
    expect(r.score).toBe(57);
    expect(r.grade).toBe('B');
  });

  test('threshold A/B: score 75 is A', () => {
    // industry 30 + keywords 25 + role 20 + size 0 + reachability 0 = 75
    const r = scoreLead(
      {
        industry: 'hardware',
        description: 'We design PCB, PCBA, SMT, through-hole, Gerber, BOM, reflow.',
        rawPayload: null,
        sizeBucket: null,
        employeeCount: null,
      },
      { title: 'Procurement Manager', emailVerified: 'invalid', linkedinUrl: null },
    );
    expect(r.score).toBe(75);
    expect(r.grade).toBe('A');
  });
});

// ============ HTTP 端到端测试 ============
describe('Scorer API (e2e)', () => {
  test('GET /health returns 200', async () => {
    const app = await appPromise;
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service: string; status: string };
    expect(body.service).toBe('scorer');
    expect(body.status).toBe('ok');
  });

  test('POST /score/company/:id requires X-Tenant-Id', async () => {
    const app = await appPromise;
    const res = await app.request(`/score/company/${crypto.randomUUID()}`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('POST /score/company/:id returns 404 for unknown company', async () => {
    const app = await appPromise;
    const res = await app.request(`/score/company/${crypto.randomUUID()}`, {
      method: 'POST',
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(404);
  });

  test('POST /score/company/:id creates a score in DB', async () => {
    // 先创建 company + contact
    const [company] = await db
      .insert(companies)
      .values({
        tenantId: testTenantId,
        name: 'ACME PCB Buyer',
        website: 'https://acme-pcb.example.com',
        industry: 'hardware',
        sizeBucket: '51-200',
        employeeCount: 150,
        description: 'We design PCB and PCBA. Our PCB assembly service covers SMT and through-hole. We accept Gerber files and BOM.',
      })
      .returning();
    if (!company) throw new Error('failed to insert company');
    testCompanyId = company.id;

    const [contact] = await db
      .insert(contacts)
      .values({
        tenantId: testTenantId,
        companyId: testCompanyId,
        name: 'Alice Procurement',
        title: 'Procurement Manager',
        email: 'alice@acme-pcb.example.com',
        emailVerified: 'valid',
        linkedinUrl: 'https://linkedin.com/in/alice',
      })
      .returning();
    if (!contact) throw new Error('failed to insert contact');
    testContactId = contact.id;

    // 调用打分 API
    const app = await appPromise;
    const res = await app.request(`/score/company/${testCompanyId}`, {
      method: 'POST',
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      companyId: string;
      score: number;
      grade: string;
      finalGrade: string;
      modelVersion: string;
      dimensionBreakdown: Record<string, number>;
    };

    expect(body.companyId).toBe(testCompanyId);
    expect(body.score).toBe(100);
    expect(body.grade).toBe('A');
    expect(body.finalGrade).toBe('A');
    expect(body.modelVersion).toBe('v1');
    expect(body.dimensionBreakdown).toEqual({
      industry: 30,
      pcb_keywords: 25,
      role: 20,
      size: 15,
      reachability: 10,
    });

    // 验证 DB 写入
    const [row] = await db
      .select()
      .from(leadScores)
      .where(eq(leadScores.companyId, testCompanyId))
      .limit(1);
    expect(row).toBeDefined();
    expect(row!.score).toBe(100);
    expect(row!.grade).toBe('A');
  });

  test('GET /score/company/:id/latest returns latest score', async () => {
    const app = await appPromise;
    const res = await app.request(`/score/company/${testCompanyId}/latest`, {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { companyId: string; grade: string };
    expect(body.companyId).toBe(testCompanyId);
    expect(body.grade).toBe('A');
  });

  test('GET /score/company/:id/latest returns 404 for unknown', async () => {
    const app = await appPromise;
    const res = await app.request(`/score/company/${crypto.randomUUID()}/latest`, {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(404);
  });

  test('POST /score/batch processes multiple companies', async () => {
    // 加一条未打分 company
    const [company2] = await db
      .insert(companies)
      .values({
        tenantId: testTenantId,
        name: 'Another Co',
        industry: 'telecom',
        sizeBucket: '11-50',
        description: 'We use PCB in routers.',
      })
      .returning();
    if (!company2) throw new Error('failed to insert company2');

    const app = await appPromise;
    const res = await app.request('/score/batch', {
      method: 'POST',
      headers: {
        'X-Tenant-Id': testTenantId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ limit: 100 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      processed: number;
      skipped: number;
      results: Array<{ companyId: string; grade: string; status: string }>;
    };
    // 至少处理 1 个（company2），已有的会跳过
    expect(body.processed).toBeGreaterThanOrEqual(1);
    expect(body.results.length).toBeGreaterThanOrEqual(2); // 包含 skipped
    const found = body.results.find((r) => r.companyId === company2.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe('created');
    // telecom 15 + keywords 10 + role 0 + size 10 + reachability 3 = 38 → C
    expect(found!.grade).toBe('C');
  });
});
