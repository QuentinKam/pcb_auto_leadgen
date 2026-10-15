/**
 * 维度：Hardware / Product Fit（满分 20，属于 Buyer Fit 子维度）
 *
 * 判断公司是否实际研发、制造或销售包含电子硬件的产品（prompt §8）。
 * 与 PCB Relevance 的区别：这里识别的是「硬件产品形态」（controller/sensor/robot/...），
 * 而不是「PCB 制造术语」。
 */

import { collectCompanyText } from './context.ts';
import { type Evidence, makeEvidence } from './evidence.ts';

const HARDWARE_PRODUCT_TERMS = [
  'electronic device',
  'controller',
  'sensor',
  'iot device',
  'robot',
  'industrial controller',
  'medical device',
  'automotive electronics',
  'embedded device',
  'embedded system',
  'communication equipment',
  'smart device',
  'battery management',
  'battery system',
  'power electronics',
  'instrument',
  'drone',
  'uav',
  'wearable',
  'gateway',
  'actuator',
  'motor controller',
  'hmi',
  'plc',
  'module',
  'electronics',
  'hardware',
  'firmware',
];

const MAX_SCORE = 20;

export interface HardwareFitResult {
  score: number;
  matchedTerms: string[];
  reason: string;
  evidence: Evidence[];
}

export function scoreHardwareFit(company: {
  description?: string | null;
  rawPayload?: unknown;
}): HardwareFitResult {
  const { fields } = collectCompanyText(company);
  if (fields.length === 0) {
    return {
      score: 0,
      matchedTerms: [],
      reason: 'No text to scan for hardware products',
      evidence: [],
    };
  }

  const matched = new Map<string, { snippet: string; sourceUrl?: string }>();

  for (const field of fields) {
    const hay = field.value.toLowerCase();
    for (const term of HARDWARE_PRODUCT_TERMS) {
      if (matched.has(term)) continue;
      if (hay.includes(term)) {
        matched.set(term, {
          snippet: snippetAround(field.value, term),
          sourceUrl: field.sourceUrl,
        });
      }
    }
  }

  const matchedTerms = [...matched.keys()];

  // 命中数量 → 分数（硬件产品信号越多越确信）
  let score = 0;
  if (matchedTerms.length >= 5) score = MAX_SCORE;
  else if (matchedTerms.length >= 3) score = 16;
  else if (matchedTerms.length >= 1) score = 10;

  const reason =
    matchedTerms.length === 0
      ? 'No hardware/electronic product signals found'
      : `Found ${matchedTerms.length} hardware product signals: ${matchedTerms.join(', ')}`;

  const evidence = matchedTerms.slice(0, 5).flatMap((term) => {
    const hit = matched.get(term);
    if (!hit) return [];
    return [
      makeEvidence({
        signalType: 'hardware_product',
        description: `Detected hardware product signal: "${term}"`,
        snippet: hit.snippet,
        sourceUrl: hit.sourceUrl,
        confidence: 0.8,
      }),
    ];
  });

  return { score, matchedTerms, reason, evidence };
}

function snippetAround(text: string, term: string): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return text.slice(0, 120);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + term.length + 80);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}
