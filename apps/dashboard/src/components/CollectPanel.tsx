import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, type CollectSummary } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const DEFAULT_KEYWORDS = '"printed circuit board"';

interface CollectPanelProps {
  /** 采集成功后回调：刷新线索列表 / 统计 */
  onSuccess: () => void;
}

export function CollectPanel({ onSuccess }: CollectPanelProps) {
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [summary, setSummary] = useState<CollectSummary | null>(null);

  const trimmedKeywords = keywords
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const mutation = useMutation({
    mutationFn: () =>
      api.collectLeads({
        keywords: trimmedKeywords,
        limitPerKeyword: 10,
      }),
    onSuccess: (result) => {
      setSummary(result);
      onSuccess();
    },
  });

  const pending = mutation.isPending;

  return (
    <Card className="mb-6">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder='搜索关键词，多个用逗号分隔，如 "printed circuit board"'
            className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 sm:max-w-md"
          />
          <Button
            onClick={() => mutation.mutate()}
            disabled={pending || trimmedKeywords.length === 0}
            className="shrink-0"
          >
            {pending ? '正在采集...' : '一键采集客户'}
          </Button>
        </div>

        {mutation.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            采集失败：{mutation.error.message}
          </div>
        )}

        {summary && !mutation.isError && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            <p className="font-medium">
              采集完成（耗时 {(summary.durationMs / 1000).toFixed(1)}s）：搜索命中 {summary.searchHits}，
              新建公司 {summary.companiesCreated} / 更新 {summary.companiesUpdated}，
              完成打分 {summary.scored === null ? '未启用' : `${summary.scored} 条`}
            </p>
            {summary.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-green-700">
                {summary.errors.slice(0, 5).map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
