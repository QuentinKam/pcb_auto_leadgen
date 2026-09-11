#!/usr/bin/env bun
/**
 * 采集器 CLI
 *
 * 用法（仓库根目录）：
 *   pnpm --filter @pcb/collector collect --keywords="robotics pcb manufacturer,industrial automation oem" --country=us --limit=5
 *   bun run apps/collector/src/cli.ts --keywords="medical device oem" --no-enrich --no-score
 */
import { loadConfig } from './config.ts';
import { runCollect } from './pipeline.ts';

interface CliArgs {
  keywords: string[];
  country: string | null;
  limitPerKeyword: number | undefined;
  enrich: boolean;
  score: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) flags.add(body);
    else values.set(body.slice(0, eq), body.slice(eq + 1));
  }

  const limit = values.get('limit');

  return {
    keywords: (values.get('keywords') ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    country: values.get('country') ?? null,
    limitPerKeyword: limit ? Number(limit) : undefined,
    enrich: !flags.has('no-enrich'),
    score: !flags.has('no-score'),
  };
}

const args = parseArgs(process.argv.slice(2));

if (args.keywords.length === 0) {
  console.error(
    'Usage: pnpm --filter @pcb/collector collect --keywords="a,b" [--country=us] [--limit=10] [--no-enrich] [--no-score]'
  );
  process.exit(1);
}

let summary: Awaited<ReturnType<typeof runCollect>>;
try {
  summary = await runCollect(args, loadConfig());
} catch (error) {
  console.error(`采集失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

console.log('');
console.log('  采集完成');
console.log(`  关键词          : ${summary.keywords.join(' / ')}`);
console.log(`  搜索命中        : ${summary.searchHits}`);
console.log(`  候选企业        : ${summary.candidates}`);
console.log(`  新建 / 更新公司  : ${summary.companiesCreated} / ${summary.companiesUpdated}`);
console.log(`  新建联系人      : ${summary.contactsCreated}`);
console.log(`  官网 enrich     : ${summary.enrichedSites}`);
console.log(`  打分触发        : ${summary.scored === null ? '未启用' : `${summary.scored} 条`}`);
console.log(`  耗时            : ${(summary.durationMs / 1000).toFixed(1)}s`);
if (summary.errors.length > 0) {
  console.log(`  告警 / 错误     : ${summary.errors.length} 条`);
  for (const error of summary.errors.slice(0, 20)) console.log(`    - ${error}`);
}
console.log('');

process.exit(summary.errors.length > 0 && summary.candidates === 0 ? 1 : 0);
