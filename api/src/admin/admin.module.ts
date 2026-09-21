import { Module } from '@nestjs/common';
import { CrawlerModule } from '../crawler/crawler.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [CrawlerModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
