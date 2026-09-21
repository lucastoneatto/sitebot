import { Module } from '@nestjs/common';
import { CrawlerModule } from '../crawler/crawler.module';
import { SummaryModule } from '../summary/summary.module';
import { SitesController } from './sites.controller';
import { SitesService } from './sites.service';

@Module({
  imports: [CrawlerModule, SummaryModule],
  controllers: [SitesController],
  providers: [SitesService],
})
export class SitesModule {}
