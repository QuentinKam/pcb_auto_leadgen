/**
 * 采集文本归一化：把 company.description + rawPayload 的 about/products/services/description
 * 展平成带来源 URL 的字段列表，供打分各维度（hardware/PCB/demand/negative）共享扫描。
 *
 * 来源 URL 来自 collector 落库的 rawPayload.sourcesByField（field → url[]），
 * 用于 Signal-level Evidence 的 sourceUrl 绑定（见 scoring/evidence.ts）。
 */

export interface TextField {
  field: string;
  value: string;
  sourceUrl?: string;
}

export interface CompanyText {
  fields: TextField[];
  /** 所有字段小写拼接，供关键词扫描 */
  haystack: string;
}

const SCAN_KEYS = ['about', 'products', 'services', 'description'] as const;

export function collectCompanyText(company: {
  description?: string | null;
  rawPayload?: unknown;
}): CompanyText {
  const fields: TextField[] = [];

  if (company.description?.trim()) {
    fields.push({ field: 'description', value: company.description.trim() });
  }

  const payload = (company.rawPayload ?? {}) as Record<string, unknown>;
  const sourcesByField = (payload.sourcesByField ?? {}) as Record<string, string[] | string>;

  for (const key of SCAN_KEYS) {
    const value = payload[key];
    const sourceUrl = firstSource(sourcesByField, key);
    if (typeof value === 'string' && value.trim()) {
      fields.push({ field: key, value: value.trim(), sourceUrl });
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          fields.push({ field: key, value: item.trim(), sourceUrl });
        }
      }
    }
  }

  const haystack = fields.map((f) => f.value).join(' ').toLowerCase();
  return { fields, haystack };
}

function firstSource(sourcesByField: Record<string, string[] | string>, key: string): string | undefined {
  const value = sourcesByField[key];
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string' && value) return value;
  return undefined;
}
