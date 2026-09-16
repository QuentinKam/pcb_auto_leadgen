import { Buffer } from 'node:buffer';
import type { LeadCandidate } from '../types.ts';
import {
  CONTACT_PATHS,
  type IndexEntry,
  extractDomains,
  extractEmails,
  extractItemBusinessFromText,
  extractMailtoLinks,
  htmlToText,
  pickMainDoc,
  selectWebsite,
} from './edgar-select.ts';

/** EDGAR 年报 enrich 结果：公开企业邮箱 + 公司真实官网（无 www 前缀）+ Item 1 业务章节 */
export interface EdgarFilingResult {
  emails: string[];
  website: string | null;
  /** 10-K「Item 1. Business」章节纯文本；10-K/A 修正案等无该章节时为 null */
  businessText: string | null;
}

const DEFAULT_SEC_CONCURRENCY = 3;
/** SEC Fair Access 上限 10 req/s；全局请求间隔 120ms → ≤8.3 req/s */
const SEC_REQUEST_GAP_MS = 120;
/** 10-K 主文档下载上限（解压后字节）：截断而非报错，邮箱/Item 1 通常在文档前部 */
const MAX_FILING_BYTES = 15_000_000;
/** 官网探测页下载上限，防止超大页面撑爆内存 */
const MAX_WEBPAGE_BYTES = 5_000_000;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 全局 SEC 请求节拍器：保证对 www.sec.gov 的请求间隔 */
let lastSecRequestAt = 0;
async function secGate(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, lastSecRequestAt + SEC_REQUEST_GAP_MS - now);
  lastSecRequestAt = now + wait;
  if (wait) await sleep(wait);
}

/** cik-0000897723.edgar.sec.gov → CIK 897723（Archives 路径中不补零） */
function cikFromDomain(domain: string): string | null {
  const m = /^cik-0*(\d+)\.edgar\.sec\.gov$/.exec(domain);
  return m?.[1] ?? null;
}

/**
 * 批量 enrich EDGAR 公司：
 * accession → index.json → 10-K 主文档 → 年报邮箱 + 官网域名 → 官网/contact 页补邮箱。
 * 返回以 EDGAR 虚拟域名为 key 的结果 Map。
 */
export async function enrichEdgarFilings(
  candidates: LeadCandidate[],
  userAgent: string,
  concurrency: number = DEFAULT_SEC_CONCURRENCY
): Promise<Map<string, EdgarFilingResult>> {
  const results = new Map<string, EdgarFilingResult>();
  await runPool(candidates, concurrency, async (candidate) => {
    const result = await enrichOne(candidate, userAgent);
    results.set(candidate.domain, result);
  });
  return results;
}

async function enrichOne(candidate: LeadCandidate, userAgent: string): Promise<EdgarFilingResult> {
  const cik = cikFromDomain(candidate.domain);
  const accession = candidate.accessionDir;
  if (!cik || !accession) return { emails: [], website: null, businessText: null };

  const dir = accession.replace(/-/g, '');
  const baseUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${dir}`;

  let filingHtml: string | null = null;
  try {
    await secGate();
    const idx = (await fetchJson(`${baseUrl}/index.json`, userAgent, 10_000)) as {
      directory: { item: IndexEntry[] };
    };
    const mainDoc = pickMainDoc(idx.directory.item);
    if (!mainDoc) return { emails: [], website: null, businessText: null };

    await secGate();
    filingHtml = await fetchText(`${baseUrl}/${mainDoc}`, userAgent, 20_000, MAX_FILING_BYTES);
  } catch {
    return { emails: [], website: null, businessText: null };
  }

  // 不用 cheerio：parse5 解析数十 MB 的年报 HTML 会瞬时放大内存一个数量级导致 OOM
  const bodyText = htmlToText(filingHtml);
  const mailto = extractMailtoLinks(filingHtml);
  const filingEmails = extractEmails(bodyText, mailto);

  const emailDomains = filingEmails.map((e) => e.split('@')[1] ?? '');
  const website = selectWebsite(extractDomains(filingHtml), emailDomains, candidate.name);
  const businessText = extractItemBusinessFromText(bodyText);

  let siteEmails: string[] = [];
  if (website) siteEmails = await withTimeout(probeWebsite(website), 8_000, []);

  return {
    emails: [...new Set([...filingEmails, ...siteEmails])],
    website,
    businessText,
  };
}

/** 顺序抓官网首页 + contact 路径，命中邮箱即停（同一域，不并发） */
async function probeWebsite(website: string): Promise<string[]> {
  const paths = ['', ...CONTACT_PATHS];
  for (const path of paths) {
    try {
      const html = await fetchText(
        `https://www.${website}/${path}`,
        BROWSER_UA,
        6_000,
        MAX_WEBPAGE_BYTES
      );
      const emails = extractEmails(htmlToText(html), extractMailtoLinks(html));
      if (emails.length) return emails;
    } catch {}
  }
  return [];
}

async function fetchJson(url: string, userAgent: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchText(
  url: string,
  userAgent: string,
  timeoutMs: number,
  maxBytes: number
): Promise<string> {
  // 主文档 gzip 后通常仅 ~230KB，但个别 10-K 解压后可达数十 MB；
  // 流式读取到 maxBytes 即截断并取消响应，避免整份缓冲 + cheerio 解析把内存撑爆
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.length;
      if (received > maxBytes) {
        chunks.push(value.subarray(0, value.length - (received - maxBytes)));
        await reader.cancel().catch(() => {});
        console.warn(`[edgar] response truncated at ${maxBytes} bytes: ${url}`);
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item) await worker(item);
    }
  });
  await Promise.all(runners);
}
