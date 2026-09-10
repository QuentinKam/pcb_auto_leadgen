#!/usr/bin/env bun
/**
 * 演示前自检：逐项确认「四个 Tab 都有数据 + 服务都在」
 *
 * 用法：bun run scripts/demo/check.ts
 * 退出码：0 全部通过；1 有阻塞项（演示会翻车）
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');

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
loadEnvFile(resolve(REPO_ROOT, 'apps/mailer/.env'));
// dashboard 的 tenant 必须和库里数据一致，直接读前端 .env 校验
const dashboardEnv = existsSync(resolve(REPO_ROOT, 'apps/dashboard/.env'))
  ? readFileSync(resolve(REPO_ROOT, 'apps/dashboard/.env'), 'utf8')
  : '';
const DASHBOARD_TENANT = /VITE_TENANT_ID=(.*)/.exec(dashboardEnv)?.[1]?.trim() ?? '';
const DASHBOARD_USER = /VITE_USER_ID=(.*)/.exec(dashboardEnv)?.[1]?.trim() ?? '';

const TENANT_ID = process.env.TENANT_ID ?? '00000000-0000-0000-0000-000000000000';
const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3001';
const HEADERS = { 'X-Tenant-Id': TENANT_ID };

type Level = 'ok' | 'warn' | 'fail';
const results: Array<{ level: Level; label: string; detail: string }> = [];

function record(level: Level, label: string, detail: string): void {
  results.push({ level, label, detail });
}

async function getJson<T>(path: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const res = await fetch(`${GATEWAY}${path}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function httpStatus(url: string, timeoutMs = 4000): Promise<number> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status;
  } catch {
    return 0;
  }
}

// ── 1. 服务存活 ──
const services: Array<[string, string]> = [
  ['gateway :3001', 'http://localhost:3001/health'],
  ['scorer :3002', 'http://localhost:3002/health'],
  ['mailer :3003', 'http://localhost:3003/health'],
  ['dashboard :5173', 'http://localhost:5173/'],
];
for (const [label, url] of services) {
  const status = await httpStatus(url);
  if (status === 200) record('ok', `服务 ${label}`, 'HTTP 200');
  else record('fail', `服务 ${label}`, status === 0 ? '连不上（进程没起）' : `HTTP ${status}`);
}

// ── 2. 租户一致性（看板全空的头号原因）──
if (!DASHBOARD_TENANT) {
  record('fail', '前端租户配置', 'apps/dashboard/.env 缺 VITE_TENANT_ID');
} else if (DASHBOARD_TENANT !== TENANT_ID) {
  record(
    'fail',
    '前端租户配置',
    `VITE_TENANT_ID=${DASHBOARD_TENANT} 与数据租户 ${TENANT_ID} 不一致 → 看板会全空`
  );
} else {
  record('ok', '前端租户配置', `VITE_TENANT_ID=${DASHBOARD_TENANT} 与数据一致`);
}
if (!DASHBOARD_USER) {
  record('warn', '前端用户配置', 'VITE_USER_ID 为空 → 人工覆盖等级会报 Missing X-User-Id');
} else {
  record('ok', '前端用户配置', `VITE_USER_ID=${DASHBOARD_USER}`);
}

// ── 3. Tab 1 线索看板 ──
interface Page<T> {
  total: number;
  data: T[];
}
const leads = await getJson<Page<{ finalGrade: string }>>('/api/lead-scores?page=1&pageSize=100');
if (!leads) {
  record('fail', 'Tab1 线索看板', '接口无响应');
} else if (leads.total === 0) {
  record('fail', 'Tab1 线索看板', '0 条线索 → 空屏，先跑 seed.ts');
} else {
  const grades = leads.data.reduce<Record<string, number>>((acc, r) => {
    acc[r.finalGrade] = (acc[r.finalGrade] ?? 0) + 1;
    return acc;
  }, {});
  const hasAll = grades.A && grades.B && grades.C;
  record(
    hasAll ? 'ok' : 'warn',
    'Tab1 线索看板',
    `${leads.total} 条 · A=${grades.A ?? 0} B=${grades.B ?? 0} C=${grades.C ?? 0}`
  );
}

// ── 4. Tab 2 内容审核（画像 + 草稿）──
const companies = await getJson<Page<{ id: string; name: string }>>(
  '/api/companies?page=1&pageSize=1'
);
const firstCompany = companies?.data?.[0];
if (!firstCompany) {
  record('fail', 'Tab2 内容审核', '公司列表为空 → 左侧列表空屏');
} else {
  const profile = await getJson<{ businessSummary: string }>(
    `/api/content/profile/${firstCompany.id}`
  );
  if (profile?.businessSummary) {
    record('ok', 'Tab2 客户画像', `「${firstCompany.name}」已有画像，点开秒显示`);
  } else {
    record(
      'fail',
      'Tab2 客户画像',
      `「${firstCompany.name}」无画像 → 首屏会提示"请先点击重新画像"`
    );
  }
  const drafts = await getJson<Array<{ format: string; variant: string }>>(
    `/api/content/drafts/${firstCompany.id}`
  );
  if (drafts && drafts.length > 0) {
    const hasAB = drafts.some((d) => d.variant === 'A') && drafts.some((d) => d.variant === 'B');
    record(hasAB ? 'ok' : 'warn', 'Tab2 内容草稿', `${drafts.length} 篇（含 A/B 对照）`);
  } else {
    record('fail', 'Tab2 内容草稿', '首屏公司无草稿 → 右侧空屏');
  }

  // 发信前置条件：必须有 active + 有邮箱的联系人
  const contactRes = await fetch(`${GATEWAY}/api/contacts/first-by-company/${firstCompany.id}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (contactRes?.ok) {
    const contact = (await contactRes.json()) as { email: string; name: string };
    record('ok', '真实发信前置', `收件人 ${contact.name} <${contact.email}>`);
  } else {
    record(
      'fail',
      '真实发信前置',
      `取联系人失败（HTTP ${contactRes?.status ?? 0}）→「批准并发信」会报错`
    );
  }
}

// ── 5. Tab 3 发送看板 ──
const stats = await getJson<{
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalReplied: number;
  openRate: number;
  bounceRate: number;
}>('/api/mails/stats');
if (!stats || stats.totalSent === 0) {
  record('fail', 'Tab3 发送看板', '无发送数据 → 统计卡全是 0');
} else {
  record(
    'ok',
    'Tab3 发送看板',
    `发送 ${stats.totalSent} · 送达 ${stats.totalDelivered} · 打开率 ${(stats.openRate * 100).toFixed(0)}% · 回复 ${stats.totalReplied} · 退信率 ${(stats.bounceRate * 100).toFixed(1)}%`
  );
}
const campaigns = await getJson<{ total: number }>('/api/mails/campaigns?limit=50');
record(
  campaigns && campaigns.total > 0 ? 'ok' : 'fail',
  'Tab3 活动列表',
  campaigns ? `${campaigns.total} 个活动` : '接口无响应'
);
const warmup = await getJson<{
  reputationScore: number;
  todaysEntry: { targetCount: number } | null;
  todaySent: number;
  seedPool: { totalAvailable: number };
}>('/api/mails/warmup/status');
if (!warmup) {
  record('fail', 'Tab3 域名预热卡', 'warmup 接口无响应');
} else {
  const score = warmup.reputationScore;
  record(
    score >= 60 ? 'ok' : 'warn',
    'Tab3 域名预热卡',
    `reputation ${score}/100 · 今日 ${warmup.todaySent}/${warmup.todaysEntry?.targetCount ?? 0} · 种子池 ${warmup.seedPool.totalAvailable}`
  );
}

// ── 6. Tab 4 发送记录 ──
const sends = await getJson<{ total: number }>('/api/mails/sends?limit=1');
record(
  sends && sends.total > 0 ? 'ok' : 'fail',
  'Tab4 发送记录',
  sends ? `${sends.total} 条明细` : '接口无响应'
);

// ── 输出 ──
const ICON: Record<Level, string> = { ok: '  OK  ', warn: ' WARN ', fail: ' FAIL ' };
console.log('');
console.log('  演示就绪自检');
console.log(`  ${'─'.repeat(78)}`);
for (const r of results) {
  console.log(`  [${ICON[r.level]}] ${r.label.padEnd(18, ' ')} ${r.detail}`);
}
console.log(`  ${'─'.repeat(78)}`);

const fails = results.filter((r) => r.level === 'fail');
const warns = results.filter((r) => r.level === 'warn');
if (fails.length === 0) {
  console.log(`  结论：可以演示（${warns.length} 条提醒）`);
  console.log('');
  process.exit(0);
}
console.log(`  结论：${fails.length} 项阻塞，先修再演示`);
console.log('');
process.exit(1);
