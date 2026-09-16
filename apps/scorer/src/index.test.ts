import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, pool, tenants, companies, contacts, leadScores } from '@pcb/db';

import {
  scoreIndustry,
  scoreKeywords,
  scoreHardwareFit,
  scoreDemand,
  scoreNegative,
  scoreLead,
  SCORING_MODEL_VERSION,
} from './scoring/index.ts';

// 导入 Hono app（命名导出，不触发 server 启动）
const appPromise = import('./index.ts').then((m) => m.app);

let testTenantId: string;
let testCompanyId: string;
let testContactId: string;

beforeAll(async () => {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: 'Scorer Test Tenant', slug: `scorer-test-${Date.now()}` })
    .returning();
  if (!tenant) throw new Error('failed to insert tenant');
  testTenantId = tenant.id;
});

afterAll(async () => {
  if (testTenantId) {
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  }
  await pool.end();
});

// ============ 单元测试：Industry Fit (0-15) ============
describe('scoreIndustry (v2, 0-15)', () => {
  test('target industry gets full 15', () => {
    const r = scoreIndustry({ industry: 'industrial_automation' });
    expect(r.score).toBe(15);
    expect(r.matched).toBe('target');
  });

  test('telecom is now a target (prompt §7)', () => {
    const r = scoreIndustry({ industry: 'telecom' });
    expect(r.score).toBe(15);
  });

  test('related industry gets 8', () => {
    const r = scoreIndustry({ industry: 'semiconductor' });
    expect(r.score).toBe(8);
    expect(r.matched).toBe('related');
  });

  test('unrelated industry gets 0', () => {
    const r = scoreIndustry({ industry: 'fashion_retail' });
    expect(r.score).toBe(0);
    expect(r.matched).toBe('none');
  });

  test('empty industry gets 0', () => {
    const r = scoreIndustry({ industry: null });
    expect(r.score).toBe(0);
  });
});

// ============ 单元测试：PCB Relevance (0-15) ============
describe('scoreKeywords (v2, PCB relevance 0-15, context-aware)', () => {
  test('many PCB hits gets 15', () => {
    const r = scoreKeywords({
      description: 'We use PCB, PCBA, SMT, through-hole, Gerber and BOM in our controllers.',
      rawPayload: null,
    });
    expect(r.score).toBe(15);
    expect(r.hitCount).toBeGreaterThanOrEqual(6);
    expect(r.manufacturerContext).toBe(false);
  });

  test('manufacturer context zeroes PCB relevance', () => {
    const r = scoreKeywords({
      description: 'We are a PCB manufacturer offering PCB assembly service.',
      rawPayload: null,
    });
    expect(r.score).toBe(0);
    expect(r.manufacturerContext).toBe(true);
  });

  test('outsourcing TO contract manufacturers is buyer language, not manufacturer context', () => {
    const r = scoreKeywords({
      description:
        'Our products are designed in the US; we currently outsource our manufacturing to certain contract manufacturers in Taiwan and Malaysia. We use PCB assembly and SMT lines.',
      rawPayload: null,
    });
    expect(r.manufacturerContext).toBe(false);
    expect(r.score).toBeGreaterThan(0);
  });

  test('self-described contract manufacturer stays manufacturer context', () => {
    const r = scoreKeywords({
      description: 'We are a leading contract manufacturer providing electronics manufacturing services.',
      rawPayload: null,
    });
    expect(r.manufacturerContext).toBe(true);
  });

  test('supply-chain mentions of contract manufacturers stay buyer context', () => {
    const r = scoreKeywords({
      description:
        'The hardware at the core of our products is produced by contract manufacturers. Our primary contract manufacturers include Foxconn, and our contract manufacturers provide us final assembly.',
      rawPayload: null,
    });
    expect(r.manufacturerContext).toBe(false);
  });

  test('no hits gets 0', () => {
    const r = scoreKeywords({ description: 'We sell shoes online.', rawPayload: null });
    expect(r.score).toBe(0);
    expect(r.matchedKeywords.length).toBe(0);
  });

  test('scans raw_payload fields too', () => {
    const r = scoreKeywords({
      description: '',
      rawPayload: {
        about: 'We use PCB assembly and PCBA in our products.',
        products: ['SMT controller', 'reflow controller'],
      },
    });
    expect(r.hitCount).toBeGreaterThanOrEqual(3);
  });
});

// ============ 单元测试：Hardware/Product Fit (0-20) ============
describe('scoreHardwareFit (0-20)', () => {
  test('multiple hardware signals get high score', () => {
    const r = scoreHardwareFit({
      description: 'We build industrial controllers, sensors and IoT devices.',
      rawPayload: null,
    });
    expect(r.score).toBe(16);
    expect(r.matchedTerms).toContain('controller');
  });

  test('no hardware signals gets 0', () => {
    const r = scoreHardwareFit({ description: 'We provide consulting services.', rawPayload: null });
    expect(r.score).toBe(0);
  });
});

// ============ 单元测试：Demand Signal (0-30) ============
describe('scoreDemand (0-30, context-aware)', () => {
  test('Tier 1 supplier search is strong demand', () => {
    const r = scoreDemand({
      description: 'We are looking for a PCB supplier for our new controller.',
      rawPayload: null,
    });
    expect(r.tier).toBe(1);
    expect(r.score).toBeGreaterThanOrEqual(25);
  });

  test('service provider is NOT demand', () => {
    const r = scoreDemand({
      description: 'We help companies find PCB suppliers.',
      rawPayload: null,
    });
    expect(r.score).toBe(0);
    expect(r.tier).toBeNull();
  });

  test('hiring hardware engineer is Tier 2', () => {
    const r = scoreDemand({
      description: 'We are hiring a hardware engineer for our electronics team.',
      rawPayload: null,
    });
    expect(r.tier).toBe(2);
  });

  test('outsourcing our manufacturing is Tier 1 buyer demand', () => {
    const r = scoreDemand({
      description:
        'While our products are largely designed in the U.S., we currently outsource our manufacturing to certain contract manufacturers in Taiwan, Malaysia and Mexico.',
      rawPayload: null,
    });
    expect(r.tier).toBe(1);
    expect(r.score).toBeGreaterThanOrEqual(25);
    expect(r.signals.some((s) => s.signalType === 'outsourcing')).toBe(true);
  });

  test('passive voice "manufactured by contract manufacturers" is Tier 1 demand', () => {
    const r = scoreDemand({
      description:
        'The hardware at the core of our products is produced by contract manufacturers. Our primary contract manufacturers include Hon Hai Precision Industry Co., Ltd.',
      rawPayload: null,
    });
    expect(r.tier).toBe(1);
    expect(r.signals.some((s) => s.signalType === 'outsourcing')).toBe(true);
  });

  test('supplier "outsourced manufacturing partner" is NOT demand (Fabrinet pattern)', () => {
    const r = scoreDemand({
      description:
        'In many cases, we are the sole outsourced manufacturing partner used by our customers for the products that we produce for them.',
      rawPayload: null,
    });
    expect(r.score).toBe(0);
    expect(r.signals.some((s) => s.signalType === 'outsourcing')).toBe(false);
  });

  test('geographic "contract manufacturers in Asia" is Tier 2 demand', () => {
    const r = scoreDemand({
      description: 'We use contract manufacturers in Asia for cost-effective production.',
      rawPayload: null,
    });
    expect(r.tier).toBe(2);
    expect(r.signals.some((s) => s.signalType === 'outsourcing')).toBe(true);
  });
});

// ============ 单元测试：Negative Signal (0-10) ============
describe('scoreNegative (0-10, soft/hard)', () => {
  test('PCB manufacturer is hard negative (excluded)', () => {
    const r = scoreNegative({ description: 'We are a PCB manufacturer.', rawPayload: null });
    expect(r.excluded).toBe(true);
    expect(r.penalty).toBe(10);
  });

  test('company outsourcing to contract manufacturers is NOT excluded (it is a buyer)', () => {
    const r = scoreNegative({
      description:
        'We outsource our manufacturing to third-party contract manufacturers in Mexico and sell telematics devices.',
      rawPayload: null,
    });
    expect(r.excluded).toBe(false);
  });

  test('SaaS is soft negative (penalty only)', () => {
    const r = scoreNegative({ description: 'We are a SaaS company.', rawPayload: null });
    expect(r.excluded).toBe(false);
    expect(r.penalty).toBe(4);
  });

  test('hardware company has no negative', () => {
    const r = scoreNegative({ description: 'We build industrial robots.', rawPayload: null });
    expect(r.penalty).toBe(0);
    expect(r.excluded).toBe(false);
  });
});

// ============ 聚合测试：scoreLead（v2 模型） ============
describe('scoreLead aggregation (v2)', () => {
  const buyerCompany = {
    industry: 'industrial_automation',
    description:
      'We design industrial controllers, sensors and robots. We use PCB, PCBA and SMT in our products. We are launching a new hardware product and are looking for a PCB supplier.',
    rawPayload: {
      products: ['industrial controller', 'sensor module', 'iot gateway'],
      sourcesByField: { products: ['https://acme.example.com/products'] },
    },
    sizeBucket: '51-200',
    employeeCount: 150,
    fundingStage: 'a',
  };

  test('qualified buyer gets grade A and not excluded', () => {
    const r = scoreLead(buyerCompany);
    expect(r.grade).toBe('A');
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.excluded).toBe(false);
    expect(r.buyerFit).toBeGreaterThanOrEqual(45);
    expect(r.demandSignal).toBeGreaterThanOrEqual(25);
    expect(r.dimensionBreakdown.demandSignal).toBe(r.demandSignal);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.modelVersion).toBe(SCORING_MODEL_VERSION);
  });

  test('PCB manufacturer is excluded regardless of score', () => {
    const r = scoreLead({
      industry: 'electronics_manufacturing',
      description: 'We are a PCB manufacturer and EMS provider.',
      rawPayload: null,
      sizeBucket: '51-200',
      employeeCount: 150,
      fundingStage: null,
    });
    expect(r.excluded).toBe(true);
  });

  test('pure software company gets low score and grade C', () => {
    const r = scoreLead({
      industry: 'fashion_retail',
      description: 'We sell clothes online.',
      rawPayload: null,
      sizeBucket: '1-10',
      employeeCount: 5,
      fundingStage: null,
    });
    expect(r.grade).toBe('C');
    expect(r.score).toBeLessThan(50);
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

  test('POST /score/company/:id creates a v2 score in DB', async () => {
    const [company] = await db
      .insert(companies)
      .values({
        tenantId: testTenantId,
        name: 'ACME PCB Buyer',
        website: 'https://acme-pcb.example.com',
        industry: 'industrial_automation',
        sizeBucket: '51-200',
        employeeCount: 150,
        fundingStage: 'a',
        description:
          'We design industrial controllers and sensors. We use PCB, PCBA and SMT. We are launching a new hardware product.',
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
      excluded: boolean;
      evidence: unknown[];
      dimensionBreakdown: Record<string, number>;
    };

    expect(body.companyId).toBe(testCompanyId);
    expect(body.modelVersion).toBe('v2');
    expect(body.excluded).toBe(false);
    expect(Array.isArray(body.evidence)).toBe(true);
    expect(body.dimensionBreakdown.industryFit).toBeGreaterThanOrEqual(0);
    expect(body.dimensionBreakdown.demandSignal).toBeGreaterThanOrEqual(0);

    const [row] = await db
      .select()
      .from(leadScores)
      .where(eq(leadScores.companyId, testCompanyId))
      .limit(1);
    expect(row).toBeDefined();
    expect(row!.modelVersion).toBe('v2');
  });

  test('GET /score/company/:id/latest returns latest score', async () => {
    const app = await appPromise;
    const res = await app.request(`/score/company/${testCompanyId}/latest`, {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { companyId: string; modelVersion: string };
    expect(body.companyId).toBe(testCompanyId);
    expect(body.modelVersion).toBe('v2');
  });

  test('GET /score/company/:id/latest returns 404 for unknown', async () => {
    const app = await appPromise;
    const res = await app.request(`/score/company/${crypto.randomUUID()}/latest`, {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(404);
  });

  test('POST /score/batch processes multiple companies', async () => {
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
    expect(body.processed).toBeGreaterThanOrEqual(1);
    expect(body.results.length).toBeGreaterThanOrEqual(2);
    const found = body.results.find((r) => r.companyId === company2.id);
    expect(found).toBeDefined();
    expect(found!.status).toBe('created');
  });
});
