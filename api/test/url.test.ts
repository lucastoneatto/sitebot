import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isCrawlableUrl, normalizeUrl } from '../src/crawler/url';

const base = 'https://ejemplo.com';

describe('isCrawlableUrl', () => {
  it('accepts real content pages', () => {
    for (const path of [
      '/',
      '/tramite/carnet-de-beneficiario',
      '/novedades',
      '/sobre-la-institucion',
      '/docs/guia/inicio',
      '/programa-caja-427',
    ]) {
      assert.equal(isCrawlableUrl(base + path), true, path);
    }
  });

  it('discards files that are not pages', () => {
    for (const path of ['/a.pdf', '/b.png', '/c.css', '/d.js', '/e.zip']) {
      assert.equal(isCrawlableUrl(base + path), false, path);
    }
  });

  it('discards system and private areas', () => {
    for (const path of [
      '/wp-admin/',
      '/wp-login.php',
      '/wp-json/wp/v2/posts',
      '/admin/settings',
      '/login',
      '/checkout',
      '/mi-cuenta',
    ]) {
      assert.equal(isCrawlableUrl(base + path), false, path);
    }
  });

  it('discards views that duplicate already-indexed content', () => {
    for (const path of [
      '/feed',
      '/tag/jubilaciones',
      '/author/admin',
      '/page/2',
      '/2024/03',
      '/buscar',
    ]) {
      assert.equal(isCrawlableUrl(base + path), false, path);
    }
  });

  it('does not confuse a segment that merely contains the forbidden word', () => {
    // "pagelet" or "administracion" are legitimate content, not system areas.
    assert.equal(isCrawlableUrl(`${base}/administracion-publica`), true);
    assert.equal(isCrawlableUrl(`${base}/pagelet-informativo`), true);
    assert.equal(isCrawlableUrl(`${base}/tramite/login-unico`), true);
  });

  it('allows docs paths that contain "page" without being pagination', () => {
    // Regression: the filter used to block /docs/page, exactly the docs niche.
    for (const path of ['/docs/page', '/pagina-de-inicio', '/guia/page-layout']) {
      assert.equal(isCrawlableUrl(base + path), true, path);
    }
  });

  it('still discards real pagination', () => {
    for (const path of ['/page/2', '/blog/page/10', '/pagina/3']) {
      assert.equal(isCrawlableUrl(base + path), false, path);
    }
  });

  it('rejects inputs that are not URLs', () => {
    assert.equal(isCrawlableUrl('no-es-una-url'), false);
  });
});

describe('normalizeUrl', () => {
  it('strips the hash, the query, and the trailing slash', () => {
    assert.equal(normalizeUrl(`${base}/a/?x=1#frag`), `${base}/a`);
  });

  it('keeps the root slash', () => {
    assert.equal(normalizeUrl(`${base}/`), `${base}/`);
  });

  it('treats the variant with and without a trailing slash as the same page', () => {
    assert.equal(normalizeUrl(`${base}/a/`), normalizeUrl(`${base}/a`));
  });
});
