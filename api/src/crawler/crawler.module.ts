import { Module } from '@nestjs/common';
import { IngestModule } from '../ingest/ingest.module';
import { SummaryModule } from '../summary/summary.module';
import { CrawlerService } from './crawler.service';
import { CrawlSchedulerService } from './scheduler.service';

@Module({
  imports: [IngestModule, SummaryModule],
  providers: [CrawlerService, CrawlSchedulerService],
  exports: [CrawlerService],
})
export class CrawlerModule {}
