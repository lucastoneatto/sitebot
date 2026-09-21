import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkMarkdown, estimateTokens } from '../src/ingest/chunker';

describe('chunkMarkdown', () => {
  it('returns empty for empty or blank input', () => {
    assert.deepEqual(chunkMarkdown(''), []);
    assert.deepEqual(chunkMarkdown('   \n\n  '), []);
  });

  it('discards fragments too short to provide context', () => {
    assert.deepEqual(chunkMarkdown('# Título\n\nHola.'), []);
  });

  it('keeps content that fits within maxChars in a single chunk', () => {
    const markdown = `# Guía\n\n${'contenido útil '.repeat(20)}`;
    const chunks = chunkMarkdown(markdown, 3200, 400);
    assert.equal(chunks.length, 1);
    assert.match(chunks[0], /^# Guía/);
  });

  it('splits by headings when maxChars is exceeded', () => {
    const body = 'texto de relleno '.repeat(30); // ~510 chars
    const markdown = `# Uno\n\n${body}\n# Dos\n\n${body}\n# Tres\n\n${body}`;
    const chunks = chunkMarkdown(markdown, 600, 50);

    assert.ok(chunks.length >= 3, `expected >=3 chunks, got ${chunks.length}`);
    // Each chunk starts at a heading: it's never split mid-section.
    for (const chunk of chunks) assert.match(chunk, /^#/);
  });

  it('splits with overlap a single block larger than maxChars', () => {
    const long = 'a'.repeat(1000);
    const chunks = chunkMarkdown(`# H\n\n${long}`, 300, 100);

    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.length <= 300);
    // The overlap makes the total exceed the original length.
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    assert.ok(total > long.length);
  });

  it('does not lose content when splitting (with overlap, covers all the text)', () => {
    const long = Array.from({ length: 400 }, (_, i) => `p${i}`).join(' ');
    const chunks = chunkMarkdown(`# H\n\n${long}`, 300, 100);
    const joined = chunks.join('');
    for (const marker of ['p0', 'p200', 'p399']) {
      assert.ok(joined.includes(marker), `missing ${marker}`);
    }
  });
});

describe('estimateTokens', () => {
  it('approximates 4 characters per token, rounding up', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
  });
});
