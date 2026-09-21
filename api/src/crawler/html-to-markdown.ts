import { createHash } from 'node:crypto';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.use(gfm);
turndown.remove(['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', 'form']);

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => undefined);

export type ExtractedPage = {
  title: string | null;
  markdown: string;
  contentHash: string;
};

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function slugFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    const base = last.replace(/\.(html?|php|aspx?)$/i, '');
    if (!base || base.toLowerCase() === 'index' || base.toLowerCase() === 'inicio') {
      return '';
    }
    return base
      .replace(/[-_+]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  } catch {
    return '';
  }
}

function pickTitle(
  h1: string | null,
  articleTitle: string | null | undefined,
  docTitle: string | null,
  slug: string,
): string | null {
  const heading = h1 || articleTitle || docTitle;
  if (
    slug &&
    heading &&
    !stripAccents(heading).toLowerCase().includes(stripAccents(slug).toLowerCase())
  ) {
    return slug;
  }
  return heading || slug || null;
}

export function htmlToMarkdown(html: string, url: string): ExtractedPage {
  const dom = new JSDOM(html, { url, virtualConsole });
  const doc = dom.window.document;

  const fallbackTitle = doc.querySelector('title')?.textContent?.trim() ?? null;
  const metaDescription =
    doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '';

  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(doc.cloneNode(true) as Document).parse();
  } catch {
    article = null;
  }

  const contentHtml = article?.content ?? doc.body?.innerHTML ?? '';
  const markdown = turndown.turndown(contentHtml).trim();
  const h1 = doc.querySelector('h1')?.textContent?.trim() ?? null;
  const slug = slugFromUrl(url);
  const title = pickTitle(h1, article?.title?.trim(), fallbackTitle, slug);

  const parts = [title ? `# ${title}` : '', metaDescription, markdown].filter(Boolean);
  const finalMarkdown = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    title,
    markdown: finalMarkdown,
    contentHash: createHash('sha256').update(finalMarkdown).digest('hex'),
  };
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
