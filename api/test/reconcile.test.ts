import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeStaleUrls } from '../src/crawler/reconcile';

describe('computeStaleUrls', () => {
  it('marks as stale the indexed pages that no longer exist at the origin', () => {
    const stale = computeStaleUrls(
      ['https://x.com/a', 'https://x.com/b', 'https://x.com/vieja'],
      new Set(['https://x.com/a', 'https://x.com/b']),
    );
    assert.deepEqual(stale, ['https://x.com/vieja']);
  });

  it('deletes nothing when everything indexed is still known', () => {
    const indexed = ['https://x.com/a', 'https://x.com/b'];
    assert.deepEqual(computeStaleUrls(indexed, new Set(indexed)), []);
  });

  it('never deletes new pages that are not yet indexed', () => {
    const stale = computeStaleUrls(
      ['https://x.com/a'],
      new Set(['https://x.com/a', 'https://x.com/nueva']),
    );
    assert.deepEqual(stale, []);
  });

  it('deletes everything indexed if the origin provides no known URLs', () => {
    const indexed = ['https://x.com/a', 'https://x.com/b'];
    assert.deepEqual(computeStaleUrls(indexed, new Set()), indexed);
  });

  it('distinguishes URLs by exact match', () => {
    const stale = computeStaleUrls(
      ['https://x.com/a/'],
      new Set(['https://x.com/a']),
    );
    assert.deepEqual(stale, ['https://x.com/a/']);
  });
});
