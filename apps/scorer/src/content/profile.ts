import { chatJson } from './llm.ts';
import type { ProfileResult, CustomerType } from './types.ts';

/**
 * 客户画像 Agent
 *
 * 输入：公司官网描述 / 产品介绍文本
 * 输出：结构化画像（业务摘要、产品类型、客户类型、痛点、采购信号）
 *
 * 画像用途：
 * - 作为内容生成 Agent 的个性化依据
 * - 辅助业务员快速理解客户
 * - 为打分模型 v2 提供特征输入
 */

/**
 * 画像 Agent 的 system prompt
 *
 * 设计要点：
 * 1. 角色定义：B2B 行业分析师，专门判断海外公司是否需要 PCB/PCBA 代工
 * 2. 输出约束：严格 JSON，字段有明确枚举值
 * 3. 分类指南：customer_type 给出每个类别的判断标准，减少 LLM 随机性
 * 4. 防编造：信息不足时用 "unknown" 或空数组，禁止猜测
 * 5. PCB 相关性：pain_points 和 buying_signals 聚焦于"这家公司在 PCB 采购上可能有什么痛点/信号"
 */
const PROFILE_SYSTEM_PROMPT = `You are a B2B industry analyst specializing in the global electronics supply chain. Your job is to analyze a company's public description and determine whether and how they might need PCB/PCBA manufacturing services from China.

Output ONLY valid JSON with this exact schema:
{
  "businessSummary": "string — 2-3 sentences describing what the company does, their core products, and target market",
  "productTypes": ["string — specific product categories this company makes, e.g. "smart home sensors", "EV battery management systems"],
  "customerType": "one of: startup_hardware | industrial_equipment | consumer_electronics | medical_device | automotive | aerospace | telecom | iot | other",
  "painPoints": ["string — PCB-related pain points this company likely faces, e.g. "long prototype lead times", "high-mix low-volume production cost", "difficulty sourcing HDI boards"],
  "buyingSignals": ["string — signals indicating they may need PCB manufacturing support, e.g. "recent hardware product launch", "hiring hardware engineers", "expanding to new markets"]
}

Classification guide for customerType:
- startup_hardware: Early-stage company building first hardware product, likely small batch / prototype needs
- industrial_equipment: Makes factory automation, machinery, test equipment — needs industrial-grade, long-lifecycle PCBs
- consumer_electronics: Makes phones, wearables, home appliances — high volume, cost-sensitive, HDI/flexible PCBs
- medical_device: Makes medical devices — needs ISO13485, high reliability, traceability
- automotive: Makes EV, ADAS, automotive electronics — needs IATF16949, AEC-Q200, high temp range
- aerospace: Makes aerospace/defense electronics — needs high reliability, MIL-spec, low volume
- telecom: Makes telecom/networking equipment — needs high-speed, high-frequency PCBs
- iot: Makes IoT devices, sensors, gateways — low power, small form factor, moderate volume
- other: None of the above

Rules:
1. Base ALL analysis ONLY on the provided company description. Do NOT use your training knowledge about specific companies.
2. If the description is too vague to determine something, use "unknown" for summary and empty arrays for lists.
3. painPoints and buyingSignals should be SPECIFIC to PCB/PCBA procurement, not generic business problems.
4. Be concise. Each array item should be a short phrase (max 12 words).
5. businessSummary should be in English (the prospect is overseas).`;

/**
 * 生成客户画像
 * @param companyName 公司名
 * @param companyDescription 公司官网描述/产品介绍
 * @param industry 行业（可选，辅助分类）
 * @returns 结构化画像
 */
export async function generateProfile(
  companyName: string,
  companyDescription: string | null | undefined,
  industry?: string | null
): Promise<ProfileResult> {
  const description = companyDescription?.trim() || 'No description available.';

  const userPrompt = `Company: ${companyName}
${industry ? `Industry: ${industry}\n` : ''}
Description:
${description}

Analyze this company and output the profile JSON.`;

  const result = await chatJson<ProfileResult>(
    [
      { role: 'system', content: PROFILE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.3, maxTokens: 1500 }
  );

  // 防御性处理：确保所有字段存在且类型正确
  return {
    businessSummary: result.businessSummary || 'unknown',
    productTypes: Array.isArray(result.productTypes) ? result.productTypes : [],
    customerType: normalizeCustomerType(result.customerType),
    painPoints: Array.isArray(result.painPoints) ? result.painPoints : [],
    buyingSignals: Array.isArray(result.buyingSignals) ? result.buyingSignals : [],
  };
}

/**
 * 归一化 customer_type，防止 LLM 输出非枚举值
 */
function normalizeCustomerType(value: unknown): CustomerType {
  const valid: CustomerType[] = [
    'startup_hardware',
    'industrial_equipment',
    'consumer_electronics',
    'medical_device',
    'automotive',
    'aerospace',
    'telecom',
    'iot',
    'other',
  ];
  if (typeof value === 'string' && valid.includes(value as CustomerType)) {
    return value as CustomerType;
  }
  return 'other';
}
