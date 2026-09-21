import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { ChatModule } from './chat/chat.module';
import { CrawlerModule } from './crawler/crawler.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { IngestModule } from './ingest/ingest.module';
import { BullBoardModule } from './queue/bull-board.module';
import { QueueModule } from './queue/queue.module';
import { SitesModule } from './sites/sites.module';
import { StartupService } from './startup.service';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    DbModule,
    QueueModule,
    EmbeddingsModule,
    IngestModule,
    CrawlerModule,
    SitesModule,
    ChatModule,
    AuthModule,
    WebhookModule,
    AdminModule,
    BullBoardModule,
  ],
  controllers: [HealthController],
  providers: [
    StartupService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
