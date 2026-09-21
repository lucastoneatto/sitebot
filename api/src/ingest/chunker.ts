export function chunkMarkdown(
  markdown: string,
  maxChars = 3200,
  overlap = 400,
): string[] {
  const text = markdown.trim();
  if (!text) return [];

  const blocks = text.split(/\n(?=#{1,6}\s)/g);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = '';
  };

  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > maxChars && current) {
      flush();
    }

    if (block.length > maxChars) {
      let start = 0;
      while (start < block.length) {
        const end = Math.min(start + maxChars, block.length);
        chunks.push(block.slice(start, end).trim());
        if (end >= block.length) break;
        start = end - overlap;
      }
      continue;
    }

    current = current ? `${current}\n\n${block}` : block;
  }

  flush();
  return chunks.filter((chunk) => chunk.replace(/^#+\s*/, '').trim().length > 40);
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
