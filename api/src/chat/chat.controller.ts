import {
  Body,
  Controller,
  ForbiddenException,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { config } from '../config';
import { ChatDto, FeedbackDto } from './chat.dto';
import { ChatService, isNoInfoAnswer } from './chat.service';
import { UsageService } from '../usage/usage.service';
import type { Site } from '../db/schema';

function dedupeSources<T extends { url: string }>(sources: T[]): T[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chat: ChatService,
    private readonly usage: UsageService,
  ) {}

  private assertOriginAllowed(req: Request, site: Site) {
    const origin = req.headers.origin;
    const allowedOrigins = [...site.allowedOrigins, ...config.dashboardOrigins];
    if (
      !config.corsRelaxed &&
      origin &&
      allowedOrigins.length > 0 &&
      !allowedOrigins.includes(origin)
    ) {
      throw new ForbiddenException('Origin not allowed for this site');
    }
  }

  @Post()
  @Throttle({ default: { limit: config.chatIpLimit, ttl: 60_000 } })
  async handle(
    @Body() dto: ChatDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const site = await this.chat.findSite(dto.siteId);
    if (!site) throw new NotFoundException('Site not found');

    this.assertOriginAllowed(req, site);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let closed = false;
    const controller = new AbortController();
    req.on('close', () => {
      closed = true;
      controller.abort();
    });

    const sessionId = await this.chat.ensureSession(dto.siteId, dto.sessionId);
    const branding = await this.chat.showsBranding(site);
    send({ type: 'session', sessionId, branding });

    if (!this.chat.sessionLimiter.check(sessionId)) {
      send({
        type: 'error',
        code: 'rate_limited',
        message: 'Too many messages. Wait a moment and try again.',
      });
      res.end();
      return;
    }

    const monthly = await this.usage.monthlyUsage(dto.siteId);
    if (
      (site.monthlyMessageLimit != null &&
        monthly.messages >= site.monthlyMessageLimit) ||
      (site.monthlyBudgetUsd != null && monthly.cost >= site.monthlyBudgetUsd)
    ) {
      send({
        type: 'error',
        code: 'quota_exceeded',
        message: 'The assistant reached its monthly limit. Contact the administrator.',
      });
      res.end();
      return;
    }

    try {
      const retrieved = await this.chat.retrieve(dto.siteId, dto.message);
      const prompt = this.chat.buildPrompt(site, dto.message, retrieved);
      let answer = '';
      let usage: { promptTokens: number; completionTokens: number } | undefined;

      for await (const token of this.chat.streamAnswer({
        site,
        question: dto.message,
        prompt,
        history: dto.history ?? [],
        signal: controller.signal,
        onUsage: (value) => {
          usage = value;
        },
      })) {
        if (closed) break;
        answer += token;
        send({ type: 'token', value: token });
      }

      if (usage) {
        await this.usage.record({
          siteId: dto.siteId,
          type: 'chat',
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
        });
      }

      const noInfo = answer.length === 0 || isNoInfoAnswer(answer);
      const sources = noInfo
        ? []
        : dedupeSources(
            retrieved.map(({ url, title, score }) => ({ url, title, score })),
          );
      send({ type: 'sources', sources });

      let assistantMessageId: string | undefined;
      if (answer) {
        const saved = await this.chat.saveMessages({
          sessionId,
          question: dto.message,
          answer,
          sources,
          noInfo,
        });
        assistantMessageId = saved.assistantMessageId || undefined;
      }

      if (assistantMessageId) {
        send({ type: 'message', id: assistantMessageId });
      }

      send({ type: 'done' });
    } catch (error) {
      if (!closed) {
        this.logger.error(`Chat failed: ${(error as Error).message}`);
        send({ type: 'error', message: (error as Error).message });
      }
    } finally {
      res.end();
    }
  }

  @Post('feedback')
  @Throttle({ default: { limit: config.chatIpLimit, ttl: 60_000 } })
  async feedback(@Body() dto: FeedbackDto, @Req() req: Request) {
    const site = await this.chat.findSite(dto.siteId);
    if (!site) throw new NotFoundException('Site not found');
    this.assertOriginAllowed(req, site);

    const updated = await this.chat.setFeedback({
      siteId: dto.siteId,
      sessionId: dto.sessionId,
      messageId: dto.messageId,
      rating: dto.rating,
    });
    if (!updated) throw new NotFoundException('Message not found');
    return { ok: true };
  }
}
