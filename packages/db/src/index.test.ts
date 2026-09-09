import { describe, test, expect, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, pool, tenants, users, companies, leadScores } from './index.ts';

describe('db smoke test', () => {
  let tenantId: string | undefined;
  let userId: string;
  let companyId: string;

  afterAll(async () => {
    // 仅当 tenantId 还在（cascade 测试没跑或失败）才清理
    if (tenantId) {
      await db.delete(tenants).where(eq(tenants.id, tenantId));
    }
    await pool.end();
  });

  // 三个测试有依赖关系，必须串行
  test.serial('insert tenant + user + company + score (cascade)', async () => {
    // 1. tenant
    const [tenant] = await db
      .insert(tenants)
      .values({ name: 'Test Tenant', slug: `test-${Date.now()}` })
      .returning();
    tenantId = tenant.id;
    expect(tenant.id).toBeDefined();
    expect(tenant.plan).toBe('free');

    // 2. user
    const [user] = await db
      .insert(users)
      .values({ tenantId, email: `sales-${Date.now()}@test.com`, name: 'Alice', role: 'sales' })
      .returning();
    userId = user.id;
    expect(user.role).toBe('sales');

    // 3. company
    const [company] = await db
      .insert(companies)
      .values({
        tenantId,
        name: 'ACME Hardware',
        website: 'https://acme.example.com',
        industry: 'industrial_equipment',
        sizeBucket: '51-200',
      })
      .returning();
    companyId = company.id;
    expect(company.rawPayload).toBeNull();

    // 4. score (规则加权 v1)
    const [score] = await db
      .insert(leadScores)
      .values({
        tenantId,
        companyId,
        contactId: null,
        score: 82,
        grade: 'A',
        finalGrade: 'A',
        reason: 'Industry: industrial_equipment (+30); PCB keyword density high (+22); ...',
        dimensionBreakdown: {
          industry: 28,
          pcb_keywords: 22,
          role: 0,
          size: 12,
          reachability: 20,
        },
        modelVersion: 'v1',
      })
      .returning();
    expect(score.score).toBe(82);
    expect(score.grade).toBe('A');
    expect(score.dimensionBreakdown).toEqual({
      industry: 28,
      pcb_keywords: 22,
      role: 0,
      size: 12,
      reachability: 20,
    });
  });

  test.serial('query back by tenant_id', async () => {
    if (!tenantId) throw new Error('previous test failed to create tenant');
    const rows = await db
      .select()
      .from(companies)
      .where(eq(companies.tenantId, tenantId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toBe('ACME Hardware');
  });

  test.serial('cascade delete tenant cleans up children', async () => {
    if (!tenantId) throw new Error('previous test failed to create tenant');
    await db.delete(tenants).where(eq(tenants.id, tenantId));
    const leftoverUsers = await db
      .select()
      .from(users)
      .where(eq(users.tenantId, tenantId));
    expect(leftoverUsers.length).toBe(0);
    // 标记已删除，让 afterAll 跳过
    tenantId = undefined;
  });
});
