import { XMLParser } from 'fast-xml-parser';
import { isCrawlableUrl, isSameHost, normalizeUrl, originOf } from './url';
import { USER_AGENT } from './http';

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function collectLocs(
  url: string,
  seen: Set<string>,
  out: string[],
  cap: number,
  depth = 0,
): Promise<void> {
  if (depth > 3 || seen.has(url) || out.length >= cap) return;
  seen.add(url);
  const xml = await fetchText(url);
  if (!xml) return;

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return;
  }

  const root = parsed as Record<string, any>;
  const sitemapIndex = root?.sitemapindex;
  if (sitemapIndex) {
    for (const sitemap of asArray(sitemapIndex.sitemap)) {
      const loc = sitemap?.loc;
      if (typeof loc === 'string') {
        await collectLocs(loc.trim(), seen, out, cap, depth + 1);
      }
      if (out.length >= cap) return;
    }
    return;
  }

  const urlset = root?.urlset;
  if (urlset) {
    for (const entry of asArray(urlset.url)) {
      const loc = entry?.loc;
      if (typeof loc === 'string') out.push(loc.trim());
      if (out.length >= cap) return;
    }
  }
}

export type SitemapResult = { urls: string[]; complete: boolean };

export async function discoverSitemapUrls(
  siteUrl: string,
  limit: number,
): Promise<SitemapResult> {
  const origin = originOf(siteUrl);
  const robots = await fetchText(`${origin}/robots.txt`);

  const candidates: string[] = [];
  if (robots) {
    for (const line of robots.split('\n')) {
      const match = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (match) candidates.push(match[1].trim());
    }
  }
  candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);

  const cap = limit + 1;
  const seen = new Set<string>();
  const found: string[] = [];
  for (const candidate of candidates) {
    await collectLocs(candidate, seen, found, cap);
    if (found.length >= cap) break;
  }

  const unique = new Map<string, string>();
  for (const raw of found) {
    try {
      const normalized = normalizeUrl(raw);
      if (isCrawlableUrl(normalized) && isSameHost(normalized, siteUrl)) {
        unique.set(normalized, normalized);
      }
    } catch {
      continue;
    }
    if (unique.size >= cap) break;
  }

  const all = [...unique.values()];
  return {
    urls: all.slice(0, limit),
    complete: all.length <= limit,
  };
}
