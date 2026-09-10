import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  mailApi,
  contactsApi,
  type ContentDraft,
  type ContentFormat,
  type ProfileResponse,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const COMPANY_PAGE_SIZE = 10;
const CUSTOMER_TYPE_LABEL: Record<string, string> = {
  startup_hardware: '初创硬件',
  industrial_equipment: '工业设备',
  consumer_electronics: '消费电子',
  medical_device: '医疗器械',
  automotive: '汽车电子',
  aerospace: '航空航天',
  telecom: '通信设备',
  iot: '物联网',
  other: '其他',
};

const FORMAT_LABEL: Record<ContentFormat, string> = {
  cold_email: '开发信',
  linkedin_dm: 'LinkedIn 私信',
  industry_blog: '行业博客',
};

const STATUS_LABEL: Record<ContentDraft['status'], string> = {
  generated: '已生成',
  approved: '已批准',
  rejected: '已驳回',
  sent: '已发送',
};

const STATUS_VARIANT: Record<ContentDraft['status'], 'outline' | 'default' | 'gradeA' | 'gradeC'> = {
  generated: 'outline',
  approved: 'gradeA',
  rejected: 'gradeC',
  sent: 'default',
};

interface CompanyRow {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  sizeBucket: string | null;
}

export function ContentReviewPage() {
  const [companyPage, setCompanyPage] = useState(1);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [formatFilter, setFormatFilter] = useState<ContentFormat | 'ALL'>('ALL');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const queryClient = useQueryClient();

  const { data: companiesData, isLoading: companiesLoading } = useQuery({
    queryKey: ['companies', companyPage],
    queryFn: () => api.listCompanies({ page: companyPage, pageSize: COMPANY_PAGE_SIZE }),
  });
  const companies = companiesData?.data ?? [];
  const totalCompanies = companiesData?.total ?? 0;
  const totalCompanyPages = Math.max(1, Math.ceil(totalCompanies / COMPANY_PAGE_SIZE));

  const {
    data: drafts,
    isLoading: draftsLoading,
    error: draftsError,
    refetch: refetchDrafts,
  } = useQuery({
    queryKey: ['contentDrafts', selectedCompanyId],
    queryFn: () => api.listContentDrafts(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const {
    data: profile,
    isLoading: profileLoading,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ['profile', selectedCompanyId],
    queryFn: async () => {
      try {
        return await api.generateProfile(selectedCompanyId!);
      } catch (err) {
        console.warn('generate profile failed', err);
        return null as ProfileResponse | null;
      }
    },
    enabled: !!selectedCompanyId,
    staleTime: 5 * 60 * 1000,
  });

  const selectedCompany: CompanyRow | undefined = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId),
    [companies, selectedCompanyId],
  );

  const filteredDrafts = useMemo(() => {
    if (!drafts) return [];
    if (formatFilter === 'ALL') return drafts;
    return drafts.filter((d) => d.format === formatFilter);
  }, [drafts, formatFilter]);

  const groupedByFormat = useMemo(() => {
    const map = new Map<ContentFormat, ContentDraft[]>();
    for (const d of filteredDrafts) {
      if (!map.has(d.format)) map.set(d.format, []);
      map.get(d.format)!.push(d);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.variant.localeCompare(b.variant));
    }
    return map;
  }, [filteredDrafts]);

  const regenerateProfile = useMutation({
    mutationFn: () => api.generateProfile(selectedCompanyId!),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ['profile', selectedCompanyId] });
      await refetchProfile();
    },
  });

  const generateContent = useMutation({
    mutationFn: (format: ContentFormat) =>
      api.generateContent({ companyId: selectedCompanyId!, format }),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ['contentDrafts', selectedCompanyId] });
      await refetchDrafts();
    },
  });

  const updateDraft = useMutation({
    mutationFn: (params: { id: string; status?: ContentDraft['status']; body?: string; subject?: string }) =>
      api.updateContentDraft(params.id, { status: params.status, body: params.body, subject: params.subject }),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ['contentDrafts', selectedCompanyId] });
      setEditingDraftId(null);
      setEditSubject('');
      setEditBody('');
      await refetchDrafts();
    },
  });

  const sendDraft = useMutation({
    mutationFn: async (draft: ContentDraft) => {
      if (!selectedCompanyId) throw new Error('未选择公司');
      if (draft.status !== 'approved' && draft.status !== 'generated') {
        throw new Error(`状态 ${draft.status} 不可发送，仅 generated 或 approved 可发`);
      }

      if (draft.status !== 'approved') {
        await api.updateContentDraft(draft.id, { status: 'approved' });
      }

      const contact = await contactsApi.getFirstContactByCompany(selectedCompanyId);
      if (!contact || !contact.email) {
        throw new Error('该公司没有可用邮箱的联系人，请先补充联系人');
      }

      const enqueueRes = await mailApi.enqueueSingle({
        companyId: selectedCompanyId,
        contactId: contact.id,
        contentDraftId: draft.id,
        variant: draft.variant,
      });

      await api.updateContentDraft(draft.id, { status: 'sent' });
      return enqueueRes;
    },
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ['contentDrafts', selectedCompanyId] });
      void queryClient.invalidateQueries({ queryKey: ['mailStats'] });
      void queryClient.invalidateQueries({ queryKey: ['emailSends'] });
      await refetchDrafts();
    },
  });

  const sendingLoading = sendDraft.isPending || updateDraft.isPending;

  function startEdit(draft: ContentDraft) {
    setEditingDraftId(draft.id);
    setEditSubject(draft.subject ?? '');
    setEditBody(draft.body);
  }

  function cancelEdit() {
    setEditingDraftId(null);
    setEditSubject('');
    setEditBody('');
  }

  async function saveEdit(draftId: string) {
    await updateDraft.mutateAsync({ id: draftId, subject: editSubject, body: editBody });
  }

  const contentGenerating = generateContent.isPending;
  const profileGenerating = regenerateProfile.isPending;
  const actionLoading = contentGenerating || profileGenerating || sendingLoading;

  return (
    <div className="min-h-screen bg-[var(--color-background)] p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold">内容审核</h1>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              选择左侧公司 → 查看客户画像 → 生成 A/B 内容 → 审批 / 驳回 / 编辑
            </p>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          {/* 左侧：公司列表 */}
          <Card className="col-span-12 lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-lg">公司列表</CardTitle>
              <CardDescription>
                共 {totalCompanies} 家 · 第 {companyPage}/{totalCompanyPages} 页
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {companiesLoading && <p className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">加载中...</p>}
              {!companiesLoading && companies.length === 0 && (
                <p className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">暂无公司</p>
              )}
              {companies.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelectedCompanyId(c.id);
                    setEditingDraftId(null);
                  }}
                  className={`block w-full rounded-md border p-3 text-left text-sm transition ${
                    selectedCompanyId === c.id
                      ? 'border-[var(--color-ring)] bg-[var(--color-accent)]'
                      : 'border-[var(--color-border)] hover:bg-[var(--color-accent)]'
                  }`}
                >
                  <div className="font-medium">{c.name}</div>
                  <div className="mt-1 text-xs text-[var(--color-muted-foreground)] truncate">
                    {c.industry ?? '未知行业'} · {c.sizeBucket ?? '规模未知'}
                  </div>
                </button>
              ))}
              <div className="mt-4 flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={companyPage <= 1 || companiesLoading}
                  onClick={() => setCompanyPage((p) => p - 1)}
                >
                  上一页
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={companyPage >= totalCompanyPages || companiesLoading}
                  onClick={() => setCompanyPage((p) => p + 1)}
                >
                  下一页
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 中间：画像卡 */}
          <Card className="col-span-12 lg:col-span-4">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">
                  {selectedCompany?.name ?? '未选择公司'}
                </CardTitle>
                <CardDescription>
                  {selectedCompany?.website
                    ? selectedCompany.website.replace(/^https?:\/\//, '')
                    : '请选择左侧公司'}
                </CardDescription>
              </div>
              {selectedCompanyId && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={actionLoading || !selectedCompanyId}
                  onClick={() => regenerateProfile.mutate()}
                >
                  {profileGenerating ? '生成中...' : '重新画像'}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {!selectedCompanyId && (
                <p className="py-12 text-center text-[var(--color-muted-foreground)]">
                  从左侧选择一家公司查看画像
                </p>
              )}
              {selectedCompanyId && profileLoading && (
                <p className="py-12 text-center text-[var(--color-muted-foreground)]">画像生成中...</p>
              )}
              {selectedCompanyId && !profileLoading && !profile && (
                <div className="rounded-md border border-[var(--color-destructive)] p-4 text-[var(--color-destructive)]">
                  画像生成失败，请稍后重试
                </div>
              )}
              {profile && (
                <>
                  <Section title="业务摘要">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {profile.businessSummary ?? '无'}
                    </p>
                  </Section>
                  <Section title="客户类型">
                    <Badge variant="outline">
                      {profile.customerType
                        ? CUSTOMER_TYPE_LABEL[profile.customerType] ?? profile.customerType
                        : '未识别'}
                    </Badge>
                  </Section>
                  <Section title="产品类型">
                    <TagList tags={profile.productTypes ?? []} />
                  </Section>
                  <Section title="潜在痛点">
                    <BulletList items={profile.painPoints ?? []} />
                  </Section>
                  <Section title="采购信号">
                    <BulletList items={profile.buyingSignals ?? []} />
                  </Section>
                  <div className="flex items-center justify-between pt-2 text-xs text-[var(--color-muted-foreground)] border-t border-[var(--color-border)]">
                    <span>模型版本：{profile.modelVersion}</span>
                    <span>更新于：{new Date(profile.updatedAt).toLocaleString('zh-CN')}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* 右侧：内容操作 + A/B 并排 */}
          <div className="col-span-12 lg:col-span-5 space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg">触达内容</CardTitle>
                  <CardDescription>
                    {draftsLoading
                      ? '加载草稿中...'
                      : draftsError
                        ? '加载失败：' + draftsError.message
                        : `共 ${filteredDrafts.length} 条草稿`}
                  </CardDescription>
                </div>
                {selectedCompanyId && profile && (
                  <div className="flex items-center gap-2">
                    <select
                      value={formatFilter}
                      onChange={(e) => setFormatFilter(e.target.value as ContentFormat | 'ALL')}
                      className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs"
                    >
                      <option value="ALL">全部格式</option>
                      <option value="cold_email">开发信</option>
                      <option value="linkedin_dm">LinkedIn 私信</option>
                      <option value="industry_blog">行业博客</option>
                    </select>
                    <Button
                      size="sm"
                      disabled={contentGenerating}
                      onClick={() =>
                        generateContent.mutate(
                          (formatFilter === 'ALL' ? 'cold_email' : formatFilter) as ContentFormat,
                        )
                      }
                    >
                      {contentGenerating
                        ? '生成中...'
                        : `生成 ${formatFilter === 'ALL' ? '开发信' : FORMAT_LABEL[formatFilter as ContentFormat]} A/B`}
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-6">
                {!selectedCompanyId && (
                  <p className="py-12 text-center text-[var(--color-muted-foreground)]">
                    选择左侧公司并生成画像后，可在此生成 A/B 内容
                  </p>
                )}
                {selectedCompanyId && !profile && !profileLoading && (
                  <p className="py-12 text-center text-[var(--color-muted-foreground)]">
                    请先点击「重新画像」生成客户画像
                  </p>
                )}
                {selectedCompanyId &&
                  profile &&
                  Array.from(groupedByFormat.entries()).length === 0 &&
                  !draftsLoading && (
                    <div className="rounded-md border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                      暂无草稿，点击右上角「生成」按钮开始
                    </div>
                  )}
                {Array.from(groupedByFormat.entries()).map(([fmt, list]) => (
                  <div key={fmt}>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-base font-semibold">{FORMAT_LABEL[fmt]}</h3>
                      <Badge variant="outline">{list.length} 条</Badge>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {list.map((d) => (
                        <DraftCard
                          key={d.id}
                          draft={d}
                          isEditing={editingDraftId === d.id}
                          editSubject={editSubject}
                          editBody={editBody}
                          onEditSubject={setEditSubject}
                          onEditBody={setEditBody}
                          onStartEdit={() => startEdit(d)}
                          onCancelEdit={cancelEdit}
                          onSaveEdit={() => saveEdit(d.id)}
                          onApprove={() => updateDraft.mutate({ id: d.id, status: 'approved' })}
                          onReject={() => updateDraft.mutate({ id: d.id, status: 'rejected' })}
                          onSendDraft={() => sendDraft.mutate(d)}
                          sendError={sendDraft.error?.message}
                          actionLoading={actionLoading}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function TagList({ tags }: { tags: string[] }) {
  if (!tags || tags.length === 0) return <span className="text-[var(--color-muted-foreground)]">无</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t, i) => (
        <Badge key={i} variant="outline" className="text-xs">
          {t}
        </Badge>
      ))}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items || items.length === 0) return <span className="text-[var(--color-muted-foreground)]">无</span>;
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

interface DraftCardProps {
  draft: ContentDraft;
  isEditing: boolean;
  editSubject: string;
  editBody: string;
  onEditSubject: (s: string) => void;
  onEditBody: (s: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => Promise<void> | void;
  onApprove: () => void;
  onReject: () => void;
  onSendDraft: () => void;
  sendError?: string;
  actionLoading: boolean;
}

function DraftCard({
  draft,
  isEditing,
  editSubject,
  editBody,
  onEditSubject,
  onEditBody,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onApprove,
  onReject,
  onSendDraft,
  sendError,
  actionLoading,
}: DraftCardProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={draft.variant === 'A' ? 'default' : 'outline'}>变体 {draft.variant}</Badge>
            <Badge variant={STATUS_VARIANT[draft.status]}>{STATUS_LABEL[draft.status]}</Badge>
            {draft.approvedAt && (
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {new Date(draft.approvedAt).toLocaleString('zh-CN')}
              </span>
            )}
          </div>
        </div>
        {isEditing ? (
          <input
            value={editSubject}
            onChange={(e) => onEditSubject(e.target.value)}
            placeholder="Subject"
            className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm font-semibold"
          />
        ) : (
          draft.subject && (
            <div className="mt-2 font-semibold text-sm leading-snug">{draft.subject}</div>
          )
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {isEditing ? (
          <textarea
            value={editBody}
            onChange={(e) => onEditBody(e.target.value)}
            rows={14}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm font-mono leading-relaxed"
          />
        ) : (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans max-h-[360px] overflow-y-auto border border-[var(--color-border)] rounded-md p-3">
            {draft.body}
          </pre>
        )}
        {(draft.usedFacts && draft.usedFacts.length > 0) || (draft.gaps && draft.gaps.length > 0) ? (
          <div className="space-y-1 pt-2 border-t border-dashed border-[var(--color-border)] text-xs">
            {draft.usedFacts && draft.usedFacts.length > 0 && (
              <div className="text-[var(--color-muted-foreground)]">
                引用事实：
                {draft.usedFacts.map((id) => (
                  <Badge key={id} variant="outline" className="ml-1 text-[10px]">
                    {id}
                  </Badge>
                ))}
              </div>
            )}
            {draft.gaps && draft.gaps.length > 0 && (
              <div className="text-[var(--color-destructive)]">
                数据缺口：{draft.gaps.join('; ')}
              </div>
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-2">
          {isEditing ? (
            <>
              <Button size="sm" onClick={() => onSaveEdit()} disabled={actionLoading}>
                保存
              </Button>
              <Button size="sm" variant="outline" onClick={onCancelEdit} disabled={actionLoading}>
                取消
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="default"
                disabled={actionLoading || draft.status === 'approved' || draft.status === 'sent'}
                onClick={onApprove}
              >
                批准
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={actionLoading || draft.status === 'rejected'}
                onClick={onReject}
              >
                驳回
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={actionLoading || draft.status === 'sent'}
                onClick={onStartEdit}
              >
                编辑
              </Button>
              <Button
                size="sm"
                variant="default"
                disabled={actionLoading || draft.status === 'sent' || draft.status === 'rejected'}
                onClick={onSendDraft}
              >
                {draft.status === 'sent' ? '已入队' : draft.status === 'approved' ? '入队发送' : '批准并发信'}
              </Button>
            </>
          )}
          {sendError && (
            <div className="mt-2 rounded-md border border-[var(--color-destructive)] bg-red-50 p-2 text-[11px] text-[var(--color-destructive)]">
              发送失败：{sendError}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
