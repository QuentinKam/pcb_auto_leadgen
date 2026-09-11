import { getSearchClient } from './clients/search/factory.ts';
import { type CollectorConfig, loadConfig } from './config.ts';
import { fetchRenderedHtml } from './enrich/browser.ts';
import { type CrawlOutcome, crawlWebsites } from './enrich/crawl.ts';
import { type SiteSignals, emptySignals, extractSignals, mergeSignals } from './enrich/extract.ts';
import { inferEmployeeCount, inferFundingStage, inferIndustry } from './enrich/infer.ts';
import { CircuitBreaker } from './net/circuit-breaker.ts';
import { HttpClient } from './net/http.ts';
import { resolveProxyUrl } from './net/proxy.ts';
import { DomainThrottle } from './net/throttle.ts';
import {
  buildWebsiteUrl,
  cleanCompanyName,
  domainFromUrl,
  employeeCountToSizeBucket,
  isLikelyCompanyDomain,
} from './store/normalize.ts';
import { persistCandidate } from './store/persist.ts';
import type { LeadCandidate } from './types.ts';

/** 官网正文少于该词数时，视为强 JS 渲染，降级 Playwright */
const THIN_TEXT_WORDS = 60;

export interface RunCollectOptions {
  keywords: string[];
  country?: string | null;
  limitPerKeyword?: number;
  enrich?: boolean;
  score?: boolean;
}

export interface RunCollectSummary {
  tenantId: string;
  keywords: string[];
  searchHits: number;
  candidates: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  enrichedSites: number;
  /** scorer 处理的条数；未启用或无 SCORER_URL 时为 null */
  scored: number | null;
  errors: string[];
  durationMs: number;
}

export async function runCollect(
  options: RunCollectOptions,
  config: CollectorConfig = loadConfig()
): Promise<RunCollectSummary> {
  const startedAt = Date.now();
  const errors: string[] = [];
  const proxyUrl = resolveProxyUrl();

  const http = new HttpClient({
    throttle: new DomainThrottle({ minIntervalMs: config.COLLECTOR_MIN_INTERVAL_MS }),
    breaker: new CircuitBreaker(),
    proxyUrl,
    timeoutMs: config.COLLECTOR_REQUEST_TIMEOUT_MS,
    retries: config.COLLECTOR_MAX_RETRIES,
  });
  const search = getSearchClient(config, http);
  const limitPerKeyword = options.limitPerKeyword ?? config.COLLECTOR_MAX_RESULTS_PER_KEYWORD;

  const candidates = new Map<string, LeadCandidate>();
  let searchHits = 0;

  for (const keyword of options.keywords) {
    try {
      const hits = await search.search({
        keyword,
        country: options.country ?? null,
        count: limitPerKeyword,
      });
      searchHits += hits.length;
      for (const hit of hits) {
        const domain = domainFromUrl(hit.url);
        if (!domain || !isLikelyCompanyDomain(domain) || candidates.has(domain)) continue;
        candidates.set(domain, {
          name: cleanCompanyName(hit.title),
          domain,
          website: buildWebsiteUrl(domain),
          description: hit.snippet,
          industry: null,
          country: options.country ?? null,
          employeeCount: null,
          sizeBucket: null,
          fundingStage: null,
          about: null,
          products: [],
          services: [],
          industrySignals: [],
          emails: [],
          text: '',
          sources: ['brave'],
        });
      }
    } catch (error) {
      errors.push(`search "${keyword}" failed: ${messageOf(error)}`);
    }
  }

  const list = [...candidates.values()];
  const enrichEnabled = options.enrich ?? config.COLLECTOR_ENRICH_ENABLED;
  let enrichedSites = 0;

  if (enrichEnabled && list.length > 0) {
    const outcomes = await safeCrawl(list, config, proxyUrl, errors);
    for (const candidate of list) {
      let signals = outcomes.get(candidate.domain)?.signals ?? emptySignals();

      if (signals.wordCount < THIN_TEXT_WORDS) {
        const html = await fetchRenderedHtml(candidate.website, {
          timeoutMs: config.COLLECTOR_REQUEST_TIMEOUT_MS,
        });
        if (html) signals = mergeSignals(signals, extractSignals(html, candidate.website));
      }

      if (signals.wordCount > 0) enrichedSites += 1;
      applySignals(candidate, signals);
    }
  }

  for (const candidate of list) finalizeCandidate(candidate);

  let companiesCreated = 0;
  let companiesUpdated = 0;
  let contactsCreated = 0;
  for (const candidate of list) {
    try {
      const result = await persistCandidate(config.TENANT_ID, candidate);
      if (result.created) companiesCreated += 1;
      else companiesUpdated += 1;
      if (result.contactCreated) contactsCreated += 1;
    } catch (error) {
      errors.push(`persist ${candidate.domain} failed: ${messageOf(error)}`);
    }
  }

  const scoreEnabled = options.score ?? config.COLLECTOR_SCORE_ENABLED;
  const scored = scoreEnabled ? await triggerScoring(config, errors) : null;

  return {
    tenantId: config.TENANT_ID,
    keywords: options.keywords,
    searchHits,
    candidates: list.length,
    companiesCreated,
    companiesUpdated,
    contactsCreated,
    enrichedSites,
    scored,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

async function safeCrawl(
  list: LeadCandidate[],
  config: CollectorConfig,
  proxyUrl: string | null,
  errors: string[]
): Promise<Map<string, CrawlOutcome>> {
  try {
    return await crawlWebsites(
      list.map((candidate) => ({ domain: candidate.domain, url: candidate.website })),
      {
        minIntervalMs: config.COLLECTOR_MIN_INTERVAL_MS,
        proxyUrl,
        onWarn: (message) => errors.push(message),
      }
    );
  } catch (error) {
    errors.push(`website crawl failed: ${messageOf(error)}`);
    return new Map();
  }
}

/** 触发 scorer 批量打分，让采集到的线索出现在看板；scorer 会跳过已打分的公司 */
async function triggerScoring(config: CollectorConfig, errors: string[]): Promise<number | null> {
  if (!config.SCORER_URL) return null;
  try {
    const response = await fetch(`${config.SCORER_URL}/score/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': config.TENANT_ID },
      body: JSON.stringify({ limit: 500 }),
    });
    if (!response.ok) {
      errors.push(`scoring failed: HTTP ${response.status}`);
      return null;
    }
    const data = (await response.json()) as { processed?: number };
    return data.processed ?? 0;
  } catch (error) {
    errors.push(`scoring failed: ${messageOf(error)}`);
    return null;
  }
}

function applySignals(candidate: LeadCandidate, signals: SiteSignals): void {
  candidate.about = candidate.about ?? signals.about;
  candidate.description = signals.description ?? candidate.description;
  candidate.products = unique([...candidate.products, ...signals.products]);
  candidate.services = unique([...candidate.services, ...signals.services]);
  candidate.industrySignals = unique([...candidate.industrySignals, ...signals.industrySignals]);
  candidate.emails = unique([...candidate.emails, ...signals.emails]);
  candidate.text = [candidate.text, signals.text].filter(Boolean).join(' ');
}

/** 用官网文本做规则推断（行业 / 规模 / 融资阶段） */
function finalizeCandidate(candidate: LeadCandidate): void {
  candidate.industry = candidate.industry ?? inferIndustry(candidate.text);
  candidate.employeeCount = candidate.employeeCount ?? inferEmployeeCount(candidate.text);
  candidate.sizeBucket = candidate.sizeBucket ?? employeeCountToSizeBucket(candidate.employeeCount);
  candidate.fundingStage = candidate.fundingStage ?? inferFundingStage(candidate.text);
  candidate.about = candidate.about ?? candidate.description;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
