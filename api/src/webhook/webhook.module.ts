import { Module } from '@nestjs/common';
import { CrawlerModule } from '../crawler/crawler.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [CrawlerModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
