/**
 * LLM 调用封装
 *
 * 支持两种 provider：
 *   - anthropic（默认）：Anthropic Messages API
 *   - openai_compatible：OpenAI 兼容接口（DeepSeek、通义、智谱等）
 *
 * 所有调用统一走「超时 → 错误分类 → 可重试则退避重试 → 仍失败抛 LLMError」。
 * LLM 是全链路唯一的外部不确定依赖：不加超时会把上游 HTTP 请求无限挂住，
 * 网关侧 60s 兜底只能断开连接，scorer 里的请求仍会继续挂着。
 *
 * 环境变量：
 *   LLM_PROVIDER        — anthropic | openai_compatible，默认 anthropic
 *   LLM_TIMEOUT_MS      — 单次调用墙钟上限（毫秒），默认 60000
 *   LLM_MAX_RETRIES     — 失败重试次数（不含首次调用），默认 2
 *
 *   Anthropic:
 *     ANTHROPIC_API_KEY  — API Key
 *     ANTHROPIC_MODEL    — 模型名，默认 claude-sonnet-4-5
 *     ANTHROPIC_BASE_URL — 默认 https://api.anthropic.com
 *
 *   OpenAI 兼容（DeepSeek 等）:
 *     OPENAI_API_KEY     — API Key
 *     OPENAI_MODEL       — 模型名，如 deepseek-chat
 *     OPENAI_BASE_URL    — 如 https://api.deepseek.com
 */

type LLMProvider = 'anthropic' | 'openai_compatible';

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_BASE_URL_ANTHROPIC = 'https://api.anthropic.com';
const ANTHROPIC_API_VERSION = '2023-06-01';

/** 单次调用墙钟上限。行业博客 3000 tokens 生成实测 20-40s，60s 留足余量 */
const DEFAULT_TIMEOUT_MS = 60_000;
/** 首次调用之外的重试次数 */
const DEFAULT_MAX_RETRIES = 2;
/** 退避上限，避免过大的 Retry-After 把 worker 卡死 */
const MAX_BACKOFF_MS = 30_000;

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 覆盖全局超时（毫秒） */
  timeoutMs?: number;
  /** 覆盖全局重试次数 */
  maxRetries?: number;
}

/**
 * 错误分类：
 * - 可重试：超时 / 网络抖动 / 限流 / 服务端错误
 * - 终止：鉴权失败、参数错误、额度问题 —— 重试只会得到同样的结果
 */
export type LLMErrorKind =
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'server'
  | 'auth'
  | 'client'
  | 'parse';

export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfter?: string | null
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

/** 单次调用墙钟上限（毫秒） */
function getTimeoutMs(override?: number): number {
  if (override !== undefined) return override;
  const raw = Number(process.env.LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** 失败重试次数（不含首次调用） */
function getMaxRetries(override?: number): number {
  if (override !== undefined) return override;
  const raw = Number(process.env.LLM_MAX_RETRIES);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MAX_RETRIES;
}

/** 获取当前 provider，默认 anthropic */
function getProvider(): LLMProvider {
  const p = process.env.LLM_PROVIDER?.toLowerCase();
  if (p === 'openai_compatible' || p === 'openai') return 'openai_compatible';
  return 'anthropic';
}

/** 读取当前 provider 的 API key */
function getApiKey(provider: LLMProvider): string {
  if (provider === 'openai_compatible') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is not set');
    return key;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  return key;
}

/** 读取当前 provider 的模型名 */
function getModel(provider: LLMProvider, override?: string): string {
  if (override) return override;
  if (provider === 'openai_compatible') {
    return process.env.OPENAI_MODEL ?? 'deepseek-chat';
  }
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
}

/** 读取当前 provider 的 base URL */
function getBaseUrl(provider: LLMProvider): string {
  if (provider === 'openai_compatible') {
    return process.env.OPENAI_BASE_URL ?? 'https://api.deepseek.com';
  }
  return process.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE_URL_ANTHROPIC;
}

/** 获取当前生效的模型名（供路由层记录到 DB） */
export function getActiveModelName(): string {
  return getModel(getProvider());
}

/**
 * 调用 LLM
 * 自动根据 LLM_PROVIDER 选择 Anthropic 或 OpenAI 兼容接口
 * 失败抛 LLMError；调用方若要求「不阻塞流水线」改用 chatWithFallback
 */
export async function chat(messages: LLMMessage[], options: LLMChatOptions = {}): Promise<string> {
  const provider = getProvider();
  return requestWithRetry(
    () =>
      provider === 'openai_compatible'
        ? chatOpenAICompatible({
            apiKey: getApiKey(provider),
            model: getModel(provider, options.model),
            baseUrl: getBaseUrl(provider),
            temperature: options.temperature ?? 0.5,
            maxTokens: options.maxTokens ?? 2000,
            messages,
            timeoutMs: getTimeoutMs(options.timeoutMs),
          })
        : chatAnthropic({
            apiKey: getApiKey(provider),
            model: getModel(provider, options.model),
            baseUrl: getBaseUrl(provider),
            temperature: options.temperature ?? 0.5,
            maxTokens: options.maxTokens ?? 2000,
            messages,
            timeoutMs: getTimeoutMs(options.timeoutMs),
          }),
    getMaxRetries(options.maxRetries)
  );
}

/**
 * 调用 LLM，失败时返回兜底文案而非抛错
 * 用于「没有个性化内容也要让流水线继续」的场景（画像 / 开发信生成）
 */
export async function chatWithFallback(
  messages: LLMMessage[],
  fallback: string,
  options: LLMChatOptions = {}
): Promise<{ text: string; degraded: boolean; error: string | null }> {
  try {
    return { text: await chat(messages, options), degraded: false, error: null };
  } catch (error) {
    if (isConfigError(error)) throw error;
    return {
      text: fallback,
      degraded: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 带超时 + 退避重试的执行器
 * 只有可重试错误才重试，客户端类错误立即抛出
 */
async function requestWithRetry(call: () => Promise<string>, maxRetries: number): Promise<string> {
  let lastError: LLMError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      lastError = error instanceof LLMError ? error : classifyError(error);
      if (!lastError.retryable || attempt === maxRetries) throw lastError;
      await sleep(backoffDelayMs(attempt, lastError));
    }
  }

  throw lastError ?? new LLMError('network', 'LLM request failed', false);
}

/** 指数退避 + 抖动；429/5xx 带 Retry-After 时优先尊重服务端指示 */
function backoffDelayMs(attempt: number, error: LLMError): number {
  const retryAfter =
    error.status === 429 || (error.status ?? 0) >= 500 ? retryAfterMs(error) : null;
  if (retryAfter !== null) return retryAfter;
  const base = 500 * 2 ** attempt;
  return Math.min(base + Math.floor(Math.random() * 250), MAX_BACKOFF_MS);
}

/** Retry-After 既可能是秒数也可能是 HTTP 日期，两种都要支持 */
function retryAfterMs(error: LLMError): number | null {
  const header = error.retryAfter;
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - Date.now(), 0), MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** API key 缺失属于部署配置问题，不是运行故障，必须 fail fast 而不是静默降级 */
function isConfigError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('API_KEY is not set');
}

/** 把任意底层错误归一化为带分类的 LLMError */
function classifyError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (!(error instanceof Error)) return new LLMError('network', String(error), true);

  // AbortSignal.timeout 在 Bun 下抛 TimeoutError，其他运行时可能抛 AbortError
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return new LLMError('timeout', `LLM request timed out: ${error.message}`, true);
  }
  // fetch 建连失败在 Bun 下是 TypeError: fetch failed
  if (error.name === 'TypeError') {
    return new LLMError('network', `LLM request failed: ${error.message}`, true);
  }
  return new LLMError('network', error.message, true);
}

/** 把非 2xx 响应转成 LLMError，并按状态码决定是否值得重试 */
function toStatusError(status: number, body: string, retryAfter: string | null): LLMError {
  // 错误体可能回显 key 片段，截断避免日志膨胀
  const detail = body.slice(0, 300);
  if (status === 429) {
    return new LLMError(
      'rate_limited',
      `LLM rate limited (429): ${detail}`,
      true,
      status,
      retryAfter
    );
  }
  if (status >= 500) {
    return new LLMError(
      'server',
      `LLM server error (${status}): ${detail}`,
      true,
      status,
      retryAfter
    );
  }
  if (status === 401 || status === 403) {
    return new LLMError('auth', `LLM auth failed (${status}): ${detail}`, false, status);
  }
  return new LLMError('client', `LLM client error (${status}): ${detail}`, false, status);
}

/** Anthropic Messages API */
async function chatAnthropic(params: {
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  messages: LLMMessage[];
  timeoutMs: number;
}): Promise<string> {
  const { apiKey, model, baseUrl, temperature, maxTokens, messages, timeoutMs } = params;

  const systemMsg = messages.find((m) => m.role === 'system');
  const conversationMsgs = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemMsg?.content ?? '',
    messages: conversationMsgs,
  };

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw classifyError(error);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw toStatusError(resp.status, errText, resp.headers.get('retry-after'));
  }

  const data = await readJsonBody<{ content: Array<{ type: string; text?: string }> }>(resp);

  return data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
}

/** OpenAI 兼容接口（DeepSeek 等） */
async function chatOpenAICompatible(params: {
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  messages: LLMMessage[];
  timeoutMs: number;
}): Promise<string> {
  const { apiKey, model, baseUrl, temperature, maxTokens, messages, timeoutMs } = params;

  // OpenAI 格式：system 作为 messages 中的一条
  const openaiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: openaiMessages,
  };

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw classifyError(error);
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw toStatusError(resp.status, errText, resp.headers.get('retry-after'));
  }

  const data = await readJsonBody<{ choices: Array<{ message: { content: string } }> }>(resp);

  return data.choices[0]?.message?.content ?? '';
}

/**
 * 读取并解析响应体
 * 响应体不是合法 JSON 属于「终止类」错误：重试只会拿到同样的坏内容，白白消耗配额
 */
async function readJsonBody<T>(resp: Response): Promise<T> {
  const text = await resp.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LLMError(
      'parse',
      `LLM response body is not valid JSON: ${text.slice(0, 200)}`,
      false
    );
  }
}

/**
 * 调用 LLM 并要求返回 JSON
 * 在 system prompt 中注入 JSON 输出约束，然后用 JSON.parse 解析
 * 解析失败抛 kind='parse' 的 LLMError（不可重试：重试通常拿不到更好的格式）
 */
export async function chatJson<T>(
  messages: LLMMessage[],
  options: LLMChatOptions = {}
): Promise<T> {
  const jsonConstraint: LLMMessage = {
    role: 'system',
    content:
      'Respond with valid JSON only. No markdown code fences, no explanations, no extra text.',
  };

  const mergedMessages: LLMMessage[] = messages.map((m) => {
    if (m.role === 'system') {
      return { role: 'system', content: `${m.content}\n\n${jsonConstraint.content}` };
    }
    return m;
  });

  if (!messages.some((m) => m.role === 'system')) {
    mergedMessages.unshift(jsonConstraint);
  }

  const text = await chat(mergedMessages, options);

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new LLMError(
      'parse',
      `Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`,
      false
    );
  }
}

/**
 * 调用 LLM 并要求返回 JSON，失败时返回兜底对象
 */
export async function chatJsonWithFallback<T>(
  messages: LLMMessage[],
  fallback: T,
  options: LLMChatOptions = {}
): Promise<{ data: T; degraded: boolean; error: string | null }> {
  try {
    return { data: await chatJson<T>(messages, options), degraded: false, error: null };
  } catch (error) {
    if (isConfigError(error)) throw error;
    return {
      data: fallback,
      degraded: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
