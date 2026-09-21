import { notFound } from 'next/navigation';
import { api, PUBLIC_API_URL } from '@/lib/api';
import { regenerateSummaryAction } from '@/app/actions';
import { WidgetEmbed } from '@/components/WidgetEmbed';
import { Badge, Button, PageHeader } from '@/components/ui';

export default async function LandingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let detail: Awaited<ReturnType<typeof api.getSite>>;
  try {
    detail = await api.getSite(id);
  } catch {
    notFound();
  }

  const { site } = detail;
  // Same as the widget's default value (api/src/public/widget.js): it's
  // the CLIENT'S brand color, not the Sitebot app's accent.
  const color = site.settings.color || '#4f46e5';
  const hasContent = detail.stats.pageCount > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: `/dashboard/sites/${site.id}`, label: site.name }}
        actions={
          <>
            <Badge>Landing preview</Badge>
            <form action={regenerateSummaryAction}>
              <input type="hidden" name="id" value={site.id} />
              <Button type="submit" variant="secondary" size="sm" disabled={!hasContent}>
                Regenerate summary
              </Button>
            </form>
          </>
        }
      />

      <article className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div
          className="px-8 py-14 text-white"
          style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
        >
          <div className="mx-auto max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-widest text-white/70">
              {site.domain}
            </p>
            <h1 className="mt-2 text-4xl font-bold tracking-tight">{site.name}</h1>
            <a
              href={site.url}
              target="_blank"
              rel="noopener"
              className="mt-2 inline-block text-sm text-white/80 underline"
            >
              {site.url}
            </a>
          </div>
        </div>

        <div className="mx-auto max-w-2xl px-8 py-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-content-subtle">
            Summary
          </h2>

          {site.summary ? (
            <p className="mt-3 text-lg leading-relaxed text-content-secondary">{site.summary}</p>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-content-muted">
                {hasContent
                  ? 'No summary yet. Generate it with the "Regenerate summary" button.'
                  : 'The site hasn\'t been crawled yet. Run "Crawl site" first.'}
              </p>
              {hasContent && (
                <form action={regenerateSummaryAction}>
                  <input type="hidden" name="id" value={site.id} />
                  <button
                    type="submit"
                    className="rounded-control px-4 py-2 text-sm font-medium text-white"
                    style={{ backgroundColor: color }}
                  >
                    Generate summary
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={site.url}
              target="_blank"
              rel="noopener"
              className="rounded-control px-5 py-2.5 text-sm font-medium text-white"
              style={{ backgroundColor: color }}
            >
              Visit the site
            </a>
            <button
              type="button"
              className="rounded-control border border-line-strong px-5 py-2.5 text-sm font-medium text-content-secondary"
            >
              Learn more
            </button>
          </div>

          <p className="mt-8 text-xs text-content-subtle">
            {detail.stats.pageCount} pages · {detail.stats.chunkCount} chunks indexed.
            The chatbot is shown in the bottom right.
          </p>
        </div>
      </article>

      <WidgetEmbed
        siteId={site.id}
        apiUrl={PUBLIC_API_URL}
        color={color}
        greeting={site.settings.greeting}
        title={site.name}
      />
    </div>
  );
}
