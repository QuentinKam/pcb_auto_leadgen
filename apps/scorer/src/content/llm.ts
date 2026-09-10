/**
 * LLM 调用封装
 * 使用 Bun 原生 fetch，支持两种 provider：
 *   - anthropic（默认）：Anthropic Messages API
 *   - openai_compatible：OpenAI 兼容接口（DeepSeek、通义、智谱等）
 *
 * 环境变量：
 *   LLM_PROVIDER        — anthropic | openai_compatible，默认 anthropic
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

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
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
 */
export async function chat(messages: LLMMessage[], options: LLMChatOptions = {}): Promise<string> {
  const provider = getProvider();
  const apiKey = getApiKey(provider);
  const model = getModel(provider, options.model);
  const baseUrl = getBaseUrl(provider);
  const temperature = options.temperature ?? 0.5;
  const maxTokens = options.maxTokens ?? 2000;

  if (provider === 'openai_compatible') {
    return chatOpenAICompatible({ apiKey, model, baseUrl, temperature, maxTokens, messages });
  }
  return chatAnthropic({ apiKey, model, baseUrl, temperature, maxTokens, messages });
}

/** Anthropic Messages API */
async function chatAnthropic(params: {
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  messages: LLMMessage[];
}): Promise<string> {
  const { apiKey, model, baseUrl, temperature, maxTokens, messages } = params;

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

  const resp = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

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
}): Promise<string> {
  const { apiKey, model, baseUrl, temperature, maxTokens, messages } = params;

  // OpenAI 格式：system 作为 messages 中的一条
  const openaiMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: openaiMessages,
  };

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`LLM API error ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? '';
}

/**
 * 调用 LLM 并要求返回 JSON
 * 在 system prompt 中注入 JSON 输出约束，然后用 JSON.parse 解析
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
    throw new Error(`Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`);
  }
}
