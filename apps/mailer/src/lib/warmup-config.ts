import 'dotenv/config';

export type WarmupScheduleEntry = {
  week: number;
  dayOfWeek: number;
  absoluteDay: number;
  targetCount: number;
};

export type WarmupPlan = {
  totalWeeks: number;
  entries: WarmupScheduleEntry[];
  maxPerDay: number;
  seedEmails: string[];
};

const DEFAULT_TOTAL_WEEKS = 8;
const DEFAULT_PLAN_8WEEK: [number, number][] = [
  [1, 5],
  [1, 8],
  [1, 10],
  [1, 12],
  [1, 15],
  [1, 18],
  [2, 20],
  [2, 25],
  [2, 30],
  [2, 35],
  [2, 40],
  [2, 45],
  [2, 50],
  [3, 60],
  [3, 70],
  [3, 80],
  [3, 90],
  [3, 100],
  [4, 110],
  [4, 120],
  [4, 140],
  [4, 160],
  [4, 180],
  [4, 200],
  [5, 230],
  [5, 260],
  [5, 300],
  [5, 340],
  [5, 380],
  [5, 420],
  [6, 450],
  [6, 470],
  [6, 480],
  [6, 490],
  [6, 500],
  [7, 500],
  [7, 500],
  [7, 500],
  [7, 500],
  [7, 500],
  [8, 500],
  [8, 500],
  [8, 500],
  [8, 500],
  [8, 500],
  [8, 500],
];

function buildScheduleFromTargets(
  totalWeeks: number,
  targets: [number, number][]
): WarmupScheduleEntry[] {
  const entries: WarmupScheduleEntry[] = [];
  const daysPerWeek = 7;
  let idx = 0;
  let currentTarget = 5;
  for (let w = 1; w <= totalWeeks; w++) {
    for (let d = 1; d <= daysPerWeek; d++) {
      const absoluteDay = (w - 1) * daysPerWeek + d;
      if (idx < targets.length && absoluteDay >= targets[idx][0]) {
        currentTarget = targets[idx][1];
        idx += 1;
      }
      if (d <= 5) {
        entries.push({ week: w, dayOfWeek: d, absoluteDay, targetCount: currentTarget });
      }
    }
  }
  return entries;
}

function loadSeedEmailsFromEnv(): string[] {
  const raw = process.env.WARMUP_SEED_EMAILS ?? '[]';
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[warmup-config] WARMUP_SEED_EMAILS 不是数组，回退为空');
      return [];
    }
    const filtered = parsed
      .map((e) => String(e ?? '').trim().toLowerCase())
      .filter((e) => /.+@.+\..+/.test(e));
    const deduped = Array.from(new Set(filtered));
    const duplicates = filtered.length - deduped.length;
    if (duplicates > 0) {
      console.warn(
        `[warmup-config] WARMUP_SEED_EMAILS 去重：${filtered.length} → ${deduped.length}（去掉 ${duplicates} 个重复）`
      );
    }
    return deduped;
  } catch (err) {
    console.warn('[warmup-config] WARMUP_SEED_EMAILS JSON.parse 失败，回退为空：', (err as Error).message);
    return [];
  }
}

class WarmupConfig {
  private plan: WarmupPlan;
  private startDate: Date;

  constructor() {
    const totalWeeksRaw = Number(process.env.WARMUP_TOTAL_WEEKS ?? DEFAULT_TOTAL_WEEKS);
    const totalWeeks =
      Number.isFinite(totalWeeksRaw) && totalWeeksRaw >= 4 ? totalWeeksRaw : DEFAULT_TOTAL_WEEKS;
    const entries = buildScheduleFromTargets(totalWeeks, DEFAULT_PLAN_8WEEK);
    const seedEmails = loadSeedEmailsFromEnv();

    const maxPerDay = entries.reduce((max, e) => (e.targetCount > max ? e.targetCount : max), 0);
    this.plan = { totalWeeks, entries, maxPerDay, seedEmails };

    const startRaw = process.env.WARMUP_START_DATE;
    if (startRaw && /^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
      const [y, m, d] = startRaw.split('-').map(Number) as [number, number, number];
      this.startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      const now = new Date();
      this.startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }
  }

  getPlan(): WarmupPlan {
    return this.plan;
  }

  getStartDate(): Date {
    return new Date(this.startDate.getTime());
  }

  getElapsedDays(target?: Date): number {
    const now = target ?? new Date();
    const midnightNow = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const ms = midnightNow.getTime() - this.startDate.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return Math.max(0, days);
  }

  getTodaysEntry(target?: Date): WarmupScheduleEntry | null {
    const elapsed = this.getElapsedDays(target);
    const absoluteDay = elapsed + 1;
    if (absoluteDay > this.plan.totalWeeks * 7) {
      const last = this.plan.entries[this.plan.entries.length - 1];
      return last ?? null;
    }
    const now = target ?? new Date();
    const dow = now.getDay() === 0 ? 7 : now.getDay();
    const week = Math.floor(elapsed / 7) + 1;
    const specific = this.plan.entries.find((e) => e.week === week && e.dayOfWeek === dow);
    if (specific) return specific;
    const byAbsolute = this.plan.entries.find((e) => e.absoluteDay >= absoluteDay);
    return byAbsolute ?? this.plan.entries[this.plan.entries.length - 1] ?? null;
  }

  getTodaysTargetCount(target?: Date): number {
    const entry = this.getTodaysEntry(target);
    return entry?.targetCount ?? 0;
  }

  pickSeedEmails(count: number): string[] {
    const pool = this.plan.seedEmails;
    if (pool.length === 0) return [];
    if (count <= pool.length) {
      return pool.slice(0, count);
    }
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      out.push(pool[i % pool.length] as string);
    }
    return out;
  }

  getDomainCandidates(): string[] {
    const raw = process.env.DEFAULT_FROM_ADDRESSES ?? '';
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const emailRe = /([^<\s,]+@[^>\s,]+)/;
    const out = new Set<string>();
    for (const p of parts) {
      const m = p.match(emailRe);
      if (!m || !m[1]) continue;
      const atIdx = m[1].lastIndexOf('@');
      if (atIdx >= 0) out.add(m[1].slice(atIdx + 1));
    }
    const fallback = process.env.DEFAULT_SENDING_DOMAIN;
    if (out.size === 0 && fallback) out.add(fallback);
    return Array.from(out);
  }
}

export const warmupConfig = new WarmupConfig();
