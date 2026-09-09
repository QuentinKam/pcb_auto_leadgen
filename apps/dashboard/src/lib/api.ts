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
    industry: number;
    pcb_keywords: number;
    role: number;
    size: number;
    reachability: number;
  };
  modelVersion: string;
  overriddenBy: string | null;
  overrideReason: string | null;
  finalGrade: 'A' | 'B' | 'C';
  createdAt: string;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
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
  async listLeadScores(params: {
    page?: number;
    pageSize?: number;
    grade?: 'A' | 'B' | 'C';
  } = {}): Promise<LeadScoreListResponse> {
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
    body: { finalGrade: 'A' | 'B' | 'C'; overrideReason: string },
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
    },
  ): Promise<ContentDraft> {
    return request<ContentDraft>(`/api/content/drafts/${draftId}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  },
};
