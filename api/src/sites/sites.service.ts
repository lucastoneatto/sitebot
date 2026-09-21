import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/db.module';
import {
  chatSessions,
  chunks,
  crawlJobs,
  DEFAULT_SETTINGS,
  messages,
  pages,
  sites,
  usageEvents,
  type SiteSettings,
} from '../db/schema';
import { config } from '../config';
import { isPublicHost } from '../security/ssrf';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto';
import { SummaryService } from '../summary/summary.service';

const PAGE_SIZE = 50;

@Injectable()
export class SitesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly summary: SummaryService,
  ) {}

  async create(userId: string, dto: CreateSiteDto) {
    const parsed = new URL(dto.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException('Only http(s) urls are allowed');
    }
    if (!config.allowPrivateHosts && !(await isPublicHost(parsed.hostname))) {
      throw new BadRequestException(
        'Host resolves to a private/reserved address',
      );
    }

    const domain = parsed.host;
    const origin = `${parsed.protocol}//${parsed.host}`;
    const name = dto.name?.trim() || domain;

    const [site] = await this.db
      .insert(sites)
      .values({
        userId,
        name,
        url: parsed.toString(),
        domain,
        allowedOrigins: [origin],
        settings: DEFAULT_SETTINGS,
      })
      .returning();

    return site;
  }

  async list(userId: string) {
    return this.db
      .select({
        id: sites.id,
        name: sites.name,
        url: sites.url,
        domain: sites.domain,
        status: sites.status,
        createdAt: sites.createdAt,
        updatedAt: sites.updatedAt,
        // Columns are qualified with their table on purpose: interpolating
        // ${pages.siteId} makes Drizzle emit only "site_id", and inside the
        // subquery "id" would resolve to pages.id instead of sites.id,
        // comparing pages.site_id = pages.id and always returning 0.
        pageCount: sql<number>`(select count(*) from ${pages} where ${pages}."site_id" = ${sites}."id")`.mapWith(
          Number,
        ),
        chunkCount: sql<number>`(select count(*) from ${chunks} where ${chunks}."site_id" = ${sites}."id")`.mapWith(
          Number,
        ),
      })
      .from(sites)
      .where(eq(sites.userId, userId))
      .orderBy(desc(sites.createdAt));
  }

  async findOwned(id: string, userId: string) {
    const [site] = await this.db
      .select()
      .from(sites)
      .where(and(eq(sites.id, id), eq(sites.userId, userId)));
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  async detail(id: string, userId: string) {
    const site = await this.findOwned(id, userId);
    const [[job], countsResult, usageResult, feedbackResult] = await Promise.all([
      this.db
        .select()
        .from(crawlJobs)
        .where(eq(crawlJobs.siteId, id))
        .orderBy(desc(crawlJobs.createdAt))
        .limit(1),
      this.db.execute(sql`
        select
          (select count(*) from ${pages} where ${pages.siteId} = ${id})::int as page_count,
          (select count(*) from ${chunks} where ${chunks.siteId} = ${id})::int as chunk_count,
          (select count(*) from ${messages} m
             join ${chatSessions} s on s.id = m.session_id
             where s.site_id = ${id})::int as message_count
      `),
      this.db.execute(sql`
        select
          coalesce(sum(case when type = 'embedding' then cost else 0 end), 0)::float8 as indexing_cost,
          coalesce(sum(case when type = 'chat' then cost else 0 end), 0)::float8 as chat_cost,
          coalesce(sum(case when type = 'summary' then cost else 0 end), 0)::float8 as summary_cost,
          coalesce(sum(cost), 0)::float8 as total_cost,
          coalesce(sum(case when type = 'embedding' then 1 else 0 end), 0)::int as indexing_events,
          coalesce(sum(case when type = 'chat' then 1 else 0 end), 0)::int as chat_events,
          coalesce(sum(case when type = 'summary' then 1 else 0 end), 0)::int as summary_events,
          coalesce(sum(case when type = 'embedding' then total_tokens else 0 end), 0)::int as indexing_tokens,
          coalesce(sum(case when type = 'chat' then total_tokens else 0 end), 0)::int as chat_tokens
        from ${usageEvents} where ${usageEvents.siteId} = ${id}
      `),
      this.db.execute(sql`
        select
          coalesce(sum(case when m.feedback = 'up' then 1 else 0 end), 0)::int as feedback_up,
          coalesce(sum(case when m.feedback = 'down' then 1 else 0 end), 0)::int as feedback_down,
          coalesce(sum(case when m.no_info then 1 else 0 end), 0)::int as no_info,
          (select count(*) from ${chatSessions} where ${chatSessions.siteId} = ${id})::int as conversation_count
        from ${messages} m
        join ${chatSessions} s on s.id = m.session_id
        where s.site_id = ${id}
      `),
    ]);

    const counts = (countsResult.rows[0] ?? {}) as {
      page_count?: number;
      chunk_count?: number;
      message_count?: number;
    };

    const usageRow = (usageResult.rows[0] ?? {}) as {
      indexing_cost?: number;
      chat_cost?: number;
      summary_cost?: number;
      total_cost?: number;
      indexing_events?: number;
      chat_events?: number;
      summary_events?: number;
      indexing_tokens?: number;
      chat_tokens?: number;
    };

    const feedbackRow = (feedbackResult.rows[0] ?? {}) as {
      feedback_up?: number;
      feedback_down?: number;
      no_info?: number;
      conversation_count?: number;
    };

    const indexingCost = usageRow.indexing_cost ?? 0;
    const chatCost = usageRow.chat_cost ?? 0;
    const summaryCost = usageRow.summary_cost ?? 0;
    const indexingEvents = usageRow.indexing_events ?? 0;
    const chatEvents = usageRow.chat_events ?? 0;

    return {
      site,
      job: job ?? null,
      stats: {
        pageCount: counts.page_count ?? 0,
        chunkCount: counts.chunk_count ?? 0,
        messageCount: counts.message_count ?? 0,
      },
      analytics: {
        conversations: feedbackRow.conversation_count ?? 0,
        feedbackUp: feedbackRow.feedback_up ?? 0,
        feedbackDown: feedbackRow.feedback_down ?? 0,
        noInfo: feedbackRow.no_info ?? 0,
      },
      usage: {
        total: usageRow.total_cost ?? 0,
        indexing: {
          cost: indexingCost,
          pages: indexingEvents,
          tokens: usageRow.indexing_tokens ?? 0,
        },
        chat: {
          cost: chatCost,
          messages: chatEvents,
          tokens: usageRow.chat_tokens ?? 0,
        },
        summary: {
          cost: summaryCost,
          generations: usageRow.summary_events ?? 0,
        },
        avgPerMessage: chatEvents > 0 ? chatCost / chatEvents : 0,
        avgPerPage: indexingEvents > 0 ? indexingCost / indexingEvents : 0,
      },
    };
  }

  async update(id: string, userId: string, dto: UpdateSiteDto) {
    const current = await this.findOwned(id, userId);
    const incoming = dto.settings
      ? Object.fromEntries(
          Object.entries(dto.settings).filter(([, value]) => value !== undefined),
        )
      : {};
    const settings: SiteSettings = {
      ...DEFAULT_SETTINGS,
      ...(current.settings ?? {}),
      ...incoming,
    };

    const [site] = await this.db
      .update(sites)
      .set({
        name: dto.name?.trim() || current.name,
        allowedOrigins: dto.allowedOrigins ?? current.allowedOrigins,
        settings,
        autoSync: dto.autoSync ?? current.autoSync,
        syncIntervalHours: dto.syncIntervalHours ?? current.syncIntervalHours,
        // Quotas are not touched here: they belong to the operator, edited in /admin.
        updatedAt: new Date(),
      })
      .where(eq(sites.id, id))
      .returning();

    return site;
  }

  async remove(id: string, userId: string) {
    await this.findOwned(id, userId);
    await this.db.delete(sites).where(eq(sites.id, id));
    return { ok: true };
  }

  async listPages(
    id: string,
    userId: string,
    offset = 0,
    limit = PAGE_SIZE,
  ) {
    await this.findOwned(id, userId);
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: pages.id,
          url: pages.url,
          title: pages.title,
          markdown: pages.markdown,
          crawledAt: pages.crawledAt,
        })
        .from(pages)
        .where(eq(pages.siteId, id))
        .orderBy(pages.url)
        .limit(safeLimit)
        .offset(offset),
      this.db
        .select({ value: count() })
        .from(pages)
        .where(eq(pages.siteId, id)),
    ]);

    return { items: rows, total: total?.value ?? 0, offset, limit: safeLimit };
  }

  async getPage(id: string, pageId: string, userId: string) {
    await this.findOwned(id, userId);
    const [page] = await this.db
      .select()
      .from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.siteId, id)));
    if (!page) throw new NotFoundException('Page not found');
    return page;
  }

  async status(id: string, userId: string) {
    const site = await this.findOwned(id, userId);
    const [job] = await this.db
      .select()
      .from(crawlJobs)
      .where(eq(crawlJobs.siteId, id))
      .orderBy(desc(crawlJobs.createdAt))
      .limit(1);
    return { status: site.status, job: job ?? null };
  }

  async regenerateSummary(id: string, userId: string) {
    await this.findOwned(id, userId);
    const summary = await this.summary.generate(id);
    return { summary };
  }

  async regenerateWebhookSecret(id: string, userId: string) {
    await this.findOwned(id, userId);
    const secret = `sb_${randomBytes(24).toString('hex')}`;
    await this.db
      .update(sites)
      .set({ webhookSecret: secret, updatedAt: new Date() })
      .where(eq(sites.id, id));
    return { webhookSecret: secret };
  }

  async listConversations(
    id: string,
    userId: string,
    offset = 0,
    limit = PAGE_SIZE,
  ) {
    await this.findOwned(id, userId);
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const [rows, [total]] = await Promise.all([
      this.db.execute(sql`
        select
          s.id,
          s.created_at,
          count(m.id)::int as message_count,
          max(m.created_at) as last_message_at,
          count(*) filter (where m.no_info)::int as no_info_count,
          count(*) filter (where m.feedback = 'up')::int as thumbs_up,
          count(*) filter (where m.feedback = 'down')::int as thumbs_down,
          (
            select m2.content from ${messages} m2
             where m2.session_id = s.id and m2.role = 'user'
             order by m2.created_at
             limit 1
          ) as preview
        from ${chatSessions} s
        left join ${messages} m on m.session_id = s.id
        where s.site_id = ${id}
        group by s.id
        order by s.created_at desc
        limit ${safeLimit} offset ${offset}
      `),
      this.db
        .select({ value: count() })
        .from(chatSessions)
        .where(eq(chatSessions.siteId, id)),
    ]);

    const items = (rows.rows as {
      id: string;
      created_at: Date;
      message_count: number;
      last_message_at: Date | null;
      no_info_count: number;
      thumbs_up: number;
      thumbs_down: number;
      preview: string | null;
    }[]).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      messageCount: row.message_count,
      lastMessageAt: row.last_message_at,
      noInfoCount: row.no_info_count,
      thumbsUp: row.thumbs_up,
      thumbsDown: row.thumbs_down,
      preview: row.preview,
    }));

    return { items, total: total?.value ?? 0, offset, limit: safeLimit };
  }

  async getConversation(id: string, sessionId: string, userId: string) {
    await this.findOwned(id, userId);
    const [session] = await this.db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.siteId, id)));
    if (!session) throw new NotFoundException('Conversation not found');

    const rows = await this.db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        sources: messages.sources,
        feedback: messages.feedback,
        noInfo: messages.noInfo,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt);

    return { session, messages: rows };
  }
}
