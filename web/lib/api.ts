import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const SERVER_API_URL = process.env.API_URL ?? PUBLIC_API_URL;

export type SiteStatus = 'pending' | 'crawling' | 'ready' | 'error';

export type SiteSettings = {
  color: string;
  greeting: string;
  customPrompt: string;
  temperature: number;
  maxPages: number;
  maxDepth: number;
};

export type Site = {
  id: string;
  name: string;
  url: string;
  domain: string;
  status: SiteStatus;
  summary: string | null;
  allowedOrigins: string[];
  settings: SiteSettings;
  autoSync: boolean;
  syncIntervalHours: number;
  lastCrawledAt: string | null;
  /** Cuotas fijadas por el operador; solo lectura para el usuario. */
  monthlyMessageLimit: number | null;
  monthlyBudgetUsd: number | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationItem = {
  id: string;
  createdAt: string;
  messageCount: number;
  lastMessageAt: string | null;
  preview: string | null;
  noInfoCount: number;
  thumbsUp: number;
  thumbsDown: number;
};

export type ConversationList = {
  items: ConversationItem[];
  total: number;
  offset: number;
  limit: number;
};

export type ConversationDetail = {
  session: { id: string; createdAt: string };
  messages: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    sources: { url: string; title: string | null }[];
    feedback: 'up' | 'down' | null;
    noInfo: boolean;
    createdAt: string;
  }[];
};

export type AdminOverview = {
  users: number;
  sites: number;
  sitesError: number;
  sitesCrawling: number;
  monthlyCost: number;
  monthlyMessages: number;
};

export type AdminUser = {
  id: string;
  email: string;
  plan: 'free' | 'paid';
  createdAt: string;
  siteCount: number;
  monthlyCost: number;
};

export type AdminSite = {
  id: string;
  name: string;
  url: string;
  status: SiteStatus;
  userId: string;
  ownerEmail: string;
  ownerPlan: 'free' | 'paid';
  monthlyMessageLimit: number | null;
  monthlyBudgetUsd: number | null;
  autoSync: boolean;
  lastCrawledAt: string | null;
  monthlyCost: number;
  monthlyMessages: number;
};

export type SiteListItem = Site & { pageCount: number; chunkCount: number };

export type PageItem = {
  id: string;
  url: string;
  title: string | null;
  markdown?: string;
  crawledAt: string;
};

export type PageDetail = PageItem & { markdown: string };

export type PageList = {
  items: PageItem[];
  total: number;
  offset: number;
  limit: number;
};

export type CrawlJob = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  pagesFound: number;
  pagesCrawled: number;
  pagesChanged: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type UsageSummary = {
  total: number;
  indexing: { cost: number; pages: number; tokens: number };
  chat: { cost: number; messages: number; tokens: number };
  summary: { cost: number; generations: number };
  avgPerMessage: number;
  avgPerPage: number;
};

export type SiteDetail = {
  site: Site;
  job: CrawlJob | null;
  stats: { pageCount: number; chunkCount: number; messageCount: number };
  usage: UsageSummary;
};

export type AuthResult = { token: string; user: { id: string; email: string } };

async function serverRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get('sitebot_token')?.value;
  const res = await fetch(`${SERVER_API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) redirect('/login');
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SERVER_API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    publicRequest<AuthResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string) =>
    publicRequest<AuthResult>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => serverRequest<{ userId: string; email: string }>('/auth/me'),

  listSites: () => serverRequest<SiteListItem[]>('/sites'),
  createSite: (name: string, url: string) =>
    serverRequest<Site>('/sites', {
      method: 'POST',
      body: JSON.stringify({ name, url }),
    }),
  getSite: (id: string) => serverRequest<SiteDetail>(`/sites/${id}`),
  deleteSite: (id: string) =>
    serverRequest<{ ok: boolean }>(`/sites/${id}`, { method: 'DELETE' }),
  crawlSite: (id: string) =>
    serverRequest<CrawlJob>(`/sites/${id}/crawl`, { method: 'POST' }),
  regenerateSummary: (id: string) =>
    serverRequest<{ summary: string }>(`/sites/${id}/summary`, {
      method: 'POST',
    }),
  updateSite: (
    id: string,
    body: Partial<{
      name: string;
      allowedOrigins: string[];
      settings: Partial<SiteSettings>;
      autoSync: boolean;
      syncIntervalHours: number;
    }>,
  ) =>
    serverRequest<Site>(`/sites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listPages: (id: string, offset = 0, limit = 50) =>
    serverRequest<PageList>(`/sites/${id}/pages?offset=${offset}&limit=${limit}`),
  getPage: (id: string, pageId: string) =>
    serverRequest<PageDetail>(`/sites/${id}/pages/${pageId}`),
  listConversations: (id: string, offset = 0, limit = 50) =>
    serverRequest<ConversationList>(
      `/sites/${id}/conversations?offset=${offset}&limit=${limit}`,
    ),
  getConversation: (id: string, sessionId: string) =>
    serverRequest<ConversationDetail>(
      `/sites/${id}/conversations/${sessionId}`,
    ),
  forgotPassword: (email: string) =>
    publicRequest<{ ok: boolean }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, password: string) =>
    publicRequest<{ ok: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
};

/**
 * Panel del operador. Se autentica con basic auth desde el servidor:
 * las credenciales nunca llegan al navegador del usuario.
 */
async function adminRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const user = process.env.ADMIN_USER ?? '';
  const password = process.env.ADMIN_PASSWORD ?? '';
  const credentials = Buffer.from(`${user}:${password}`).toString('base64');

  const res = await fetch(`${SERVER_API_URL}/admin${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

export const adminApi = {
  overview: () => adminRequest<AdminOverview>('/overview'),
  users: () => adminRequest<AdminUser[]>('/users'),
  setPlan: (userId: string, plan: 'free' | 'paid') =>
    adminRequest<{ id: string }>(`/users/${userId}/plan`, {
      method: 'PATCH',
      body: JSON.stringify({ plan }),
    }),
  sites: () => adminRequest<AdminSite[]>('/sites'),
  setQuota: (
    siteId: string,
    quota: {
      monthlyMessageLimit?: number | null;
      monthlyBudgetUsd?: number | null;
    },
  ) =>
    adminRequest<{ id: string }>(`/sites/${siteId}/quota`, {
      method: 'PATCH',
      body: JSON.stringify(quota),
    }),
  crawl: (siteId: string) =>
    adminRequest<{ id: string }>(`/sites/${siteId}/crawl`, { method: 'POST' }),
};

export function embedSnippet(siteId: string): string {
  return `<script src="${PUBLIC_API_URL}/widget.js" data-site-id="${siteId}" defer></script>`;
}
