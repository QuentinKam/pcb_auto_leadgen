/**
 * LLM 调用封装
 * 使用 Bun 原生 fetch 直连 Anthropic API（spec.md §9：Claude 主 + OpenAI 备）
 * 避免引入 Vercel AI SDK 依赖，保持轻量
 *
 * 环境变量：
 *   ANTHROPIC_API_KEY  — Anthropic API Key
 *   ANTHROPIC_MODEL    — 模型名，默认 claude-sonnet-4-5
 *   ANTHROPIC_BASE_URL — API 地址，默认 https://api.anthropic.com
 */

const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * 调用 Anthropic Messages API
 * 系统提示通过 system 参数传入，user/assistant 通过 messages 传入
 */
export async function chat(
  messages: LLMMessage[],
  options: LLMChatOptions = {},
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE_URL;
  const temperature = options.temperature ?? 0.5;
  const maxTokens = options.maxTokens ?? 2000;

  // 分离 system 消息和对话消息
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
      'anthropic-version': API_VERSION,
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

  // 拼接所有 text 类型的内容块
  const text = data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');

  return text;
}

/**
 * 调用 LLM 并要求返回 JSON
 * 在 system prompt 中注入 JSON 输出约束，然后用 JSON.parse 解析
 */
export async function chatJson<T>(
  messages: LLMMessage[],
  options: LLMChatOptions = {},
): Promise<T> {
  const jsonConstraint: LLMMessage = {
    role: 'system',
    content:
      'Respond with valid JSON only. No markdown code fences, no explanations, no extra text.',
  };

  // 将 JSON 约束合并到现有 system 消息（如果有）
  const mergedMessages: LLMMessage[] = messages.map((m) => {
    if (m.role === 'system') {
      return { role: 'system', content: `${m.content}\n\n${jsonConstraint.content}` };
    }
    return m;
  });

  // 如果没有 system 消息，追加一个
  if (!messages.some((m) => m.role === 'system')) {
    mergedMessages.unshift(jsonConstraint);
  }

  const text = await chat(mergedMessages, options);

  // 清理可能的 markdown 代码块包裹
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error(`Failed to parse LLM response as JSON: ${cleaned.slice(0, 200)}`);
  }
}
