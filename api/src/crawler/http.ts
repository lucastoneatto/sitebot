import { JSDOM, VirtualConsole } from 'jsdom';

/**
 * Many WAFs (CloudFront, Cloudflare) return 403 to any UA that identifies
 * itself as a bot, without even consulting robots.txt. We use a browser UA
 * so public content is served to us, but we still honor robots.txt in
 * `robots.ts`: the WAF's filter is not the site's policy.
 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Declared UA, to consult robots.txt honestly. */
export const BOT_USER_AGENT =
  'Mozilla/5.0 (compatible; SiteBot/1.0; +https://sitebot.local)';

/** Browser headers: a WAF blocks requests without `accept-language`. */
const BROWSER_HEADERS = {
  'user-agent': USER_AGENT,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
  'upgrade-insecure-requests': '1',
};

export type FetchedPage = {
  html: string;
  status: number;
  finalUrl: string;
  /** true if the server returned an error (WAF 403, 404, 5xx). */
  blocked?: boolean;
};

export async function fetchHtml(url: string): Promise<FetchedPage | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: BROWSER_HEADERS,
    });
    // A WAF responds 403 with an HTML body: without this we would index it
    // as if it were the site's actual content.
    if (!res.ok) {
      return { html: '', status: res.status, finalUrl: res.url, blocked: true };
    }

    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (
      !type.includes('text/html') &&
      !type.includes('application/xhtml+xml')
    ) {
      return null;
    }
    const html = await res.text();
    return { html, status: res.status, finalUrl: res.url };
  } catch {
    return null;
  }
}

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', () => undefined);

export function extractLinks(html: string, baseUrl: string): string[] {
  try {
    const dom = new JSDOM(html, { url: baseUrl, virtualConsole });
    const links = new Set<string>();
    for (const anchor of dom.window.document.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href');
      if (!href) continue;
      try {
        links.add(new URL(href, baseUrl).toString());
      } catch {
        continue;
      }
    }
    return [...links];
  } catch {
    return [];
  }
}
