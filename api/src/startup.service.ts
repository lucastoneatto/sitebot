import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type IORedis from 'ioredis';
import { DRIZZLE, Database } from './db/db.module';
import { crawlJobs, sites } from './db/schema';
import { REDIS_CONNECTION } from './queue/queue.module';

@Injectable()
export class StartupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StartupService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(REDIS_CONNECTION) private readonly redis: IORedis,
  ) {}

  async onApplicationBootstrap() {
    // Each page job refreshes site:{siteId}:activeCrawl while the crawl is
    // legitimately still in progress (see CrawlerService.processPage). If
    // that key doesn't point to this row, the crawl was orphaned (crash or
    // restart midway) and there's no way for it to resume on its own.
    const pending = await this.db
      .select({ id: crawlJobs.id, siteId: crawlJobs.siteId })
      .from(crawlJobs)
      .where(inArray(crawlJobs.status, ['queued', 'running']));

    const orphanIds: string[] = [];
    const orphanSiteIds = new Set<string>();
    for (const row of pending) {
      const activeCrawlId = await this.redis.get(`site:${row.siteId}:activeCrawl`);
      if (activeCrawlId !== row.id) {
        orphanIds.push(row.id);
        orphanSiteIds.add(row.siteId);
      }
    }

    if (orphanIds.length > 0) {
      await this.db
        .update(crawlJobs)
        .set({
          status: 'error',
          error: 'Interrupted by restart',
          finishedAt: new Date(),
        })
        .where(inArray(crawlJobs.id, orphanIds));

      await this.db
        .update(sites)
        .set({ status: 'error' })
        .where(inArray(sites.id, [...orphanSiteIds]));

      for (const siteId of orphanSiteIds) {
        await this.redis.del(`site:${siteId}:activeCrawl`);
      }

      this.logger.warn(`Marked ${orphanIds.length} orphaned crawl job(s) as error`);
    }
  }
}
