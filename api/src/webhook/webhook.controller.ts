import {
  Body,
  Controller,
  ForbiddenException,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { IsOptional, IsUrl } from 'class-validator';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/db.module';
import { sites } from '../db/schema';
import { CrawlerService } from '../crawler/crawler.service';

class WebhookDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  url?: string;
}

@Controller('webhook')
export class WebhookController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crawler: CrawlerService,
  ) {}

  @Post(':siteId')
  async handle(
    @Param('siteId', ParseUUIDPipe) siteId: string,
    @Body() dto: WebhookDto,
    @Req() req: Request,
  ) {
    const [site] = await this.db.select().from(sites).where(eq(sites.id, siteId));
    if (!site) throw new NotFoundException('Site not found');

    const secret = site.webhookSecret;
    if (!secret) {
      throw new ForbiddenException('Webhook is not enabled for this site');
    }

    const headerValue = req.headers['x-sitebot-secret'];
    const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!provided || provided !== secret) {
      throw new ForbiddenException('Invalid webhook secret');
    }

    if (dto.url) {
      const result = await this.crawler.refreshPage(siteId, dto.url);
      return { type: 'page', ...result };
    }

    const job = await this.crawler.start(siteId);
    return { type: 'crawl', jobId: job.id };
  }
}
