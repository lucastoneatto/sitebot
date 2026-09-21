import { USER_AGENT } from './http';

export class RobotsPolicy {
  private cache = new Map<string, string[]>();

  async disallowed(origin: string): Promise<string[]> {
    if (this.cache.has(origin)) return this.cache.get(origin)!;
    const patterns: string[] = [];
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': USER_AGENT },
      });
      if (res.ok) {
        const text = await res.text();
        let applies = false;
        for (const raw of text.split(/\r?\n/)) {
          const ua = raw.match(/^\s*user-agent:\s*(.+?)\s*$/i);
          if (ua) {
            const name = ua[1].trim().toLowerCase();
            applies = name === '*' || name === 'sitebot';
            continue;
          }
          if (!applies) continue;
          const d = raw.match(/^\s*disallow:\s*(\S*)\s*$/i);
          if (d && d[1]) patterns.push(d[1]);
        }
      }
    } catch {
      // robots.txt unreachable → treat as fully allowed
    }
    this.cache.set(origin, patterns);
    return patterns;
  }

  isAllowed(url: string, patterns: string[]): boolean {
    try {
      const path = new URL(url).pathname;
      return !patterns.some((pattern) => path.startsWith(pattern));
    } catch {
      return false;
    }
  }
}
