import { createHash } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Browser } from 'playwright';
import { Worker, type Job, type Queue } from 'bullmq';
import type IORedis from 'ioredis';
import { DRIZZLE, Database } from '../db/db.module';
import { crawlJobs, pages, sites, type SiteSettings } from '../db/schema';
import { config } from '../config';
import { htmlToMarkdown, type ExtractedPage } from './html-to-markdown';
import { extractLinks, fetchHtml } from './http';
import { RobotsPolicy } from './robots';
import { discoverSitemapUrls } from './sitemap';
import { isCrawlableUrl, isSameHost, normalizeUrl, originOf } from './url';
import { IngestService } from '../ingest/ingest.service';
import { SummaryService } from '../summary/summary.service';
import { isPublicHost } from '../security/ssrf';
import { computeStaleUrls } from './reconcile';
import { CRAWL_QUEUE, CRAWL_QUEUE_NAME, REDIS_CONNECTION } from '../queue/queue.module';

const JS_SHELL_MIN_CHARS = 500;
const CRAWL_STATE_TTL_SECONDS = 24 * 3_600;
const ACTIVE_CRAWL_TTL_SECONDS = 3_600;

interface PageJobData {
  crawlJobId: string;
  siteId: string;
  siteUrl: string;
  url: string;
  depth: number;
  maxPages: number;
  maxDepth: number;
}

@Injectable()
export class CrawlerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrawlerService.name);
  private worker: Worker<PageJobData> | null = null;
  private browser: Browser | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CRAWL_QUEUE) private readonly crawlQueue: Queue<PageJobData>,
    @Inject(REDIS_CONNECTION) private readonly redis: IORedis,
    private readonly ingest: IngestService,
    private readonly summary: SummaryService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<PageJobData>(
      CRAWL_QUEUE_NAME,
      (job: Job<PageJobData>) => this.processPage(job),
      {
        connection: this.redis,
        concurrency: config.crawl.pageConcurrency,
      },
    );
    this.worker.on('failed', (job, error) => {
      if (!job) return;
      this.logger.error(`Page job ${job.id} (${job.data.url}) failed: ${error}`);
      // Only counts as finished once retries are exhausted: a transient
      // retry must not decrement pending (see processPage, which already
      // decrements on its own non-error exit paths).
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade >= attempts) {
        void this.decrementAndMaybeFinalize(job.data.crawlJobId).catch((e) =>
          this.logger.error(`Finalize check failed for ${job.data.crawlJobId}: ${e}`),
        );
      }
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    if (this.browser) await this.browser.close();
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      // Deferred import: if CRAWL_RENDER_JS=false, Playwright is not even loaded.
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    }
    return this.browser;
  }

  // --- Redis coordination keys per crawl run ---
  private seenKey(crawlJobId: string) {
    return `crawl:${crawlJobId}:seen`;
  }
  private pendingKey(crawlJobId: string) {
    return `crawl:${crawlJobId}:pending`;
  }
  private visitedKey(crawlJobId: string) {
    return `crawl:${crawlJobId}:visited`;
  }
  private metaKey(crawlJobId: string) {
    return `crawl:${crawlJobId}:meta`;
  }
  private finalizingKey(crawlJobId: string) {
    return `crawl:${crawlJobId}:finalizing`;
  }
  private activeCrawlKey(siteId: string) {
    return `site:${siteId}:activeCrawl`;
  }
  private pageJobId(crawlJobId: string, url: string) {
    const hash = createHash('md5').update(url).digest('hex');
    return `page-${crawlJobId}-${hash}`;
  }

  async start(siteId: string) {
    const [site] = await this.db.select().from(sites).where(eq(sites.id, siteId));
    if (!site) throw new NotFoundException('Site not found');

    const activeCrawlId = await this.redis.get(this.activeCrawlKey(siteId));
    if (activeCrawlId) {
      throw new ConflictException('A crawl is already running for this site');
    }

    const maxPages = site.settings?.maxPages ?? config.crawl.maxPages;
    const maxDepth = site.settings?.maxDepth ?? config.crawl.maxDepth;

    const [job] = await this.db
      .insert(crawlJobs)
      .values({ siteId, status: 'queued' })
      .returning();
    const crawlJobId = job.id;

    await this.redis.set(
      this.activeCrawlKey(siteId),
      crawlJobId,
      'EX',
      ACTIVE_CRAWL_TTL_SECONDS,
    );

    const seedHost = new URL(site.url).hostname;
    if (!config.allowPrivateHosts && !(await isPublicHost(seedHost))) {
      await this.redis.del(this.activeCrawlKey(siteId));
      await this.updateJob(crawlJobId, {
        status: 'error',
        error: `Refusing to crawl private host: ${seedHost}`,
        finishedAt: new Date(),
      });
      await this.db
        .update(sites)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(sites.id, siteId));
      throw new ConflictException('Refusing to crawl private host');
    }

    const { urls: sitemapUrls, complete: sitemapComplete } = await discoverSitemapUrls(
      site.url,
      maxPages,
    );
    const homepage = normalizeUrl(site.url);

    const robots = new RobotsPolicy();
    const disallowed = await robots.disallowed(originOf(site.url));

    await this.redis.hset(this.metaKey(crawlJobId), {
      siteId,
      siteUrl: site.url,
      maxPages: String(maxPages),
      maxDepth: String(maxDepth),
      homepage,
      sitemapComplete: sitemapComplete ? '1' : '0',
      blockedCount: '0',
      robotsDisallowed: JSON.stringify(disallowed),
    });
    await this.redis.expire(this.metaKey(crawlJobId), CRAWL_STATE_TTL_SECONDS);

    // All initial URLs (homepage + full sitemap) are enqueued at once, at
    // depth 0. This simplifies the design compared to a backing pool that
    // gets drained progressively: the only cost is enqueueing extra jobs
    // when maxPages is small, which are cheap to discard.
    const seedUrls = [homepage, ...sitemapUrls];
    let seeded = 0;
    for (const url of seedUrls) {
      if (seeded >= maxPages) break;
      const added = await this.redis.sadd(this.seenKey(crawlJobId), url);
      if (added !== 1) continue;
      seeded += 1;
      await this.enqueuePage(crawlJobId, siteId, site.url, url, 0, maxPages, maxDepth);
    }
    await this.redis.expire(this.seenKey(crawlJobId), CRAWL_STATE_TTL_SECONDS);

    await this.updateJob(crawlJobId, {
      status: 'running',
      startedAt: new Date(),
      pagesFound: seeded,
    });
    await this.db
      .update(sites)
      .set({ status: 'crawling', updatedAt: new Date() })
      .where(eq(sites.id, siteId));

    this.logger.log(
      `Crawl ${site.url}: seeded ${seeded} initial pages (sitemap complete=${sitemapComplete}), maxDepth=${maxDepth}`,
    );

    return job;
  }

  private async enqueuePage(
    crawlJobId: string,
    siteId: string,
    siteUrl: string,
    url: string,
    depth: number,
    maxPages: number,
    maxDepth: number,
  ) {
    await this.redis.incr(this.pendingKey(crawlJobId));
    await this.redis.expire(this.pendingKey(crawlJobId), CRAWL_STATE_TTL_SECONDS);
    const data: PageJobData = { crawlJobId, siteId, siteUrl, url, depth, maxPages, maxDepth };
    await this.crawlQueue.add(url, data, {
      jobId: this.pageJobId(crawlJobId, url),
      attempts: 2,
      backoff: { type: 'exponential', delay: 10_000 },
    });
  }

  /** Decrements the pending pages counter; if it reaches 0, finalizes the crawl. */
  private async decrementAndMaybeFinalize(crawlJobId: string) {
    const remaining = await this.redis.decr(this.pendingKey(crawlJobId));
    if (remaining <= 0) {
      await this.finalize(crawlJobId);
    }
  }

  private async processPage(job: Job<PageJobData>) {
    const { crawlJobId, siteId, siteUrl, url, depth, maxPages, maxDepth } = job.data;

    await this.redis.expire(this.activeCrawlKey(siteId), ACTIVE_CRAWL_TTL_SECONDS);

    const metaRaw = await this.redis.hgetall(this.metaKey(crawlJobId));
    const disallowed: string[] = metaRaw.robotsDisallowed
      ? JSON.parse(metaRaw.robotsDisallowed)
      : [];

    const robots = new RobotsPolicy();
    if (!isCrawlableUrl(url) || !robots.isAllowed(url, disallowed)) {
      await this.decrementAndMaybeFinalize(crawlJobId);
      return;
    }

    const visitedCount = await this.redis.scard(this.visitedKey(crawlJobId));
    if (visitedCount >= maxPages) {
      await this.decrementAndMaybeFinalize(crawlJobId);
      return;
    }

    const { html, blocked } = await this.fetchOne(url, () => this.getBrowser());

    if (blocked) {
      await this.redis.hincrby(this.metaKey(crawlJobId), 'blockedCount', 1);
    }

    if (!html) {
      await this.decrementAndMaybeFinalize(crawlJobId);
      return;
    }

    const extracted = htmlToMarkdown(html, url);
    const links = extractLinks(html, url);

    if (extracted.markdown.length > 0) {
      const saved = await this.savePage(siteId, url, extracted);
      if (saved.changed) {
        try {
          await this.ingest.ingestPage({
            siteId,
            pageId: saved.id,
            title: extracted.title,
            markdown: extracted.markdown,
            url,
          });
        } catch (error) {
          this.logger.error(`Ingest failed for ${url}: ${error}`);
        }
        await this.db
          .update(crawlJobs)
          .set({ pagesChanged: sql`${crawlJobs.pagesChanged} + 1` })
          .where(eq(crawlJobs.id, crawlJobId));
      }
    }

    await this.redis.sadd(this.visitedKey(crawlJobId), url);
    await this.redis.expire(this.visitedKey(crawlJobId), CRAWL_STATE_TTL_SECONDS);
    await this.db
      .update(crawlJobs)
      .set({ pagesCrawled: sql`${crawlJobs.pagesCrawled} + 1` })
      .where(eq(crawlJobs.id, crawlJobId));

    if (depth < maxDepth) {
      for (const link of links) {
        if (!isSameHost(link, siteUrl)) continue;
        const normalized = normalizeUrl(link);
        const added = await this.redis.sadd(this.seenKey(crawlJobId), normalized);
        if (added !== 1) continue;

        const seenCount = await this.redis.scard(this.seenKey(crawlJobId));
        if (seenCount > maxPages) continue;

        await this.db
          .update(crawlJobs)
          .set({ pagesFound: sql`${crawlJobs.pagesFound} + 1` })
          .where(eq(crawlJobs.id, crawlJobId));
        // Pending is incremented BEFORE this job's final decrement: the
        // counter must never touch 0 while a child is about to be enqueued.
        await this.enqueuePage(
          crawlJobId,
          siteId,
          siteUrl,
          normalized,
          depth + 1,
          maxPages,
          maxDepth,
        );
      }
    }

    await this.decrementAndMaybeFinalize(crawlJobId);
  }

  private async finalize(crawlJobId: string) {
    const acquired = await this.redis.set(
      this.finalizingKey(crawlJobId),
      '1',
      'EX',
      300,
      'NX',
    );
    if (!acquired) return;

    const meta = await this.redis.hgetall(this.metaKey(crawlJobId));
    const siteId = meta.siteId;
    const siteUrl = meta.siteUrl;
    const maxPages = Number(meta.maxPages ?? config.crawl.maxPages);
    const sitemapComplete = meta.sitemapComplete === '1';
    const blockedCount = Number(meta.blockedCount ?? 0);

    const visited = await this.redis.smembers(this.visitedKey(crawlJobId));
    const seenCount = await this.redis.scard(this.seenKey(crawlJobId));

    try {
      const cappedOut = seenCount >= maxPages;
      if (sitemapComplete || !cappedOut) {
        const known = new Set<string>([meta.homepage, ...visited]);
        await this.reconcile(siteId, known);
      } else {
        this.logger.warn(
          `Reconciliation skipped for ${siteUrl}: incomplete crawl (cap ${maxPages}).`,
        );
      }

      if (blockedCount > 0 && visited.length === 0) {
        throw new Error(
          `The site blocked the crawl (${blockedCount} error responses). ` +
            'It may have a firewall or an active anti-bot protection.',
        );
      }

      if (blockedCount > 0) {
        this.logger.warn(
          `Crawl ${siteUrl}: ${blockedCount} pages blocked by the server.`,
        );
      }

      await this.updateJob(crawlJobId, { status: 'done', finishedAt: new Date() });
      await this.db
        .update(sites)
        .set({ status: 'ready', updatedAt: new Date(), lastCrawledAt: new Date() })
        .where(eq(sites.id, siteId));

      if (visited.length > 0) {
        try {
          await this.summary.generate(siteId);
        } catch (error) {
          this.logger.warn(`Summary generation skipped for ${siteUrl}: ${error}`);
        }
      }

      this.logger.log(`Crawl done for ${siteUrl}: ${visited.length} pages visited`);
    } catch (error) {
      const message = (error as Error).message;
      await this.updateJob(crawlJobId, {
        status: 'error',
        error: message,
        finishedAt: new Date(),
      });
      await this.db
        .update(sites)
        .set({ status: 'error', updatedAt: new Date() })
        .where(eq(sites.id, siteId));
      this.logger.error(`Crawl failed for ${siteUrl}: ${message}`);
    } finally {
      await this.redis.del(this.activeCrawlKey(siteId));
      await this.redis.del(
        this.seenKey(crawlJobId),
        this.pendingKey(crawlJobId),
        this.visitedKey(crawlJobId),
        this.metaKey(crawlJobId),
        this.finalizingKey(crawlJobId),
      );
    }
  }

  async refreshPage(
    siteId: string,
    url: string,
  ): Promise<{ changed: boolean; chunks: number }> {
    const [site] = await this.db.select().from(sites).where(eq(sites.id, siteId));
    if (!site) throw new NotFoundException('Site not found');

    const target = normalizeUrl(url);
    if (!isSameHost(target, site.url)) {
      throw new ConflictException('URL is not part of the site domain');
    }
    if (!isCrawlableUrl(target)) {
      throw new ConflictException('URL is not crawlable');
    }
    if (!config.allowPrivateHosts && !(await isPublicHost(new URL(target).hostname))) {
      throw new ConflictException('Refusing to crawl private host');
    }

    const fetched = await fetchHtml(target);
    if (!fetched) throw new NotFoundException('Could not fetch the page');
    if (fetched.blocked) {
      throw new ConflictException(
        `The server responded ${fetched.status}. The site may be blocking the crawl.`,
      );
    }

    const extracted = htmlToMarkdown(fetched.html, target);
    if (!extracted.markdown) {
      throw new NotFoundException('No content extracted from the page');
    }

    const saved = await this.savePage(siteId, target, extracted);
    let chunks = 0;
    if (saved.changed) {
      chunks = await this.ingest.ingestPage({
        siteId,
        pageId: saved.id,
        title: extracted.title,
        markdown: extracted.markdown,
        url: target,
      });
    }

    return { changed: saved.changed, chunks };
  }

  private async updateJob(
    jobId: string,
    values: Partial<typeof crawlJobs.$inferInsert>,
  ) {
    await this.db.update(crawlJobs).set(values).where(eq(crawlJobs.id, jobId));
  }

  private async savePage(
    siteId: string,
    url: string,
    extracted: ExtractedPage,
  ): Promise<{ id: string; changed: boolean }> {
    const [existing] = await this.db
      .select({ id: pages.id, contentHash: pages.contentHash })
      .from(pages)
      .where(and(eq(pages.siteId, siteId), eq(pages.url, url)));

    if (existing) {
      if (existing.contentHash === extracted.contentHash) {
        await this.db
          .update(pages)
          .set({ crawledAt: new Date() })
          .where(eq(pages.id, existing.id));
        return { id: existing.id, changed: false };
      }
      await this.db
        .update(pages)
        .set({
          title: extracted.title,
          markdown: extracted.markdown,
          contentHash: extracted.contentHash,
          crawledAt: new Date(),
        })
        .where(eq(pages.id, existing.id));
      return { id: existing.id, changed: true };
    }

    const [inserted] = await this.db
      .insert(pages)
      .values({
        siteId,
        url,
        title: extracted.title,
        markdown: extracted.markdown,
        contentHash: extracted.contentHash,
        statusCode: 200,
        crawledAt: new Date(),
      })
      .returning({ id: pages.id });

    return { id: inserted.id, changed: true };
  }

  /**
   * Downloads a URL and, if needed, renders it with Playwright.
   */
  private async fetchOne(
    url: string,
    getBrowser: () => Promise<Browser>,
  ): Promise<{ html: string | null; blocked: boolean }> {
    let html: string | null = null;
    const fetched = await fetchHtml(url);
    let blocked = false;

    if (fetched) {
      html = fetched.blocked ? null : fetched.html;
      if (fetched.blocked) {
        blocked = true;
        this.logger.warn(`HTTP ${fetched.status} at ${url}`);
      }
    }

    // If the server is blocking us, the browser won't help either.
    if (
      config.crawl.renderJs &&
      !fetched?.blocked &&
      (!html || html.length < JS_SHELL_MIN_CHARS)
    ) {
      try {
        const browser = await getBrowser();
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
          html = await page.content();
        } finally {
          await page.close();
        }
      } catch (error) {
        this.logger.warn(`Render fallback failed for ${url}: ${error}`);
      }
    }

    return { html, blocked };
  }

  private async reconcile(siteId: string, knownUrls: Set<string>) {
    const rows = await this.db
      .select({ id: pages.id, url: pages.url })
      .from(pages)
      .where(eq(pages.siteId, siteId));

    const stale = computeStaleUrls(
      rows.map((row) => row.url),
      knownUrls,
    );

    for (const row of rows) {
      if (stale.includes(row.url)) {
        await this.db.delete(pages).where(eq(pages.id, row.id));
        this.logger.log(`Removed stale page ${row.url}`);
      }
    }
  }
}
