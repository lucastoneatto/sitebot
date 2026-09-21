import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CrawlerService } from '../crawler/crawler.service';
import { AdminBasicGuard } from './admin.guard';
import { UpdatePlanDto, UpdateQuotaDto } from './admin.dto';
import { AdminService } from './admin.service';

@UseGuards(AdminBasicGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly crawler: CrawlerService,
  ) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('users')
  users() {
    return this.admin.listUsers();
  }

  @Patch('users/:id/plan')
  setPlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ) {
    return this.admin.setPlan(id, dto.plan);
  }

  @Get('sites')
  sites() {
    return this.admin.listSites();
  }

  @Patch('sites/:id/quota')
  setQuota(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuotaDto,
  ) {
    return this.admin.setQuota(id, dto);
  }

  @Post('sites/:id/crawl')
  crawl(@Param('id', ParseUUIDPipe) id: string) {
    return this.crawler.start(id);
  }
}
