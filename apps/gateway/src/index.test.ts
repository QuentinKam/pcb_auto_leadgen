import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, pool, tenants, users, companies, leadScores, auditLogs } from '@pcb/db';

// 导入 Hono app（命名导出，避免触发 default 的 server 启动）
const appPromise = import('./index.ts').then((m) => m.app);

const TEST_TENANT_SLUG = `gateway-test-${Date.now()}`;
let testTenantId: string;
let testUserId: string;
let testCompanyId: string;
let testScoreId: string;

beforeAll(async () => {
  // 准备测试数据：tenant + user + company + lead_score
  const [tenant] = await db
    .insert(tenants)
    .values({ name: 'Gateway Test Tenant', slug: TEST_TENANT_SLUG })
    .returning();
  if (!tenant) throw new Error('failed to insert tenant');
  testTenantId = tenant.id;

  const [user] = await db
    .insert(users)
    .values({
      tenantId: testTenantId,
      email: `gw-test-${Date.now()}@example.com`,
      name: 'GW Tester',
      role: 'sales',
    })
    .returning();
  if (!user) throw new Error('failed to insert user');
  testUserId = user.id;

  const [company] = await db
    .insert(companies)
    .values({
      tenantId: testTenantId,
      name: 'ACME Test Hardware',
      website: 'https://acme-test.example.com',
      industry: 'industrial_equipment',
      sizeBucket: '51-200',
    })
    .returning();
  if (!company) throw new Error('failed to insert company');
  testCompanyId = company.id;

  const [score] = await db
    .insert(leadScores)
    .values({
      tenantId: testTenantId,
      companyId: testCompanyId,
      score: 82,
      grade: 'A',
      finalGrade: 'A',
      reason: 'Industry match + PCB keywords',
      dimensionBreakdown: {
        industry: 28,
        pcb_keywords: 22,
        role: 18,
        size: 12,
        reachability: 10,
      },
      modelVersion: 'v1',
    })
    .returning();
  if (!score) throw new Error('failed to insert lead_score');
  testScoreId = score.id;
});

afterAll(async () => {
  // 清理：删 tenant 自动 cascade 删所有子表
  if (testTenantId) {
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  }
  await pool.end();
});

describe('Gateway API', () => {
  test('GET /health returns 200', async () => {
    const app = await appPromise;
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { service: string; status: string };
    expect(body.service).toBe('gateway');
    expect(body.status).toBe('ok');
  });

  test('GET /api/lead-scores requires X-Tenant-Id header', async () => {
    const app = await appPromise;
    const res = await app.request('/api/lead-scores');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('MISSING_TENANT');
  });

  test('GET /api/lead-scores returns list with pagination', async () => {
    const app = await appPromise;
    const res = await app.request('/api/lead-scores?page=1&pageSize=10', {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ grade: string; finalGrade: string }>;
      total: number;
      page: number;
    };
    expect(body.data.length).toBe(1);
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.data[0]!.grade).toBe('A');
    expect(body.data[0]!.finalGrade).toBe('A');
  });

  test('GET /api/lead-scores?grade=A filters correctly', async () => {
    const app = await appPromise;
    const res = await app.request('/api/lead-scores?grade=A', {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  test('GET /api/lead-scores?grade=C returns empty', async () => {
    const app = await appPromise;
    const res = await app.request('/api/lead-scores?grade=C', {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; total: number };
    expect(body.data.length).toBe(0);
    expect(body.total).toBe(0);
  });

  test('GET /api/lead-scores/:id returns detail', async () => {
    const app = await appPromise;
    const res = await app.request(`/api/lead-scores/${testScoreId}`, {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      score: number;
      grade: string;
      dimensionBreakdown: Record<string, number>;
    };
    expect(body.id).toBe(testScoreId);
    expect(body.score).toBe(82);
    expect(body.grade).toBe('A');
    expect(body.dimensionBreakdown).toEqual({
      industry: 28,
      pcb_keywords: 22,
      role: 18,
      size: 12,
      reachability: 10,
    });
  });

  test('GET /api/lead-scores/:id returns 404 for unknown', async () => {
    const app = await appPromise;
    const fakeId = crypto.randomUUID();
    const res = await app.request(`/api/lead-scores/${fakeId}`, {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(404);
  });

  test('GET /api/lead-scores/:id respects tenant isolation', async () => {
    const app = await appPromise;
    const otherTenantId = crypto.randomUUID();
    const res = await app.request(`/api/lead-scores/${testScoreId}`, {
      headers: { 'X-Tenant-Id': otherTenantId },
    });
    expect(res.status).toBe(404);
  });

  test('PATCH /api/lead-scores/:id/override creates new record + audit log', async () => {
    const app = await appPromise;
    const res = await app.request(`/api/lead-scores/${testScoreId}/override`, {
      method: 'PATCH',
      headers: {
        'X-Tenant-Id': testTenantId,
        'X-User-Id': testUserId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        finalGrade: 'B',
        overrideReason: 'Customer paused PCB sourcing, downgrade to B',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      grade: string;
      finalGrade: string;
      overriddenBy: string;
      overrideReason: string;
    };
    expect(body.grade).toBe('A'); // 原模型分保留
    expect(body.finalGrade).toBe('B'); // 业务员覆盖
    expect(body.overriddenBy).toBe(testUserId);
    expect(body.overrideReason).toContain('paused');

    // 验证 audit_log 写入
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, testScoreId))
      .limit(1);
    expect(audit).toBeDefined();
    expect(audit!.action).toBe('score.override');
    expect(audit!.before).toEqual({ finalGrade: 'A' });
    expect(audit!.after).toEqual({
      finalGrade: 'B',
      overrideReason: 'Customer paused PCB sourcing, downgrade to B',
    });
  });

  test('GET /api/lead-scores returns only the latest record per company after override', async () => {
    const app = await appPromise;
    const res = await app.request('/api/lead-scores?page=1&pageSize=10', {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ grade: string; finalGrade: string; overriddenBy: string | null }>;
      total: number;
    };
    // 同一家公司有模型分 + 覆盖分两条记录，列表只展示最新一条
    expect(body.total).toBe(1);
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.grade).toBe('A'); // 模型分保留
    expect(body.data[0]!.finalGrade).toBe('B'); // 最新状态为覆盖后的 B
    expect(body.data[0]!.overriddenBy).toBe(testUserId);
  });

  test('GET /api/lead-scores?grade filters by the latest finalGrade', async () => {
    const app = await appPromise;
    const [aRes, bRes] = await Promise.all([
      app.request('/api/lead-scores?grade=A', {
        headers: { 'X-Tenant-Id': testTenantId },
      }),
      app.request('/api/lead-scores?grade=B', {
        headers: { 'X-Tenant-Id': testTenantId },
      }),
    ]);
    const aBody = (await aRes.json()) as { total: number };
    const bBody = (await bRes.json()) as { total: number };
    expect(aBody.total).toBe(0); // 覆盖后最新等级为 B，不再计入 A
    expect(bBody.total).toBe(1);
  });

  test('PATCH /api/lead-scores/:id/override requires X-User-Id header', async () => {
    const app = await appPromise;
    const res = await app.request(`/api/lead-scores/${testScoreId}/override`, {
      method: 'PATCH',
      headers: {
        'X-Tenant-Id': testTenantId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        finalGrade: 'C',
        overrideReason: 'Missing user header must be rejected before insert',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('MISSING_USER');
  });

  test('PATCH /api/lead-scores/:id/override rejects missing reason', async () => {
    const app = await appPromise;
    const res = await app.request(`/api/lead-scores/${testScoreId}/override`, {
      method: 'PATCH',
      headers: {
        'X-Tenant-Id': testTenantId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ finalGrade: 'B' }), // 缺 overrideReason
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_BODY');
  });

  test('GET /api/companies returns list', async () => {
    const app = await appPromise;
    const res = await app.request('/api/companies', {
      headers: { 'X-Tenant-Id': testTenantId },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ name: string }>;
    };
    expect(body.data.length).toBe(1);
    expect(body.data[0]!.name).toBe('ACME Test Hardware');
  });

  test('POST /api/tenants creates new tenant', async () => {
    const app = await appPromise;
    const slug = `new-tenant-${Date.now()}`;
    const res = await app.request('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Tenant', slug }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string; plan: string; id: string };
    expect(body.slug).toBe(slug);
    expect(body.plan).toBe('free');
    // 清理
    await db.delete(tenants).where(eq(tenants.id, body.id));
  });

  test('POST /api/tenants rejects invalid slug', async () => {
    const app = await appPromise;
    const res = await app.request('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', slug: 'UPPER Case' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('INVALID_BODY');
  });

  test('GET /unknown returns 404', async () => {
    const app = await appPromise;
    const res = await app.request('/unknown-path');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('NOT_FOUND');
  });
});
