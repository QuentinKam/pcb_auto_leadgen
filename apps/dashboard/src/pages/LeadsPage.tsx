import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LeadScoreItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OverrideDialog } from '@/components/OverrideDialog';

const GRADE_BADGE: Record<'A' | 'B' | 'C', 'gradeA' | 'gradeB' | 'gradeC'> = {
  A: 'gradeA',
  B: 'gradeB',
  C: 'gradeC',
};

const GRADE_FILTERS: Array<'ALL' | 'A' | 'B' | 'C'> = ['ALL', 'A', 'B', 'C'];

const PAGE_SIZE = 20;

export function LeadsPage() {
  const [grade, setGrade] = useState<'ALL' | 'A' | 'B' | 'C'>('ALL');
  const [page, setPage] = useState(1);
  const [overrideLead, setOverrideLead] = useState<LeadScoreItem | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const queryClient = useQueryClient();

  // 列表查询
  const { data, isLoading, error } = useQuery({
    queryKey: ['leadScores', grade, page],
    queryFn: () =>
      api.listLeadScores({
        page,
        pageSize: PAGE_SIZE,
        grade: grade === 'ALL' ? undefined : grade,
      }),
  });

  // A/B/C 统计（并发查询 3 个）
  const statsA = useQuery({
    queryKey: ['leadScores', 'A', 1, 'stat'],
    queryFn: () => api.listLeadScores({ grade: 'A', page: 1, pageSize: 1 }),
  });
  const statsB = useQuery({
    queryKey: ['leadScores', 'B', 1, 'stat'],
    queryFn: () => api.listLeadScores({ grade: 'B', page: 1, pageSize: 1 }),
  });
  const statsC = useQuery({
    queryKey: ['leadScores', 'C', 1, 'stat'],
    queryFn: () => api.listLeadScores({ grade: 'C', page: 1, pageSize: 1 }),
  });

  function handleGradeFilter(g: 'ALL' | 'A' | 'B' | 'C') {
    setGrade(g);
    setPage(1);
  }

  function handleOverrideSuccess() {
    void queryClient.invalidateQueries({ queryKey: ['leadScores'] });
    void queryClient.invalidateQueries({ queryKey: ['leadScores', 'A', 1, 'stat'] });
    void queryClient.invalidateQueries({ queryKey: ['leadScores', 'B', 1, 'stat'] });
    void queryClient.invalidateQueries({ queryKey: ['leadScores', 'C', 1, 'stat'] });
  }

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-[var(--color-background)] p-8">
      <div className="mx-auto max-w-7xl">
        <h1 className="mb-8 text-3xl font-bold">线索看板</h1>

        {/* 统计卡片 */}
        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="A级线索"
            count={statsA.data?.total ?? 0}
            variant="gradeA"
            loading={statsA.isLoading}
          />
          <StatCard
            title="B级线索"
            count={statsB.data?.total ?? 0}
            variant="gradeB"
            loading={statsB.isLoading}
          />
          <StatCard
            title="C级线索"
            count={statsC.data?.total ?? 0}
            variant="gradeC"
            loading={statsC.isLoading}
          />
        </div>

        {/* 筛选 */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm font-medium">等级筛选：</span>
          {GRADE_FILTERS.map((g) => (
            <Button
              key={g}
              variant={grade === g ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleGradeFilter(g)}
            >
              {g === 'ALL' ? '全部' : g}
            </Button>
          ))}
        </div>

        {/* 列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">线索列表（共 {total} 条）</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                加载中...
              </p>
            )}
            {error && (
              <p className="py-8 text-center text-sm text-[var(--color-destructive)]">
                加载失败：{error.message}
              </p>
            )}
            {data && data.data.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                暂无线索
              </p>
            )}
            {data && data.data.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left">
                      <th className="p-3 font-medium">分数</th>
                      <th className="p-3 font-medium">模型等级</th>
                      <th className="p-3 font-medium">最终等级</th>
                      <th className="p-3 font-medium">维度明细</th>
                      <th className="p-3 font-medium">覆盖状态</th>
                      <th className="p-3 font-medium">创建时间</th>
                      <th className="p-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.data.map((lead) => (
                      <tr
                        key={lead.id}
                        className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]"
                      >
                        <td className="p-3 font-semibold">{lead.score}</td>
                        <td className="p-3">
                          <Badge variant={GRADE_BADGE[lead.grade]}>{lead.grade}</Badge>
                        </td>
                        <td className="p-3">
                          {lead.finalGrade !== lead.grade ? (
                            <Badge variant={GRADE_BADGE[lead.finalGrade]}>{lead.finalGrade}*</Badge>
                          ) : (
                            <Badge variant={GRADE_BADGE[lead.finalGrade]}>{lead.finalGrade}</Badge>
                          )}
                        </td>
                        <td className="p-3 text-xs text-[var(--color-muted-foreground)]">
                          I:{lead.dimensionBreakdown.industry} K:
                          {lead.dimensionBreakdown.pcb_keywords} R:{lead.dimensionBreakdown.role} S:
                          {lead.dimensionBreakdown.size} A:{lead.dimensionBreakdown.reachability}
                        </td>
                        <td className="p-3 text-xs">
                          {lead.overriddenBy ? (
                            <span className="text-orange-600" title={lead.overrideReason ?? ''}>
                              人工覆盖
                            </span>
                          ) : (
                            <span className="text-[var(--color-muted-foreground)]">模型</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-[var(--color-muted-foreground)]">
                          {new Date(lead.createdAt).toLocaleString('zh-CN')}
                        </td>
                        <td className="p-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setOverrideLead(lead);
                              setOverrideOpen(true);
                            }}
                          >
                            覆盖
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-[var(--color-muted-foreground)]">
                  第 {page} / {totalPages} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <OverrideDialog
          lead={overrideLead}
          open={overrideOpen}
          onClose={() => setOverrideOpen(false)}
          onSuccess={handleOverrideSuccess}
        />
      </div>
    </div>
  );
}

interface StatCardProps {
  title: string;
  count: number;
  variant: 'gradeA' | 'gradeB' | 'gradeC';
  loading: boolean;
}

function StatCard({ title, count, variant, loading }: StatCardProps) {
  const colorMap: Record<'gradeA' | 'gradeB' | 'gradeC', string> = {
    gradeA: 'text-green-600',
    gradeB: 'text-yellow-600',
    gradeC: 'text-gray-600',
  };
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-6">
        <div>
          <p className="text-sm text-[var(--color-muted-foreground)]">{title}</p>
          {loading ? (
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">...</p>
          ) : (
            <p className={`mt-1 text-3xl font-bold ${colorMap[variant]}`}>{count}</p>
          )}
        </div>
        <Badge variant={variant}>{title.charAt(0)}</Badge>
      </CardContent>
    </Card>
  );
}
