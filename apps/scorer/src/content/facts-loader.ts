import type { IndustryFact } from './types.ts';

interface RawFact {
  id: string;
  claim: string;
  source: string;
  year: number | null;
  cat: string;
}

interface FactsFile {
  generated_at: string;
  facts: RawFact[];
}

const DEFAULT_FACTS_PATH =
  process.env.FACTS_JSON_PATH ??
  new URL(
    '../../../../aigc_base_knowledge/contentforge/workspaces/pcb/registry/facts.json',
    import.meta.url
  ).pathname;

let cachedFacts: IndustryFact[] | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const CATEGORY_PRIORITY: Record<string, number> = {
  market_data: 3,
  decision: 2,
  qa: 2,
  standard: 1,
  param: 1,
  process: 1,
  misc: 0,
};

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  automotive: [
    'automotive',
    'car ',
    'vehicle',
    'electric vehicle',
    'ev ',
    'adas',
    'aec-q',
    'iatf16949',
    '汽车',
    '车规',
  ],
  medical: ['medical', 'healthcare', 'device', 'implant', 'iso13485', '生物兼容', '医疗'],
  aerospace: ['aerospace', 'aviation', 'military', 'defense', 'as9100', '航天', '军工', '国军标'],
  telecom: ['telecom', '5g', 'base station', 'antenna', 'switch', 'router', '通信', '基站'],
  consumer_electronics: [
    'consumer',
    'smartphone',
    'wearable',
    'mobile',
    'phone',
    'tablet',
    '消费电子',
    '可穿戴',
    '手机',
  ],
  industrial_equipment: [
    'industrial',
    'automation',
    'control',
    'motor',
    'sensor',
    '工控',
    '工业设备',
    '传感器',
  ],
  startup_hardware: [
    'startup',
    'prototype',
    'r&d',
    'innovation',
    'start-up',
    '创业',
    '研发',
    '打样',
  ],
  iot: ['iot', 'internet of things', 'smart ', 'edge', '物联网'],
  ai_server: [
    'ai server',
    'gpu',
    'accelerator',
    'high-speed',
    '224g',
    'data center',
    '服务器',
    '算力',
  ],
};

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, '');
}

export async function loadFacts(filePath: string = DEFAULT_FACTS_PATH): Promise<IndustryFact[]> {
  const now = Date.now();
  if (cachedFacts && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedFacts;
  }

  let file: FactsFile;
  try {
    const content = await Bun.file(filePath).text();
    file = JSON.parse(content) as FactsFile;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[facts-loader] Failed to load facts from ${filePath}: ${msg}`);
    cachedFacts = [];
    cacheLoadedAt = now;
    return cachedFacts;
  }

  cachedFacts = file.facts
    .filter((f) => f.cat !== 'template')
    .map((f) => ({
      id: f.id,
      claim: stripMarkdown(f.claim),
      source: f.source,
      year: f.year ?? undefined,
      cat: f.cat,
    })) as Array<IndustryFact & { cat: string }>;
  cacheLoadedAt = now;
  return cachedFacts;
}

function scoreFact(
  fact: IndustryFact & { cat: string },
  context: {
    productTypes: string[];
    customerType: string;
    painPoints: string[];
    industry: string | null | undefined;
  }
): number {
  let score = 0;

  score += CATEGORY_PRIORITY[fact.cat] ?? 0;

  const text = `${fact.claim} ${fact.source}`.toLowerCase();

  const needles: string[] = [];
  needles.push(...context.productTypes.map((s) => s.toLowerCase()));
  needles.push(...context.painPoints.map((s) => s.toLowerCase()));
  if (context.industry) needles.push(context.industry.toLowerCase());

  for (const needle of needles) {
    const trimmed = needle.trim();
    if (!trimmed || trimmed.length < 2) continue;
    if (text.includes(trimmed)) {
      score += 2;
    }
  }

  const industryGroup = INDUSTRY_KEYWORDS[context.customerType];
  if (industryGroup) {
    for (const kw of industryGroup) {
      if (text.includes(kw)) {
        score += 3;
      }
    }
  }

  if (fact.year) {
    score += 1;
    if (fact.year >= 2024) score += 1;
  }

  if (fact.cat === 'market_data') {
    if (/billion|million|亿|万/.test(fact.claim)) {
      score += 1;
    }
  }

  return score;
}

export interface MatchFactsOptions {
  topN?: number;
  format?: 'cold_email' | 'linkedin_dm' | 'industry_blog';
}

export async function matchRelevantFacts(
  context: {
    productTypes: string[];
    customerType: string;
    painPoints: string[];
    industry?: string | null;
  },
  options: MatchFactsOptions = {}
): Promise<IndustryFact[]> {
  const { topN = 5, format = 'cold_email' } = options;
  const allFacts = (await loadFacts()) as Array<IndustryFact & { cat: string }>;

  if (allFacts.length === 0) return [];

  let effectiveTopN = topN;
  let preferredCats: string[] | null = null;

  switch (format) {
    case 'cold_email':
      effectiveTopN = Math.min(topN, 5);
      preferredCats = ['market_data', 'decision', 'qa'];
      break;
    case 'linkedin_dm':
      effectiveTopN = Math.min(topN, 3);
      preferredCats = ['market_data', 'qa'];
      break;
    case 'industry_blog':
      effectiveTopN = Math.min(topN, 10);
      preferredCats = null;
      break;
  }

  const pool = preferredCats ? allFacts.filter((f) => preferredCats.includes(f.cat)) : allFacts;

  const scored = pool
    .map((f) => ({ fact: f, score: scoreFact(f, context) }))
    .sort((a, b) => b.score - a.score);

  const cutoff = scored[0]?.score ?? 0;
  const minAcceptable = cutoff > 0 ? Math.max(1, cutoff * 0.3) : 1;

  return scored
    .filter((s) => s.score >= minAcceptable || cutoff === 0)
    .slice(0, effectiveTopN)
    .map((s) => s.fact);
}
