'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PageItem } from '@/lib/api';

type Status = 'idle' | 'loading' | 'error';

function formatDate(value: string) {
  return new Date(value).toLocaleString('en', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * Table row + detail modal. The <dialog> is portaled to document.body: HTML
 * doesn't allow a <dialog> inside <tr>/<tbody>, so it can't be nested in the
 * row's tree even though React mounts it "from" here.
 */
export function PageRow({ page, siteId }: { page: PageItem; siteId: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  async function openModal() {
    // The <dialog> only exists in the DOM after the first render with
    // mounted=true; showModal() fires on the next tick via an effect-like
    // callback ref, so we do it with a microtask after the setState.
    setMounted(true);
    queueMicrotask(() => dialogRef.current?.showModal());

    if (markdown !== null || status === 'loading') return;
    setStatus('loading');
    try {
      const res = await fetch(`/api/sites/${siteId}/pages/${page.id}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { markdown: string };
      setMarkdown(data.markdown);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  const modal = mounted
    ? createPortal(
        <dialog
          ref={dialogRef}
          onClose={() => setMounted(false)}
          onClick={(e) => {
            if (e.target === dialogRef.current) dialogRef.current?.close();
          }}
          className="m-auto max-h-[85vh] w-full max-w-2xl rounded-card border border-line bg-surface p-0 text-content shadow-xl backdrop:bg-inverse/60"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line p-4">
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-content">
                {page.title ?? page.url}
              </h3>
              <a
                href={page.url}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 block truncate text-xs text-content-muted hover:underline"
              >
                {page.url}
              </a>
              <p className="mt-0.5 text-xs text-content-subtle">
                Crawled on {formatDate(page.crawledAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="shrink-0 rounded-control p-1 text-content-muted hover:bg-elevated hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ✕
            </button>
          </div>

          <div className="max-h-[65vh] overflow-auto p-4">
            {status === 'loading' && (
              <p className="text-sm text-content-muted">Loading content…</p>
            )}
            {status === 'error' && (
              <p className="text-sm text-danger-solid">
                Could not load this page's content.
              </p>
            )}
            {status === 'idle' && markdown !== null && (
              <pre className="whitespace-pre-wrap rounded-control bg-canvas p-3 text-xs text-content-secondary">
                {markdown}
              </pre>
            )}
          </div>
        </dialog>,
        document.body,
      )
    : null;

  return (
    <>
      <tr className="border-b border-line-subtle last:border-0">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={openModal}
            className="line-clamp-1 text-left font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            {page.title ?? page.url}
          </button>
        </td>
        <td className="max-w-xs truncate px-4 py-3 text-content-muted">{page.url}</td>
      </tr>
      {modal}
    </>
  );
}
