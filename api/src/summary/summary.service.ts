import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/db.module';
import { pages, sites } from '../db/schema';
import { config } from '../config';
import { UsageService } from '../usage/usage.service';

const MAX_CORPUS_CHARS = 12000;

@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);
  private readonly client = new OpenAI({
    apiKey: config.openaiApiKey,
    baseURL: config.chatBaseUrl,
  });

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly usage: UsageService,
  ) {}

  async generate(siteId: string): Promise<string> {
    const [site] = await this.db.select().from(sites).where(eq(sites.id, siteId));
    if (!site) throw new NotFoundException('Site not found');

    const pageRows = await this.db
      .select({ url: pages.url, title: pages.title, markdown: pages.markdown })
      .from(pages)
      .where(eq(pages.siteId, siteId));

    if (pageRows.length === 0) {
      throw new BadRequestException('No pages indexed yet');
    }

    const perPage = Math.max(400, Math.floor(MAX_CORPUS_CHARS / pageRows.length));
    const corpus = pageRows
      .map((page) => `## ${page.title ?? page.url}\n${page.markdown.slice(0, perPage)}`)
      .join('\n\n')
      .slice(0, MAX_CORPUS_CHARS);

    const response = await this.client.chat.completions.create({
      model: config.chatModel,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'You are an assistant that summarizes websites. Write in English, in 2-3 sentences, ' +
            'clearly and concretely: what the site offers and who it is aimed at. ' +
            'Do not make up facts that do not appear in the content.',
        },
        {
          role: 'user',
          content: `Site: ${site.name} (${site.url})\n\nCrawled content:\n\n${corpus}\n\nGenerate the summary.`,
        },
      ],
    });

    const summary = response.choices[0]?.message?.content?.trim() ?? '';
    if (!summary) throw new BadRequestException('Could not generate the summary');

    const usage = response.usage;
    if (usage) {
      await this.usage.record({
        siteId,
        type: 'summary',
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
      });
    }

    await this.db
      .update(sites)
      .set({ summary, updatedAt: new Date() })
      .where(eq(sites.id, siteId));

    this.logger.log(`Summary generated for ${site.url}`);
    return summary;
  }
}
