import { companies, contacts, db } from '@pcb/db';
import { and, eq, sql } from 'drizzle-orm';
import type { LeadCandidate } from '../types.ts';

export interface PersistResult {
  companyId: string;
  created: boolean;
  contactCreated: boolean;
}

export async function persistCandidate(
  tenantId: string,
  candidate: LeadCandidate
): Promise<PersistResult> {
  const existing = await findExistingCompany(tenantId, candidate);

  if (existing) {
    await db
      .update(companies)
      .set({
        ...enrichmentPatch(candidate),
        rawPayload: { ...toRecord(existing.rawPayload), ...buildRawPayload(candidate) },
        updatedAt: new Date(),
      })
      .where(eq(companies.id, existing.id));

    const contactCreated = await upsertContact(tenantId, existing.id, candidate);
    return { companyId: existing.id, created: false, contactCreated };
  }

  const [inserted] = await db
    .insert(companies)
    .values({
      tenantId,
      name: candidate.name,
      website: candidate.website,
      industry: candidate.industry,
      sizeBucket: candidate.sizeBucket,
      employeeCount: candidate.employeeCount,
      fundingStage: candidate.fundingStage,
      country: candidate.country,
      description: candidate.description,
      rawPayload: buildRawPayload(candidate),
    })
    .returning({ id: companies.id });

  if (!inserted) {
    throw new Error(`Failed to insert company ${candidate.domain}`);
  }

  const contactCreated = await upsertContact(tenantId, inserted.id, candidate);
  return { companyId: inserted.id, created: true, contactCreated };
}

/**
 * 采集产物统一打 demo=false，与 scripts/demo/seed.ts 的演示数据（demo=true）区分。
 */
function buildRawPayload(candidate: LeadCandidate): Record<string, unknown> {
  return {
    demo: false,
    sources: candidate.sources,
    domain: candidate.domain,
    about: candidate.about,
    products: candidate.products,
    services: candidate.services,
    industrySignals: candidate.industrySignals,
    description: candidate.description,
    businessOverview: candidate.businessOverview,
    emails: candidate.emails,
    sourcesByField: candidate.fieldSources,
  };
}

/** 只覆盖非空字段，避免把已有的有效值清空 */
function enrichmentPatch(candidate: LeadCandidate): Partial<typeof companies.$inferInsert> {
  const patch: Partial<typeof companies.$inferInsert> = {};
  if (candidate.industry) patch.industry = candidate.industry;
  if (candidate.sizeBucket) patch.sizeBucket = candidate.sizeBucket;
  if (candidate.employeeCount !== null) patch.employeeCount = candidate.employeeCount;
  if (candidate.fundingStage) patch.fundingStage = candidate.fundingStage;
  if (candidate.country) patch.country = candidate.country;
  if (candidate.description) patch.description = candidate.description;
  return patch;
}

async function findExistingCompany(
  tenantId: string,
  candidate: LeadCandidate
): Promise<{ id: string; rawPayload: unknown } | null> {
  const [byWebsite] = await db
    .select({ id: companies.id, rawPayload: companies.rawPayload })
    .from(companies)
    .where(and(eq(companies.tenantId, tenantId), eq(companies.website, candidate.website)))
    .limit(1);
  if (byWebsite) return byWebsite;

  const [byDomain] = await db
    .select({ id: companies.id, rawPayload: companies.rawPayload })
    .from(companies)
    .where(
      and(
        eq(companies.tenantId, tenantId),
        sql`${companies.rawPayload}->>'domain' = ${candidate.domain}`
      )
    )
    .limit(1);
  return byDomain ?? null;
}

async function upsertContact(
  tenantId: string,
  companyId: string,
  candidate: LeadCandidate
): Promise<boolean> {
  const email = candidate.emails.find((item) => !/^(noreply|no-reply|donotreply)@/i.test(item));
  if (!email) return false;

  const [row] = await db
    .insert(contacts)
    .values({
      tenantId,
      companyId,
      email,
      emailVerified: 'unknown',
      active: true,
    })
    .onConflictDoNothing({ target: [contacts.tenantId, contacts.email] })
    .returning({ id: contacts.id });

  return Boolean(row);
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
