import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const tsVector = customType<{ data: SQL }>({
  dataType: () => 'tsvector',
});

export const EMBEDDING_DIM = 384;

export const siteStatusEnum = pgEnum('site_status', [
  'pending',
  'crawling',
  'ready',
  'error',
]);

export const crawlJobStatusEnum = pgEnum('crawl_job_status', [
  'queued',
  'running',
  'done',
  'error',
]);

export const messageRoleEnum = pgEnum('message_role', ['user', 'assistant']);

export const usageTypeEnum = pgEnum('usage_type', [
  'embedding',
  'chat',
  'summary',
]);

export const userPlanEnum = pgEnum('user_plan', ['free', 'paid']);

export const feedbackEnum = pgEnum('feedback', ['up', 'down']);

export type SiteSettings = {
  color: string;
  greeting: string;
  customPrompt: string;
  temperature: number;
  maxPages: number;
  maxDepth: number;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  color: '#4f46e5',
  greeting: 'Hi! How can I help you?',
  customPrompt: '',
  temperature: 0.2,
  maxPages: 20,
  maxDepth: 2,
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  plan: userPlanEnum('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sites = pgTable(
  'sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    domain: text('domain').notNull(),
    status: siteStatusEnum('status').notNull().default('pending'),
    summary: text('summary'),
    allowedOrigins: text('allowed_origins')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    settings: jsonb('settings')
      .$type<SiteSettings>()
      .notNull()
      .default(DEFAULT_SETTINGS),
    autoSync: boolean('auto_sync').notNull().default(false),
    syncIntervalHours: integer('sync_interval_hours').notNull().default(24),
    lastCrawledAt: timestamp('last_crawled_at', { withTimezone: true }),
    monthlyMessageLimit: integer('monthly_message_limit'),
    monthlyBudgetUsd: doublePrecision('monthly_budget_usd'),
    webhookSecret: text('webhook_secret'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sites_user_idx').on(t.userId)],
);

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title'),
    markdown: text('markdown').notNull(),
    contentHash: text('content_hash').notNull(),
    statusCode: integer('status_code'),
    crawledAt: timestamp('crawled_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pages_site_url_idx').on(t.siteId, t.url)],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIM }).notNull(),
    search: tsVector('search').notNull(),
  },
  (t) => [
    index('chunks_site_idx').on(t.siteId),
    index('chunks_embedding_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
    index('chunks_search_idx').using('gin', t.search),
  ],
);

export const crawlJobs = pgTable('crawl_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  status: crawlJobStatusEnum('status').notNull().default('queued'),
  pagesFound: integer('pages_found').notNull().default(0),
  pagesCrawled: integer('pages_crawled').notNull().default(0),
  pagesChanged: integer('pages_changed').notNull().default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const chatSessions = pgTable('chat_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  sources: jsonb('sources').$type<ChatSource[]>().notNull().default([]),
  feedback: feedbackEnum('feedback'),
  noInfo: boolean('no_info').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('password_reset_user_idx').on(t.userId)],
);

export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    type: usageTypeEnum('type').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    cost: doublePrecision('cost').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('usage_site_idx').on(t.siteId)],
);

export type ChatSource = {
  url: string;
  title: string | null;
  score: number;
};

export type User = typeof users.$inferSelect;
export type Site = typeof sites.$inferSelect;
export type Page = typeof pages.$inferSelect;
export type CrawlJob = typeof crawlJobs.$inferSelect;
export type UsageType = typeof usageEvents.$inferSelect['type'];
export type Feedback = typeof messages.$inferSelect['feedback'];
export type UserPlan = typeof users.$inferSelect['plan'];
