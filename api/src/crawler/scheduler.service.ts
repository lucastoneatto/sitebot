import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { eq, lt } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/db.module';
import { chatSessions, sites } from '../db/schema';
import { config } from '../config';
import { CrawlerService } from './crawler.service';

@Injectable()
export class CrawlSchedulerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CrawlSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crawler: CrawlerService,
  ) {}

  onApplicationBootstrap() {
    const intervalMs = config.sync.intervalMinutes * 60_000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Auto-sync scheduler running every ${config.sync.intervalMinutes} min`,
    );
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Old conversations are no longer queried but still take up disk space.
   * `messages` cascades away when the session is deleted.
   */
  private async purgeOldConversations() {
    const days = config.retention.conversationDays;
    if (days <= 0) return;

    const cutoff = new Date(Date.now() - days * 86_400_000);
    const removed = await this.db
      .delete(chatSessions)
      .where(lt(chatSessions.createdAt, cutoff))
      .returning({ id: chatSessions.id });

    if (removed.length > 0) {
      this.logger.log(
        `Purged ${removed.length} conversations older than ${cutoff.toISOString().slice(0, 10)}`,
      );
    }
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      try {
        await this.purgeOldConversations();
      } catch (error) {
        // Purging is maintenance: if it fails, the re-crawl should still proceed.
        this.logger.warn(`Conversation purge failed: ${(error as Error).message}`);
      }

      const targets = await this.db
        .select({
          id: sites.id,
          url: sites.url,
          lastCrawledAt: sites.lastCrawledAt,
          syncIntervalHours: sites.syncIntervalHours,
        })
        .from(sites)
        .where(eq(sites.autoSync, true));

      for (const site of targets) {
        const intervalMs = (site.syncIntervalHours ?? 24) * 3_600_000;
        const last = site.lastCrawledAt?.getTime() ?? 0;
        if (Date.now() - last < intervalMs) continue;

        try {
          await this.crawler.start(site.id);
          this.logger.log(`Auto-sync triggered for ${site.url}`);
        } catch (error) {
          this.logger.warn(
            `Auto-sync skipped for ${site.url}: ${(error as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
