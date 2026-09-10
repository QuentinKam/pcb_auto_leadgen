import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  mailApi,
  type EmailSendItem,
  type EmailSendStatus,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const SEND_PAGE_SIZE = 20;

const STATUS_FILTERS: Array<{ key: 'ALL' | EmailSendStatus; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'queued', label: '排队中' },
  { key: 'sending', label: '发送中' },
  { key: 'sent', label: '已发送' },
  { key: 'delivered', label: '已送达' },
  { key: 'opened', label: '已打开' },
  { key: 'clicked', label: '已点击' },
  { key: 'replied', label: '已回复' },
  { key: 'bounced', label: '退信' },
  { key: 'complained', label: '投诉' },
  { key: 'failed', label: '失败' },
  { key: 'cancelled', label: '已取消' },
];

const STATUS_LABEL: Record<EmailSendStatus, string> = {
  queued: '排队中',
  sending: '发送中',
  sent: '已发送',
  delivered: '已送达',
  opened: '已打开',
  clicked: '已点击',
  replied: '已回复',
  bounced: '退信',
  complained: '投诉',
  failed: '失败',
  cancelled: '已取消',
};

const STATUS_VARIANT: Record<
  EmailSendStatus,
  'outline' | 'default' | 'gradeA' | 'gradeB' | 'gradeC'
> = {
  queued: 'outline',
  sending: 'outline',
  sent: 'outline',
  delivered: 'default',
  opened: 'gradeA',
  clicked: 'gradeA',
  replied: 'gradeA',
  bounced: 'gradeC',
  complained: 'gradeC',
  failed: 'gradeC',
  cancelled: 'gradeB',
};

export function EmailSendsPage() {
  const [statusFilter, setStatusFilter] = useState<'ALL' | EmailSendStatus>('ALL');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['emailSends', statusFilter, page],
    queryFn: () =>
      mailApi.listSends({
        page,
        pageSize: SEND_PAGE_SIZE,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      }),
    refetchInterval: 30_000,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => mailApi.cancelSend(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emailSends'] });
      void queryClient.invalidateQueries({ queryKey: ['mailStats'] });
    },
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / SEND_PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[var(--color-background)] p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold">发送记录</h1>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              单条邮件发送状态追踪，按状态筛选，支持取消排队中的发送
            </p>
          </div>
        </div>

        {/* 状态筛选 */}
        <div className="mb-4">
          <div className="text-sm font-medium mb-2">状态筛选</div>
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={statusFilter === f.key ? 'default' : 'outline'}
                onClick={() => {
                  setStatusFilter(f.key);
                  setPage(1);
                }}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">发送记录（共 {total} 条）</CardTitle>
            <CardDescription>每 30 秒自动刷新</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">加载中...</p>
            )}
            {error && (
              <p className="py-8 text-center text-sm text-[var(--color-destructive)]">
                加载失败：{error.message}
              </p>
            )}
            {!isLoading && data && data.items.length === 0 && (
              <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
                暂无发送记录
              </p>
            )}
            {data && data.items.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-left">
                      <th className="p-3 font-medium">状态</th>
                      <th className="p-3 font-medium">收件人</th>
                      <th className="p-3 font-medium">主题</th>
                      <th className="p-3 font-medium">发件人</th>
                      <th className="p-3 font-medium">域名</th>
                      <th className="p-3 font-medium text-right">开/点</th>
                      <th className="p-3 font-medium">时间</th>
                      <th className="p-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((s) => (
                      <SendRow
                        key={s.id}
                        send={s}
                        onCancel={(id) => cancelMutation.mutate(id)}
                        cancelling={cancelMutation.isPending}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm text-[var(--color-muted-foreground)]">
                  第 {page} / {totalPages} 页
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || isLoading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || isLoading}
                    onClick={() => setPage((p) => p + 1)}
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

function SendRow({
  send,
  onCancel,
  cancelling,
}: {
  send: EmailSendItem;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const canCancel = send.status === 'queued' || send.status === 'sending';

  return (
    <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-accent)] align-top">
      <td className="p-3 whitespace-nowrap">
        <Badge variant={STATUS_VARIANT[send.status]}>{STATUS_LABEL[send.status]}</Badge>
        {send.bounceType && (
          <div className="mt-1 text-[10px] text-red-600">
            {send.bounceType === 'hard' ? '硬退' : '软退'}
          </div>
        )}
        {send.retryCount > 0 && (
          <div className="mt-1 text-[10px] text-orange-600">重试 {send.retryCount} 次</div>
        )}
        {send.lastError && (
          <div
            className="mt-1 text-[10px] text-red-600 max-w-[180px] truncate"
            title={send.lastError}
          >
            {send.lastError}
          </div>
        )}
      </td>
      <td className="p-3">
        <div className="font-medium text-xs">{send.toName ?? '(no name)'}</div>
        <div className="text-[11px] text-[var(--color-muted-foreground)] font-mono">
          {send.toEmail}
        </div>
        {send.variant && (
          <div className="mt-0.5">
            <Badge variant="outline" className="text-[9px]">
              变体 {send.variant}
            </Badge>
          </div>
        )}
      </td>
      <td className="p-3 max-w-[280px]">
        <div className="text-xs font-medium truncate" title={send.subject ?? ''}>
          {send.subject ?? '(no subject)'}
        </div>
        <div className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)] truncate">
          {send.bodySnapshot.slice(0, 80)}...
        </div>
      </td>
      <td className="p-3">
        <div className="text-xs font-medium">{send.fromName ?? ''}</div>
        <div className="text-[11px] text-[var(--color-muted-foreground)] font-mono">
          {send.fromEmail}
        </div>
      </td>
      <td className="p-3 text-[11px] font-mono text-[var(--color-muted-foreground)]">
        {send.sendingDomain}
      </td>
      <td className="p-3 text-right font-mono text-xs whitespace-nowrap">
        <div className={send.openCount > 0 ? 'text-indigo-600' : 'text-slate-400'}>
          {send.openCount} 开
        </div>
        <div className={send.clickCount > 0 ? 'text-green-600' : 'text-slate-400'}>
          {send.clickCount} 点
        </div>
      </td>
      <td className="p-3 text-[11px] text-[var(--color-muted-foreground)] whitespace-nowrap">
        {send.deliveredAt && (
          <div title={`送达: ${send.deliveredAt}`}>
            送达 {formatShort(send.deliveredAt)}
          </div>
        )}
        {!send.deliveredAt && send.sentAt && (
          <div title={`发送: ${send.sentAt}`}>
            已发 {formatShort(send.sentAt)}
          </div>
        )}
        {!send.sentAt && (
          <div title={`创建: ${send.createdAt}`}>
            创建 {formatShort(send.createdAt)}
          </div>
        )}
        {send.firstOpenedAt && (
          <div className="text-indigo-600" title={`首次打开: ${send.firstOpenedAt}`}>
            首开 {formatShort(send.firstOpenedAt)}
          </div>
        )}
        {send.bouncedAt && (
          <div className="text-red-600" title={`退信: ${send.bouncedAt}`}>
            退信 {formatShort(send.bouncedAt)}
          </div>
        )}
        {send.complainedAt && (
          <div className="text-red-700" title={`投诉: ${send.complainedAt}`}>
            投诉 {formatShort(send.complainedAt)}
          </div>
        )}
      </td>
      <td className="p-3 whitespace-nowrap">
        <Button
          size="sm"
          variant="destructive"
          disabled={!canCancel || cancelling}
          onClick={() => canCancel && onCancel(send.id)}
        >
          取消
        </Button>
      </td>
    </tr>
  );
}

function formatShort(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = (now.getTime() - d.getTime()) / 60000;
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${Math.floor(diffMin)} 分钟前`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)} 小时前`;
    return d.toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}
