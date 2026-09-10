import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  mailApi,
  type MailStatsResponse,
  type WarmupStatusResponse,
  type EmailCampaignItem,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const CAMPAIGN_PAGE_SIZE = 10;

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  running: '进行中',
  paused: '已暂停',
  completed: '已完成',
  cancelled: '已取消',
};

const CAMPAIGN_STATUS_VARIANT: Record<string, 'outline' | 'default' | 'gradeA' | 'gradeB' | 'gradeC'> = {
  draft: 'outline',
  running: 'default',
  paused: 'gradeB',
  completed: 'gradeA',
  cancelled: 'gradeC',
};

export function CampaignsPage() {
  const [campaignPage, setCampaignPage] = useState(1);

  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['mailStats'],
    queryFn: () => mailApi.getStats(),
    refetchInterval: 30_000,
  });

  const { data: warmup, isLoading: warmupLoading } = useQuery({
    queryKey: ['warmupStatus'],
    queryFn: () => mailApi.getWarmupStatus(),
    refetchInterval: 30_000,
  });

  const { data: campaigns, isLoading: campaignsLoading } = useQuery({
    queryKey: ['campaigns', campaignPage],
    queryFn: () =>
      mailApi.listCampaigns({ page: campaignPage, pageSize: CAMPAIGN_PAGE_SIZE }),
  });

  const totalCampaigns = campaigns?.total ?? 0;
  const totalCampaignPages = Math.max(1, Math.ceil(totalCampaigns / CAMPAIGN_PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[var(--color-background)] p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold">发送看板</h1>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              邮件发送效果追踪 · 域名 warmup 状态 · 活动管理
            </p>
          </div>
        </div>

        {/* 7 张效果统计卡 */}
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">发送效果总览</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
            <StatCard
              title="总发送"
              value={stats?.totalSent ?? 0}
              loading={statsLoading}
              color="text-slate-700"
            />
            <StatCard
              title="已送达"
              value={stats?.totalDelivered ?? 0}
              rate={stats?.totalSent ? `${((stats.totalDelivered / stats.totalSent) * 100).toFixed(1)}%` : undefined}
              loading={statsLoading}
              color="text-blue-600"
            />
            <StatCard
              title="已打开"
              value={stats?.totalOpened ?? 0}
              rate={stats?.openRate !== undefined ? `${(stats.openRate * 100).toFixed(1)}%` : undefined}
              loading={statsLoading}
              color="text-indigo-600"
            />
            <StatCard
              title="已回复"
              value={stats?.totalReplied ?? 0}
              loading={statsLoading}
              color="text-green-600"
            />
            <StatCard
              title="硬退信"
              value={stats?.totalBouncedHard ?? 0}
              loading={statsLoading}
              color="text-red-600"
            />
            <StatCard
              title="软退信"
              value={stats?.totalBouncedSoft ?? 0}
              loading={statsLoading}
              color="text-orange-600"
            />
            <StatCard
              title="投诉率"
              value={stats?.complaintRate !== undefined ? `${(stats.complaintRate * 100).toFixed(2)}%` : '0%'}
              warning={stats && stats.complaintRate > 0.001}
              loading={statsLoading}
              color={stats && stats.complaintRate > 0.001 ? 'text-red-700' : 'text-slate-600'}
            />
          </div>
          {statsError && (
            <p className="mt-3 text-sm text-[var(--color-destructive)]">
              统计加载失败：{statsError.message}（如 mailer 未启动可忽略）
            </p>
          )}
        </div>

        {/* 域名 warmup 状态卡 */}
        <div className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">域名 Warmup 状态</h2>
          <WarmupCard warmup={warmup} loading={warmupLoading} />
        </div>

        {/* 活动列表 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">邮件活动（共 {totalCampaigns} 个）</CardTitle>
            <CardDescription>包含 warmup 自动活动和自定义活动</CardDescription>
          </CardHeader>
          <CardContent>
            {campaignsLoading && (
              <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">加载中...</p>
            )}
            {!campaignsLoading && campaigns && campaigns.items.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                暂无活动，warmup 启动后会自动创建 warmup 活动
              </p>
            )}
            {campaigns && campaigns.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left">
                      <th className="p-3 font-medium">活动名</th>
                      <th className="p-3 font-medium">类型</th>
                      <th className="p-3 font-medium">状态</th>
                      <th className="p-3 font-medium">格式</th>
                      <th className="p-3 font-medium text-right">目标</th>
                      <th className="p-3 font-medium text-right">已发</th>
                      <th className="p-3 font-medium text-right">送达</th>
                      <th className="p-3 font-medium text-right">打开</th>
                      <th className="p-3 font-medium text-right">点击</th>
                      <th className="p-3 font-medium text-right">退信</th>
                      <th className="p-3 font-medium text-right">投诉</th>
                      <th className="p-3 font-medium">创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.items.map((c) => (
                      <CampaignRow key={c.id} campaign={c} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalCampaignPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-[var(--color-muted-foreground)]">
                  第 {campaignPage} / {totalCampaignPages} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={campaignPage <= 1 || campaignsLoading}
                    onClick={() => setCampaignPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={campaignPage >= totalCampaignPages || campaignsLoading}
                    onClick={() => setCampaignPage((p) => p + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  rate,
  warning,
  loading,
  color,
}: {
  title: string;
  value: number | string;
  rate?: string;
  warning?: boolean;
  loading: boolean;
  color: string;
}) {
  return (
    <Card className={warning ? 'border-red-400 bg-red-50' : ''}>
      <CardContent className="p-4">
        <p className="text-xs text-[var(--color-muted-foreground)]">{title}</p>
        {loading ? (
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">...</p>
        ) : (
          <>
            <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
            {rate && <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">{rate}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function WarmupCard({
  warmup,
  loading,
}: {
  warmup: WarmupStatusResponse | undefined;
  loading: boolean;
}) {
  if (loading || !warmup) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {loading ? '加载 warmup 状态中...' : '暂无可显示的 warmup 状态'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const reputColor =
    warmup.reputationScore >= 80
      ? 'text-green-700'
      : warmup.reputationScore >= 50
        ? 'text-yellow-700'
        : 'text-red-700';

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">今日进度</CardTitle>
          <CardDescription>
            {warmup.sendingDomains.join(', ') || '未配置发送域名'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[var(--color-muted-foreground)]">目标</span>
            <span className="text-lg font-semibold">{warmup.todaysEntry?.targetCount ?? 0} 封</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[var(--color-muted-foreground)]">已发</span>
            <span className="text-lg font-semibold text-blue-600">{warmup.todaySent} 封</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[var(--color-muted-foreground)]">剩余</span>
            <span className="text-lg font-semibold text-slate-500">{warmup.todayRemaining} 封</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{
                width: `${warmup.todaysEntry?.targetCount ? Math.min(100, (warmup.todaySent / warmup.todaysEntry.targetCount) * 100) : 0}%`,
              }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">域名声誉</CardTitle>
          <CardDescription>
            Reputation Score（0-100）
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-[var(--color-muted-foreground)]">分数</span>
            <span className={`text-3xl font-bold ${reputColor}`}>{warmup.reputationScore}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full transition-all ${
                warmup.reputationScore >= 80
                  ? 'bg-green-500'
                  : warmup.reputationScore >= 50
                    ? 'bg-yellow-500'
                    : 'bg-red-500'
              }`}
              style={{ width: `${warmup.reputationScore}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--color-muted-foreground)]">
            <div>开信：{warmup.campaignStats.totalOpened}</div>
            <div>点击：{warmup.campaignStats.totalClicked}</div>
            <div>退信：{warmup.campaignStats.totalBounced}</div>
            <div>投诉：{warmup.campaignStats.totalComplained}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Warmup 进度 & 队列</CardTitle>
          <CardDescription>
            第 {warmup.elapsedDays} 天 / 共 {warmup.totalWeeks} 周
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-muted-foreground)]">种子邮箱</span>
            <Badge variant="outline">{warmup.seedPool.totalAvailable} 个</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--color-muted-foreground)]">发送域名</span>
            <span className="text-xs font-medium">{warmup.sendingDomains.length} 个</span>
          </div>
          <div className="border-t border-dashed border-[var(--color-border)] pt-2 mt-2">
            <div className="text-xs font-semibold text-[var(--color-muted-foreground)] mb-1">
              BullMQ 队列
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px] text-center">
              <div className="rounded bg-slate-100 p-1.5">
                <div className="font-semibold text-slate-700">{warmup.queue.waiting}</div>
                <div className="text-[var(--color-muted-foreground)]">等待</div>
              </div>
              <div className="rounded bg-blue-100 p-1.5">
                <div className="font-semibold text-blue-700">{warmup.queue.active}</div>
                <div className="text-[var(--color-muted-foreground)]">执行</div>
              </div>
              <div className="rounded bg-yellow-100 p-1.5">
                <div className="font-semibold text-yellow-700">{warmup.queue.delayed}</div>
                <div className="text-[var(--color-muted-foreground)]">延迟</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: EmailCampaignItem }) {
  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)]">
      <td className="p-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{campaign.name}</span>
          {campaign.isWarmup && <Badge variant="outline" className="text-[10px]">WARMUP</Badge>}
        </div>
        {campaign.description && (
          <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)] truncate max-w-[200px]">
            {campaign.description}
          </div>
        )}
      </td>
      <td className="p-3">
        {campaign.isWarmup ? (
          <Badge variant="outline">Warmup</Badge>
        ) : (
          <Badge variant="default">正式</Badge>
        )}
      </td>
      <td className="p-3">
        <Badge variant={CAMPAIGN_STATUS_VARIANT[campaign.status] ?? 'outline'}>
          {CAMPAIGN_STATUS_LABEL[campaign.status] ?? campaign.status}
        </Badge>
      </td>
      <td className="p-3 text-xs text-[var(--color-muted-foreground)]">{campaign.format}</td>
      <td className="p-3 text-right font-mono text-xs">{campaign.totalTargets}</td>
      <td className="p-3 text-right font-mono text-xs">{campaign.totalSent}</td>
      <td className="p-3 text-right font-mono text-xs text-blue-600">{campaign.totalDelivered}</td>
      <td className="p-3 text-right font-mono text-xs text-indigo-600">{campaign.totalOpened}</td>
      <td className="p-3 text-right font-mono text-xs text-green-600">{campaign.totalClicked}</td>
      <td className="p-3 text-right font-mono text-xs text-orange-600">{campaign.totalBounced}</td>
      <td className="p-3 text-right font-mono text-xs text-red-600">{campaign.totalComplained}</td>
      <td className="p-3 text-xs text-[var(--color-muted-foreground)]">
        {new Date(campaign.createdAt).toLocaleDateString('zh-CN')}
      </td>
    </tr>
  );
}
