function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    return (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[
        c as '&' | '<' | '>' | '"' | "'"
      ]
    );
  });
}

export type MessageSource = { url: string; title?: string | null; score?: number };

function labelForUrl(url: string, sources?: MessageSource[]): string {
  if (sources) {
    const source = sources.find((item) => item.url === url);
    if (source?.title) return source.title;
  }
  return 'ver enlace';
}

function renderInline(text: string, sources?: MessageSource[]): string {
  let value = text.replace(/^([ \t]*)- (?=\S)/gm, '$1• ');
  let out = '';
  let i = 0;

  while (i < value.length) {
    const rest = value.slice(i);
    let match: RegExpExecArray | null;

    if ((match = /^\*\*([^*\n]+)\*\*/.exec(rest))) {
      out += `<strong>${renderInline(match[1], sources)}</strong>`;
      i += match[0].length;
    } else if ((match = /^\*([^*\n]+)\*/.exec(rest))) {
      out += `<em>${renderInline(match[1], sources)}</em>`;
      i += match[0].length;
    } else if ((match = /^https?:\/\/[^\s<]+/.exec(rest))) {
      const url = match[0].replace(/[.,;:!?)\]]+$/, '');
      out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(
        labelForUrl(url, sources),
      )}</a>`;
      i += match[0].length;
    } else {
      const next = rest.search(/[*]|https?:\/\//);
      const end = next === -1 ? rest.length : next;
      out += escapeHtml(rest.slice(0, end));
      i += end;
    }
  }

  return out;
}

type Part = { text: string } | { label: string; url: string };

export function renderMessage(
  text: string,
  sources?: MessageSource[],
): string {
  const parts: Part[] = [];
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ label: match[1], url: match[2] });
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });

  return parts
    .map((part) => {
      if ('url' in part) {
        return `<a href="${escapeHtml(part.url)}" target="_blank" rel="noopener">${escapeHtml(
          part.label,
        )}</a>`;
      }
      return renderInline(part.text, sources);
    })
    .join('');
}
