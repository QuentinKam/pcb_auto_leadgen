import 'dotenv/config';
import { z } from 'zod';

/**
 * 采集器配置（环境变量边界校验）
 * - 请求间隔硬下限 2000ms，对应 AGENTS.md §8「请求间隔 ≥2s」合规红线
 * - API Key 缺失时不直接报错，由具体 provider 在启用时报错，便于只跑官网 enrich
 */
const booleanFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v.toLowerCase() !== 'false'));

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TENANT_ID: z.string().default('00000000-0000-0000-0000-000000000000'),
  PORT: z.coerce.number().int().positive().default(3004),
  SCORER_URL: z.string().default(''),

  SEARCH_PROVIDER: z
    .enum([
      'brave',
      'duckduckgo',
      'edgar',
      'companies-house',
      'opencorporates',
      'tavily',
      'serpapi',
    ])
    .default('brave'),
  BRAVE_API_KEY: z.string().default(''),
  SEC_UA: z.string().default('PCBLeadGen contact@yourcompany.com'),
  COMPANIES_HOUSE_API_KEY: z.string().default(''),
  OPENCORPORATES_TOKEN: z.string().default(''),

  BRIGHTDATA_PROXY_URL: z.string().default(''),
  BRIGHTDATA_TOKEN: z.string().default(''),
  BRIGHTDATA_PROXY_USERNAME: z.string().default(''),
  BRIGHTDATA_PROXY_HOST: z.string().default('brd.superproxy.io'),
  BRIGHTDATA_PROXY_PORT: z.string().default('33335'),

  COLLECTOR_MIN_INTERVAL_MS: z.coerce.number().int().min(2000).default(2000),
  COLLECTOR_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  COLLECTOR_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  COLLECTOR_MAX_RESULTS_PER_KEYWORD: z.coerce.number().int().min(1).max(20).default(10),
  // EDGAR 10-K enrich 并发：每路会整份缓冲年报 HTML 并用 cheerio 解析，小内存机器需调低（1.8G 服务器用 2）
  COLLECTOR_EDGAR_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  COLLECTOR_ENRICH_ENABLED: booleanFromEnv(true),
  COLLECTOR_SCORE_ENABLED: booleanFromEnv(true),
});

export type CollectorConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid collector environment: ${issues}`);
  }
  return parsed.data;
}
