export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  url.search = '';
  return url.toString();
}

export function originOf(input: string): string {
  const url = new URL(input);
  return `${url.protocol}//${url.host}`;
}

export function hostOf(input: string): string {
  return new URL(input).host;
}

export function isSameHost(candidate: string, reference: string): boolean {
  try {
    return hostOf(candidate) === hostOf(reference);
  } catch {
    return false;
  }
}

export function isCrawlableContentType(contentType: string | null): boolean {
  if (!contentType) return true;
  const type = contentType.toLowerCase();
  return type.includes('text/html') || type.includes('application/xhtml+xml');
}

const NON_CONTENT_EXTENSION =
  /\.(xml|json|pdf|png|jpe?g|gif|svg|webp|avif|ico|css|js|zip|rar|rss|atom|txt|csv)([?#].*)?$/i;

/**
 * Paths that never provide content to a bot: system areas (WordPress,
 * Drupal), private areas, and views that only repeat already-indexed
 * content (archive pagination, date/author/tag filters).
 */
const NON_CONTENT_PATH =
  /(^|\/)(wp-admin|wp-login|wp-json|wp-content|wp-includes|xmlrpc|admin|login|logout|signin|signup|register|cart|checkout|account|mi-cuenta|carrito|feed|rss|amp|tag|etiqueta|author|autor|search|buscar|20\d{2})(\/|\.|$)/i;

/**
 * Pagination (`/page/2`, `/pagina/3`): repeats already-indexed content.
 * Requires the number on purpose, because `/docs/page` or `/pagina-de-inicio`
 * are legitimate content — exactly the kind of path found in docs sites.
 */
const PAGINATION_PATH = /(^|\/)(page|pagina)\/\d+(\/|$)/i;

export function isCrawlableUrl(input: string): boolean {
  try {
    const { pathname } = new URL(input);
    if (NON_CONTENT_EXTENSION.test(pathname)) return false;
    if (PAGINATION_PATH.test(pathname)) return false;
    return !NON_CONTENT_PATH.test(pathname);
  } catch {
    return false;
  }
}
