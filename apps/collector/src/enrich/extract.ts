import * as cheerio from 'cheerio';
import { inferIndustrySignals } from './infer.ts';

export interface SiteSignals {
  title: string | null;
  description: string | null;
  about: string | null;
  products: string[];
  services: string[];
  industrySignals: string[];
  emails: string[];
  text: string;
  wordCount: number;
  /** 字段 → 来源 URL 列表，用于 Signal-level Evidence 的 sourceUrl 绑定 */
  fieldSources: Record<string, string[]>;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const EMAIL_VALID_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const ABOUT_RE =
  /(we are|we're|our (company|mission|team|story)|founded in|we (design|build|manufactur|develop|provide))/i;

const PRODUCT_HINTS = [
  'board',
  'module',
  'sensor',
  'controller',
  'device',
  'system',
  'solution',
  'panel',
  'drive',
  'inverter',
  'probe',
];

export function emptySignals(): SiteSignals {
  return {
    title: null,
    description: null,
    about: null,
    products: [],
    services: [],
    industrySignals: [],
    emails: [],
    text: '',
    wordCount: 0,
    fieldSources: {},
  };
}

export function extractSignals(html: string, url: string): SiteSignals {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, template').remove();

  const title = normalizeText($('title').first().text()) || null;
  const description =
    normalizeText($('meta[name="description"]').attr('content') ?? '') ||
    normalizeText($('meta[property="og:description"]').attr('content') ?? '') ||
    null;

  const text = normalizeText($('body').text());
  const emails = extractEmails($, text);

  const about = extractAbout($);
  const products = extractList($, 'product');
  const services = extractList($, 'service');

  return {
    title,
    description,
    about,
    products,
    services,
    industrySignals: inferIndustrySignals(text),
    emails,
    text,
    wordCount: text ? text.split(/\s+/).length : 0,
    fieldSources: buildFieldSources({ description, about, products, services, emails }, url),
  };
}

/** 把每个非空字段映射到当前页面 URL（Signal-level Evidence 的来源） */
function buildFieldSources(
  fields: {
    description: string | null;
    about: string | null;
    products: string[];
    services: string[];
    emails: string[];
  },
  url: string
): Record<string, string[]> {
  const sources: Record<string, string[]> = {};
  if (fields.description) sources.description = [url];
  if (fields.about) sources.about = [url];
  if (fields.products.length > 0) sources.products = [url];
  if (fields.services.length > 0) sources.services = [url];
  if (fields.emails.length > 0) sources.emails = [url];
  return sources;
}

/** 合并两次抓取结果：标量取首个非空，数组去重合并，文本累加 */
export function mergeSignals(a: SiteSignals, b: SiteSignals): SiteSignals {
  return {
    title: a.title ?? b.title,
    description: a.description ?? b.description,
    about: a.about ?? b.about,
    products: unique([...a.products, ...b.products]),
    services: unique([...a.services, ...b.services]),
    industrySignals: unique([...a.industrySignals, ...b.industrySignals]),
    emails: unique([...a.emails, ...b.emails]),
    text: [a.text, b.text].filter(Boolean).join(' '),
    wordCount: a.wordCount + b.wordCount,
    fieldSources: mergeFieldSources(a.fieldSources, b.fieldSources),
  };
}

function mergeFieldSources(
  a: Record<string, string[]>,
  b: Record<string, string[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[key] = unique([...(a[key] ?? []), ...(b[key] ?? [])]);
  }
  return out;
}

function extractAbout($: cheerio.CheerioAPI): string | null {
  let best: string | null = null;
  $('p, [class*=about] li, [class*=about] p').each((_, el) => {
    const value = normalizeText($(el).text());
    if (value.length < 80 || value.length > 800) return;
    if (!ABOUT_RE.test(value)) return;
    if (!best || value.length > best.length) best = value;
  });
  return best;
}

function extractList($: cheerio.CheerioAPI, kind: 'product' | 'service'): string[] {
  const items = new Set<string>();
  const selectors = [`[class*=${kind}] li`, `[class*=${kind}] h2`, `[class*=${kind}] h3`];
  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const value = normalizeText($(el).text());
      if (value.length < 3 || value.length > 60) return;
      if (kind === 'product' && !PRODUCT_HINTS.some((hint) => value.toLowerCase().includes(hint))) {
        return;
      }
      items.add(value);
    });
  }
  return [...items].slice(0, 10);
}

function extractEmails($: cheerio.CheerioAPI, text: string): string[] {
  const found = new Set<string>();
  for (const match of text.match(EMAIL_RE) ?? []) {
    found.add(match.toLowerCase());
  }
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const email = href
      .replace(/^mailto:/i, '')
      .split('?')[0]
      ?.trim()
      .toLowerCase();
    if (email && EMAIL_VALID_RE.test(email)) found.add(email);
  });
  return [...found]
    .filter((email) => !/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(email))
    .slice(0, 10);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
