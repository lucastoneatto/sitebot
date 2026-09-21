import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/db.module';
import { chunks } from '../db/schema';
import { config } from '../config';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { UsageService } from '../usage/usage.service';
import { chunkMarkdown, estimateTokens } from './chunker';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly embeddings: EmbeddingsService,
    private readonly usage: UsageService,
  ) {}

  async ingestPage(params: {
    siteId: string;
    pageId: string;
    title: string | null;
    markdown: string;
    url: string;
  }): Promise<number> {
    const { siteId, pageId, title, markdown, url } = params;

    await this.db.delete(chunks).where(eq(chunks.pageId, pageId));

    const pieces = chunkMarkdown(
      markdown,
      config.crawl.chunkMaxChars,
      config.crawl.chunkOverlap,
    );
    if (pieces.length === 0) return 0;

    const payload = pieces.map((piece) =>
      title ? `# ${title}\n\n${piece}` : piece,
    );
    const vectors = await this.embeddings.embedDocuments(payload);

    await this.db.insert(chunks).values(
      payload.map((content, index) => ({
        siteId,
        pageId,
        content,
        tokenCount: estimateTokens(content),
        embedding: vectors[index],
        search: sql`to_tsvector('simple', ${content})`,
      })),
    );

    const totalTokens = payload.reduce(
      (sum, content) => sum + estimateTokens(content),
      0,
    );
    await this.usage.record({ siteId, type: 'embedding', totalTokens });

    this.logger.log(`Indexed ${pieces.length} chunks from ${url}`);
    return pieces.length;
  }
}
