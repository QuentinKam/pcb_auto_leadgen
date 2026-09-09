import { zValidator } from '@hono/zod-validator';
import { companies, contacts, contentDrafts, emailSends } from '@pcb/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../lib/db.ts';
import { type SendJobPayload, sendQueue } from '../lib/queue.ts';
import { senderPool } from '../lib/sender-pool.ts';

const app = new Hono();

const EnqueueSingleSchema = z.object({
  companyId: z.string().uuid(),
  contactId: z.string().uuid(),
  contentDraftId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  variant: z.enum(['A', 'B']).default('A'),
  fromEmail: z.string().email().optional(),
  fromName: z.string().optional(),
  subject: z.string().optional(),
  bodyOverride: z.string().optional(),
});

const EnqueueBatchSchema = z.object({
  items: z.array(EnqueueSingleSchema).min(1).max(500),
  campaignId: z.string().uuid().optional(),
});

const ListQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
  status: z.string().optional(),
  campaignId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
});

type EnqueueSingleInput = z.infer<typeof EnqueueSingleSchema>;

async function loadContactAndCompany(tenantId: string, companyId: string, contactId: string) {
  const [compRows, contRows] = await Promise.all([
    db
      .select({ id: companies.id, name: companies.name, website: companies.website })
      .from(companies)
      .where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId)))
      .limit(1),
    db
      .select({
        id: contacts.id,
        email: contacts.email,
        name: contacts.name,
        companyId: contacts.companyId,
      })
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, contactId)))
      .limit(1),
  ]);
  return { company: compRows[0] ?? null, contact: contRows[0] ?? null };
}

type DraftRow = {
  id: string;
  variant: string | null;
  subject: string | null;
  body: string | null;
};

async function resolveDraftBody(
  tenantId: string,
  draftId: string | undefined,
  variant: 'A' | 'B'
): Promise<{ subject: string | null; body: string; draftIdUsed: string | null }> {
  if (!draftId) return { subject: null, body: '', draftIdUsed: null };
  const rows = (await db
    .select({
      id: contentDrafts.id,
      variant: contentDrafts.variant,
      subject: contentDrafts.subject,
      body: contentDrafts.body,
    })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.tenantId, tenantId),
        eq(contentDrafts.id, draftId),
        eq(contentDrafts.variant, variant)
      )
    )
    .limit(1)) as DraftRow[];
  if (rows.length === 0) {
    const fallback = (await db
      .select({
        id: contentDrafts.id,
        variant: contentDrafts.variant,
        subject: contentDrafts.subject,
        body: contentDrafts.body,
      })
      .from(contentDrafts)
      .where(and(eq(contentDrafts.tenantId, tenantId), eq(contentDrafts.id, draftId)))
      .limit(1)) as DraftRow[];
    const d = fallback[0];
    if (!d) return { subject: null, body: '', draftIdUsed: null };
    return { subject: d.subject ?? null, body: d.body ?? '', draftIdUsed: d.id };
  }
  const d = rows[0] as DraftRow;
  return { subject: d.subject ?? null, body: d.body ?? '', draftIdUsed: d.id };
}

function pickSender(
  explicitFrom: string | undefined,
  explicitName: string | undefined
): { email: string; name: string | null; domain: string } {
  if (explicitFrom) {
    const atIdx = explicitFrom.lastIndexOf('@');
    const domain = atIdx >= 0 ? explicitFrom.slice(atIdx + 1) : '';
    return { email: explicitFrom, name: explicitName ?? null, domain };
  }
  const picked = senderPool.pickNext();
  return {
    email: picked.email,
    name: explicitName ?? picked.name,
    domain: picked.domain,
  };
}

async function createSendRecord(
  tenantId: string,
  input: EnqueueSingleInput & { campaignId?: string }
): Promise<{ id: string; error?: string }> {
  const { company, contact } = await loadContactAndCompany(
    tenantId,
    input.companyId,
    input.contactId
  );
  if (!company || !contact || !contact.email) {
    return { id: '', error: 'Company or Contact not found or missing email' };
  }

  const {
    subject: draftSubject,
    body,
    draftIdUsed,
  } = await resolveDraftBody(tenantId, input.contentDraftId, input.variant);
  const finalSubject = input.subject ?? draftSubject ?? '(no subject)';
  const finalBody = input.bodyOverride ?? body;
  if (!finalBody) {
    return { id: '', error: 'Empty body: provide contentDraftId or bodyOverride' };
  }

  const sender = pickSender(input.fromEmail, input.fromName);
  const toName = contact.name?.trim() || null;

  const insertedRows = await db
    .insert(emailSends)
    .values({
      tenantId,
      campaignId: input.campaignId,
      companyId: company.id,
      contactId: contact.id,
      contentDraftId: draftIdUsed,
      fromEmail: sender.email,
      fromName: sender.name,
      toEmail: contact.email,
      toName,
      sendingDomain: sender.domain,
      subject: finalSubject,
      bodySnapshot: finalBody,
      variant: input.variant,
      status: 'queued',
      retryCount: 0,
    })
    .returning({ id: emailSends.id });

  const inserted = insertedRows[0];
  if (!inserted) return { id: '', error: 'Failed to insert send record' };
  return { id: inserted.id };
}

app.post('/enqueue', zValidator('json', EnqueueBatchSchema), async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);

  const { items, campaignId } = c.req.valid('json');
  const results: { itemIndex: number; emailSendId?: string; error?: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as EnqueueSingleInput;
    const effectiveCampaign = item.campaignId ?? campaignId;
    const { id, error } = await createSendRecord(tenantId, {
      ...item,
      campaignId: effectiveCampaign,
      companyId: item.companyId,
      contactId: item.contactId,
      variant: item.variant,
    });
    if (error) {
      results.push({ itemIndex: i, error });
      continue;
    }
    const payload: SendJobPayload = { tenantId, emailSendId: id };
    try {
      await sendQueue.add(`send:${id}`, payload, {
        jobId: id,
        delay: Number(process.env.MIN_SEND_INTERVAL_MS ?? 1000) * i,
      });
      results.push({ itemIndex: i, emailSendId: id });
    } catch (err) {
      await db
        .update(emailSends)
        .set({ status: 'failed', lastError: err instanceof Error ? err.message : String(err) })
        .where(and(eq(emailSends.tenantId, tenantId), eq(emailSends.id, id)));
      results.push({
        itemIndex: i,
        error: `Queue enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const enqueued = results.filter((r) => r.emailSendId).length;
  return c.json({
    total: items.length,
    enqueued,
    failed: items.length - enqueued,
    results,
  });
});

app.post('/single', zValidator('json', EnqueueSingleSchema), async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);

  const input = c.req.valid('json');
  const { id, error } = await createSendRecord(tenantId, {
    ...input,
    companyId: input.companyId,
    contactId: input.contactId,
    variant: input.variant,
  });
  if (error) return c.json({ error, code: 'CREATE_SEND_FAILED' }, 400);

  const payload: SendJobPayload = { tenantId, emailSendId: id };
  try {
    await sendQueue.add(`send:${id}`, payload, { jobId: id });
  } catch (err) {
    await db
      .update(emailSends)
      .set({ status: 'failed', lastError: err instanceof Error ? err.message : String(err) })
      .where(and(eq(emailSends.tenantId, tenantId), eq(emailSends.id, id)));
    return c.json(
      {
        error: `Queue enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
        code: 'QUEUE_FAILED',
      },
      500
    );
  }

  return c.json(
    {
      id,
      status: 'queued',
    },
    202
  );
});

app.get('/:id', async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);
  const id = c.req.param('id');

  const rows = await db
    .select()
    .from(emailSends)
    .where(and(eq(emailSends.tenantId, tenantId), eq(emailSends.id, id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: 'Not Found', code: 'NOT_FOUND' }, 404);
  return c.json(rows[0]);
});

app.get('/', zValidator('query', ListQuerySchema), async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);
  const { limit, offset, status, campaignId, companyId } = c.req.valid('query');

  const wheres = [eq(emailSends.tenantId, tenantId)];
  if (status) wheres.push(eq(emailSends.status, status));
  if (campaignId) wheres.push(eq(emailSends.campaignId, campaignId));
  if (companyId) wheres.push(eq(emailSends.companyId, companyId));

  const [list, countRows] = await Promise.all([
    db
      .select()
      .from(emailSends)
      .where(and(...wheres))
      .orderBy(desc(emailSends.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ id: emailSends.id })
      .from(emailSends)
      .where(and(...wheres)),
  ]);

  return c.json({
    total: countRows.length,
    limit,
    offset,
    items: list,
  });
});

app.post('/:id/cancel', async (c) => {
  const tenantId = c.req.header('X-Tenant-Id') ?? process.env.TENANT_ID ?? '';
  if (!tenantId) return c.json({ error: 'X-Tenant-Id required', code: 'NO_TENANT' }, 400);
  const id = c.req.param('id');

  const existing = await db
    .select({ id: emailSends.id, status: emailSends.status })
    .from(emailSends)
    .where(and(eq(emailSends.tenantId, tenantId), eq(emailSends.id, id)))
    .limit(1);
  if (existing.length === 0) return c.json({ error: 'Not Found', code: 'NOT_FOUND' }, 404);
  const cur = existing[0];
  if (!cur || !['queued', 'sending'].includes(cur.status ?? '')) {
    return c.json({ error: `Cannot cancel send in status ${cur?.status}`, code: 'BAD_STATE' }, 400);
  }

  try {
    await sendQueue.remove(id);
  } catch {}

  await db
    .update(emailSends)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(emailSends.tenantId, tenantId), eq(emailSends.id, id)));

  return c.json({ id, status: 'cancelled' });
});

export const sendsRoutes = app;
