/**
 * Gateway API client
 * 所有调用通过此模块，统一带 X-Tenant-Id header
 *
 * 开发期：Vite proxy 转发 /api → http://localhost:3001
 * 生产期：同域部署或通过 gateway URL
 */

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? '';
const TENANT_ID = import.meta.env.VITE_TENANT_ID ?? 'dev-tenant';
const USER_ID = import.meta.env.VITE_USER_ID ?? '';

export interface LeadScoreListResponse {
  data: LeadScoreItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LeadScoreItem {
  id: string;
  tenantId: string;
  companyId: string;
  contactId: string | null;
  score: number;
  grade: 'A' | 'B' | 'C';
  reason: string;
  dimensionBreakdown: {
    industryFit: number;
    hardwareProductFit: number;
    pcbRelevance: number;
    companyFit: number;
    demandSignal: number;
    negativePenalty: number;
  };
  evidence: Array<{
    signalType: string;
    description: string;
    snippet?: string;
    sourceUrl?: string;
    confidence: number;
  }>;
  buyerFit: number;
  demandSignal: number;
  negativePenalty: number;
  excluded: boolean;
  modelVersion: string;
  overriddenBy: string | null;
  overrideReason: string | null;
  finalGrade: 'A' | 'B' | 'C';
  createdAt: string;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${GATEWAY_URL}${path}`;
  const headers = new Headers(options.headers);
  headers.set('X-Tenant-Id', TENANT_ID);
  if (USER_ID) headers.set('X-User-Id', USER_ID);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ProfileResponse {
  id: string;
  tenantId: string;
  companyId: string;
  businessSummary: string | null;
  productTypes: string[] | null;
  customerType: string | null;
  painPoints: string[] | null;
  buyingSignals: string[] | null;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
}

export type ContentFormat = 'cold_email' | 'linkedin_dm' | 'industry_blog';
export type ContentVariant = 'A' | 'B';
export type ContentStatus = 'generated' | 'approved' | 'rejected' | 'sent';

export interface ContentDraft {
  id: string;
  tenantId: string;
  companyId: string;
  contactId: string | null;
  profileId: string | null;
  format: ContentFormat;
  variant: ContentVariant;
  subject: string | null;
  body: string;
  status: ContentStatus;
  usedFacts: string[] | null;
  gaps: string[] | null;
  model: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export const api = {
  async listLeadScores(
    params: {
      page?: number;
      pageSize?: number;
      grade?: 'A' | 'B' | 'C';
    } = {}
  ): Promise<LeadScoreListResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.grade) query.set('grade', params.grade);
    return request<LeadScoreListResponse>(`/api/lead-scores?${query}`);
  },

  async getLeadScore(id: string): Promise<LeadScoreItem> {
    return request<LeadScoreItem>(`/api/lead-scores/${id}`);
  },

  async overrideLeadScore(
    id: string,
    body: { finalGrade: 'A' | 'B' | 'C'; overrideReason: string }
  ): Promise<LeadScoreItem> {
    return request<LeadScoreItem>(`/api/lead-scores/${id}/override`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async listCompanies(params: { page?: number; pageSize?: number } = {}) {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    return request<{
      data: Array<{
        id: string;
        name: string;
        website: string | null;
        industry: string | null;
        sizeBucket: string | null;
        createdAt: string;
      }>;
      total: number;
      page: number;
      pageSize: number;
    }>(`/api/companies?${query}`);
  },

  async generateProfile(companyId: string): Promise<ProfileResponse> {
    return request<ProfileResponse>(`/api/content/profile/${companyId}`, {
      method: 'POST',
    });
  },

  /** 只读画像：不存在返回 null，不触发 LLM */
  async getProfile(companyId: string): Promise<ProfileResponse | null> {
    try {
      return await request<ProfileResponse>(`/api/content/profile/${companyId}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('HTTP 404')) return null;
      throw err;
    }
  },

  async generateContent(params: {
    companyId: string;
    contactId?: string;
    format: ContentFormat;
    variant?: ContentVariant;
  }): Promise<ContentDraft[]> {
    return request<ContentDraft[]>('/api/content/generate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async listContentDrafts(companyId: string): Promise<ContentDraft[]> {
    return request<ContentDraft[]>(`/api/content/drafts/${companyId}`);
  },

  async updateContentDraft(
    draftId: string,
    params: {
      status?: ContentStatus;
      body?: string;
      subject?: string;
    }
  ): Promise<ContentDraft> {
    return request<ContentDraft>(`/api/content/drafts/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  },
};

export type EmailSendStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'cancelled';

export interface EmailSendItem {
  id: string;
  tenantId: string;
  campaignId: string | null;
  companyId: string;
  contactId: string;
  contentDraftId: string | null;
  resendMessageId: string | null;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  toName: string | null;
  sendingDomain: string;
  subject: string | null;
  bodySnapshot: string;
  variant: string | null;
  status: EmailSendStatus;
  retryCount: number;
  lastError: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  firstClickedAt: string | null;
  lastClickedAt: string | null;
  clickCount: number;
  bouncedAt: string | null;
  bounceType: string | null;
  complainedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailSendListResponse {
  total: number;
  limit: number;
  offset: number;
  items: EmailSendItem[];
}

export interface EmailCampaignItem {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  format: string;
  status: string;
  targetScoreMin: number | null;
  targetScoreMax: number | null;
  totalTargets: number;
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  totalBounced: number;
  totalComplained: number;
  isWarmup: boolean;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailCampaignListResponse {
  total: number;
  limit: number;
  offset: number;
  items: EmailCampaignItem[];
}

export interface MailStatsResponse {
  totalSent: number;
  totalDelivered: number;
  totalOpened: number;
  totalClicked: number;
  totalReplied: number;
  totalBouncedHard: number;
  totalBouncedSoft: number;
  totalComplained: number;
  complaintRate: number;
  openRate: number;
  clickRate: number;
  bounceRate: number;
}

export interface WarmupStatusResponse {
  startDate: string;
  elapsedDays: number;
  totalWeeks: number;
  todaysEntry: { absoluteDay: number; week: number; dayOfWeek: number; targetCount: number } | null;
  todaySent: number;
  todayRemaining: number;
  seedPool: { totalAvailable: number; sample: string[] };
  sendingDomains: string[];
  campaignStats: {
    totalSent: number;
    totalDelivered: number;
    totalOpened: number;
    totalClicked: number;
    totalBounced: number;
    totalComplained: number;
  };
  reputationScore: number;
  queue: { waiting: number; active: number; delayed: number };
}

export interface EnqueueSingleResponse {
  id: string;
  status: string;
}

export const mailApi = {
  async getStats(): Promise<MailStatsResponse> {
    return request<MailStatsResponse>('/api/mails/stats');
  },

  async listCampaigns(
    params: {
      page?: number;
      pageSize?: number;
      isWarmup?: boolean;
    } = {}
  ): Promise<EmailCampaignListResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('offset', String((params.page - 1) * (params.pageSize ?? 50)));
    if (params.pageSize) query.set('limit', String(params.pageSize));
    if (params.isWarmup !== undefined) query.set('isWarmup', String(params.isWarmup));
    return request<EmailCampaignListResponse>(`/api/mails/campaigns?${query}`);
  },

  async listSends(
    params: {
      page?: number;
      pageSize?: number;
      status?: EmailSendStatus;
      campaignId?: string;
      companyId?: string;
    } = {}
  ): Promise<EmailSendListResponse> {
    const query = new URLSearchParams();
    if (params.page) query.set('offset', String((params.page - 1) * (params.pageSize ?? 50)));
    if (params.pageSize) query.set('limit', String(params.pageSize));
    if (params.status) query.set('status', params.status);
    if (params.campaignId) query.set('campaignId', params.campaignId);
    if (params.companyId) query.set('companyId', params.companyId);
    return request<EmailSendListResponse>(`/api/mails/sends?${query}`);
  },

  async getSend(id: string): Promise<EmailSendItem> {
    return request<EmailSendItem>(`/api/mails/sends/${id}`);
  },

  async cancelSend(id: string): Promise<{ id: string; status: string }> {
    return request<{ id: string; status: string }>(`/api/mails/sends/${id}/cancel`, {
      method: 'POST',
    });
  },

  async enqueueSingle(params: {
    companyId: string;
    contactId: string;
    contentDraftId?: string;
    campaignId?: string;
    variant?: 'A' | 'B';
    fromEmail?: string;
    fromName?: string;
    subject?: string;
    bodyOverride?: string;
  }): Promise<EnqueueSingleResponse> {
    return request<EnqueueSingleResponse>('/api/mails/sends/single', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async getWarmupStatus(): Promise<WarmupStatusResponse> {
    return request<WarmupStatusResponse>('/api/mails/warmup/status');
  },
};

export interface ContactItem {
  id: string;
  tenantId: string;
  companyId: string;
  email: string | null;
  name: string | null;
  title: string | null;
  linkedinUrl: string | null;
  emailVerified: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export const contactsApi = {
  async listContacts(
    params: {
      companyId?: string;
      hasEmail?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ total: number; limit: number; offset: number; items: ContactItem[] }> {
    const query = new URLSearchParams();
    if (params.companyId) query.set('companyId', params.companyId);
    if (params.hasEmail !== undefined) query.set('hasEmail', String(params.hasEmail));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));
    return request(`/api/contacts?${query}`);
  },

  async getFirstContactByCompany(companyId: string): Promise<ContactItem> {
    return request<ContactItem>(`/api/contacts/first-by-company/${companyId}`);
  },
};
