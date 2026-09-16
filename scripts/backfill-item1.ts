#!/usr/bin/env bun
/**
 * 一次性回填脚本：为 EDGAR 采集但缺 Item 1 Business 章节的公司补齐 raw_payload.businessOverview。
 *
 * 背景：14.2【高】任务上线 extractItemBusiness 之前采集的公司（29/49）已落库，
 * 但 raw_payload.businessOverview 为 null。本脚本从 raw_payload.domain 取 CIK，
 * 调 EDGAR submissions API 查最新非 10-K/A 的 10-K，下载主文档 → extractItemBusiness →
 * 合并回 raw_payload。
 *
 * 用法：bun run scripts/backfill-item1.ts [--dry-run]
 * 依赖：apps/collector 的 extractItemBusiness；SEC User-Agent 环境变量
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// ── 1. 加载 env（DATABASE_URL 等）──
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(resolve(REPO_ROOT, 'apps/collector/.env'));
loadEnvFile(resolve(REPO_ROOT, '.env'));
process.env.DATABASE_URL ??= 'postgresql://pcb_user:dev_only_local@localhost:5432/pcb_leadgen';

// SEC 合规 User-Agent（必须 Company Name Email 格式）
const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT ?? 'PCB Leadgen support@example.com';

const DRY_RUN = process.argv.includes('--dry-run');

// ── 2. 动态 import（env 已就位）──
const { db } = await import('@pcb/db');
const { companies } = await import('@pcb/db/schema');
const { eq, sql } = await import('drizzle-orm');
const { extractItemBusiness, pickMainDoc } = await import(
  resolve(REPO_ROOT, 'apps/collector/src/enrich/edgar-select.ts')
);
type IndexEntry = { name: string; type?: string; size?: number };

// ── 3. 常量 ──
const SEC_REQUEST_GAP_MS = 120;
let lastSecRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function secGate(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastSecRequestAt + SEC_REQUEST_GAP_MS - now);
  lastSecRequestAt = now + wait;
  if (wait) await sleep(wait);
}

// ── 4. CIK 从 domain 提取 ──
function cikFromDomain(domain: string): string | null {
  const m = /^cik-0*(\d+)\.edgar\.sec\.gov$/.exec(domain);
  return m?.[1] ?? null;
}

/** CIK 补零到 10 位（EDGAR submissions API 路径格式） */
function padCik(cik: string): string {
  return cik.padStart(10, '0');
}

// ── 5. EDGAR submissions API：取最新非 10-K/A 的 10-K accession ──
interface SubmissionsResponse {
  filings: {
    recent: {
      form: string[];
      accessionNumber: string[];
      filingDate: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
    files: Array<{ name: string; count: number }>;
  };
}

async function findLatest10KAccession(
  cik: string,
  userAgent: string
): Promise<{ accession: string; primaryDoc: string } | null> {
  const paddedCik = padCik(cik);
  const url = `https://data.sec.gov/submissions/CIK${paddedCik}.json`;
  try {
    await secGate();
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`  ✗ submissions API HTTP ${res.status} for CIK ${cik}`);
      return null;
    }
    const data = (await res.json()) as SubmissionsResponse;
    const recent = data.filings?.recent;
    if (!recent?.form) return null;

    for (let i = 0; i < recent.form.length; i++) {
      const form = recent.form[i];
      // 只要原始 10-K，排除 10-K/A 修正案
      if (form === '10-K') {
        return {
          accession: recent.accessionNumber[i],
          primaryDoc: recent.primaryDocument[i],
        };
      }
    }
    return null;
  } catch (err) {
    console.error(`  ✗ submissions API failed for CIK ${cik}: ${err}`);
    return null;
  }
}

// ── 6. 下载 10-K 主文档 → extractItemBusiness ──
async function fetchBusinessText(
  cik: string,
  accession: string,
  primaryDoc: string,
  userAgent: string
): Promise<string | null> {
  const dir = accession.replace(/-/g, '');
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${dir}`;

  try {
    // 先尝试用 submissions API 给的 primaryDocument
    if (primaryDoc) {
      await secGate();
      const html = await fetchText(`${baseUrl}/${primaryDoc}`, userAgent, 20_000);
      const text = extractItemBusiness(html);
      if (text) return text;
    }

    // 回退到 index.json 选主文档
    await secGate();
    const idx = (await fetchJson(`${baseUrl}/index.json`, userAgent, 10_000)) as {
      directory: { item: IndexEntry[] };
    };
    const mainDoc = pickMainDoc(idx.directory.item);
    if (!mainDoc) return null;

    await secGate();
    const html = await fetchText(`${baseUrl}/${mainDoc}`, userAgent, 20_000);
    return extractItemBusiness(html);
  } catch (err) {
    console.error(`  ✗ fetch 10-K failed for CIK ${cik}: ${err}`);
    return null;
  }
}

async function fetchJson(url: string, userAgent: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url: string, userAgent: string, timeoutMs: number): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── 7. 主流程 ──
console.log(`\n=== Item 1 Backfill ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

// 查询缺 businessOverview 的 EDGAR 公司
const rows = await db
  .select({
    id: companies.id,
    name: companies.name,
    domain: sql<string>`raw_payload->>'domain'`,
    rawPayload: companies.rawPayload,
  })
  .from(companies)
  .where(
    sql`(
      raw_payload->>'businessOverview' IS NULL
      OR length(raw_payload->>'businessOverview') <= 100
    ) AND (
      raw_payload->'sources' ? 'edgar'
      OR raw_payload->'sources' ? 'sec'
    )`
  );

console.log(`Found ${rows.length} companies needing backfill\n`);

let success = 0;
let skipped = 0;
let failed = 0;

for (const row of rows) {
  console.log(`▸ ${row.name}`);
  const cik = cikFromDomain(row.domain ?? '');
  if (!cik) {
    console.log(`  ✗ no CIK in domain "${row.domain}"`);
    skipped++;
    continue;
  }

  // 查最新 10-K
  const filing = await findLatest10KAccession(cik, SEC_USER_AGENT);
  if (!filing) {
    console.log(`  ✗ no 10-K found for CIK ${cik}`);
    skipped++;
    continue;
  }
  console.log(`  accession: ${filing.accession}`);

  // 下载 + 提取 Item 1
  const businessText = await fetchBusinessText(
    cik,
    filing.accession,
    filing.primaryDoc,
    SEC_USER_AGENT
  );

  if (!businessText) {
    console.log(`  ✗ extractItemBusiness returned null (10-K/A or no Item 1)`);
    skipped++;
    continue;
  }

  console.log(`  ✓ Item 1 extracted: ${businessText.length} chars`);

  if (DRY_RUN) {
    console.log(`  (dry-run) would update raw_payload.businessOverview`);
    success++;
    continue;
  }

  // 更新 raw_payload
  const newPayload = { ...(row.rawPayload as Record<string, unknown>), businessOverview: businessText };
  await db
    .update(companies)
    .set({ rawPayload: newPayload })
    .where(eq(companies.id, row.id));
  console.log(`  ✓ raw_payload updated`);
  success++;
}

console.log(`\n=== Done ===`);
console.log(`  Success: ${success}`);
console.log(`  Skipped: ${skipped}`);
console.log(`  Failed:  ${failed}`);
console.log(`  Total:   ${rows.length}\n`);

process.exit(0);
