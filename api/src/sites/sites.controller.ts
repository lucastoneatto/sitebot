import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedUser } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CrawlerService } from '../crawler/crawler.service';
import { CreateSiteDto, UpdateSiteDto } from './sites.dto';
import { SitesService } from './sites.service';

@UseGuards(AuthGuard)
@Controller('sites')
export class SitesController {
  constructor(
    private readonly sites: SitesService,
    private readonly crawler: CrawlerService,
  ) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSiteDto) {
    return this.sites.create(user.userId, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.sites.list(user.userId);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sites.detail(id, user.userId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.sites.update(id, user.userId, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sites.remove(id, user.userId);
  }

  @Post(':id/crawl')
  async crawl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.sites.findOwned(id, user.userId);
    return this.crawler.start(id);
  }

  @Get(':id/status')
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sites.status(id, user.userId);
  }

  @Get(':id/pages')
  pages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sites.listPages(
      id,
      user.userId,
      offset ? Number(offset) : 0,
      limit ? Number(limit) : 50,
    );
  }

  @Get(':id/pages/:pageId')
  page(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('pageId', ParseUUIDPipe) pageId: string,
  ) {
    return this.sites.getPage(id, pageId, user.userId);
  }

  @Post(':id/summary')
  regenerateSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sites.regenerateSummary(id, user.userId);
  }

  @Get(':id/conversations')
  conversations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sites.listConversations(
      id,
      user.userId,
      offset ? Number(offset) : 0,
      limit ? Number(limit) : 50,
    );
  }

  @Get(':id/conversations/:sessionId')
  conversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.sites.getConversation(id, sessionId, user.userId);
  }

  @Post(':id/webhook-secret')
  regenerateWebhookSecret(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.sites.regenerateWebhookSecret(id, user.userId);
  }
}
