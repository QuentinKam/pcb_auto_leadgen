/**
 * 从官网文本推断行业 / 规模 / 融资阶段（纯规则，无外部 API）。
 * industry 输出与 scorer 的 industry 维度取值对齐（见 apps/scorer/src/scoring/industry.ts）。
 */
const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  robotics: ['robot', 'robotic', 'cobot', 'amr', 'autonomous mobile'],
  medical_devices: [
    'medical device',
    'medical',
    'healthcare',
    'diagnostic',
    'patient monitor',
    'iso 13485',
  ],
  automotive: ['automotive', 'vehicle', 'adas', 'tier 1', 'iattf', 'car manufacturer'],
  aerospace: ['aerospace', 'avionics', 'satellite', 'spacecraft', 'uav'],
  consumer_electronics: ['consumer electronics', 'wearable', 'smart home', 'audio', 'speaker'],
  industrial_equipment: ['industrial', 'factory automation', 'machinery', 'equipment', 'oem'],
  iot: ['iot', 'internet of things', 'sensor network', 'smart meter', 'connected device'],
  energy: ['energy', 'solar', 'inverter', 'power grid', 'battery', 'ev charging'],
  telecom: ['telecom', '5g', 'network equipment', 'base station'],
  security: ['surveillance', 'security system', 'access control', 'cctv'],
  test_measurement: [
    'oscilloscope',
    'test & measurement',
    'instrumentation',
    'measurement instrument',
  ],
  semiconductor: ['semiconductor', 'wafer', 'chip design', 'asic', 'fpga'],
  electronics_manufacturing: ['electronics manufacturing', 'ems provider', 'contract manufacturer'],
  hardware: ['hardware', 'embedded', 'firmware', 'pcb design'],
};

const FUNDING_PATTERNS: Array<{ stage: string; pattern: RegExp }> = [
  { stage: 'ipo', pattern: /\b(ipo|publicly traded|nasdaq|nyse)\b/i },
  { stage: 'acquired', pattern: /\b(acquired by|acquisition by)\b/i },
  { stage: 'c', pattern: /\bseries c\b/i },
  { stage: 'b', pattern: /\bseries b\b/i },
  { stage: 'a', pattern: /\bseries a\b/i },
  { stage: 'seed', pattern: /\b(seed round|seed funding|pre-seed)\b/i },
  { stage: 'bootstrapped', pattern: /\bbootstrapped\b/i },
];

/** 命中的行业标签（可多个），按命中次数降序 */
export function inferIndustrySignals(text: string): string[] {
  const haystack = text.toLowerCase();
  const scored: Array<{ tag: string; hits: number }> = [];
  for (const [tag, words] of Object.entries(INDUSTRY_KEYWORDS)) {
    let hits = 0;
    for (const word of words) {
      if (haystack.includes(word)) hits += 1;
    }
    if (hits > 0) scored.push({ tag, hits });
  }
  return scored.sort((a, b) => b.hits - a.hits).map((item) => item.tag);
}

/** 主行业标签：命中次数最多者 */
export function inferIndustry(text: string): string | null {
  return inferIndustrySignals(text)[0] ?? null;
}

/** 从 "team of 120" / "120+ employees" / "120 employees" 推断人数 */
export function inferEmployeeCount(text: string): number | null {
  const patterns = [
    /(\d{1,6})\s*\+?\s*employees/i,
    /team of\s*(\d{1,6})/i,
    /(\d{1,6})\s*\+?\s*people\b/i,
    /(\d{1,6})\s*\+?\s*staff\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const raw = match?.[1];
    if (!raw) continue;
    const count = Number(raw);
    if (Number.isFinite(count) && count > 0 && count <= 500_000) return count;
  }
  return null;
}

export function inferFundingStage(text: string): string | null {
  for (const { stage, pattern } of FUNDING_PATTERNS) {
    if (pattern.test(text)) return stage;
  }
  return null;
}
