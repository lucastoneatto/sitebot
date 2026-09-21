import Link from 'next/link';
import { api } from '@/lib/api';
import { createSiteAction } from '@/app/actions';
import { Button, Card, EmptyState, Field, Input, StatusPill } from '@/components/ui';
import { AutoRefresh } from '@/components/CrawlProgress';

export default async function HomePage() {
  let sites: Awaited<ReturnType<typeof api.listSites>> = [];
  let error: string | null = null;

  try {
    sites = await api.listSites();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="space-y-10">
      <Card padding="lg">
        <h1 className="t-h1">New site</h1>
        <p className="t-body mt-1">
          Enter the site's URL. Its sitemap will be discovered and its content indexed to
          build the chatbot.
        </p>
        <form action={createSiteAction} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field id="name" label="Name (optional)" className="sm:w-56">
            {(a) => <Input {...a} name="name" placeholder="My site" />}
          </Field>
          <Field id="url" label="URL" className="min-w-0 flex-1">
            {(a) => <Input {...a} name="url" required placeholder="https://example.com" />}
          </Field>
          <Button type="submit" className="w-full sm:w-auto">Create</Button>
        </form>
      </Card>

      {/* If any site is indexing, the list refreshes itself. */}
      <AutoRefresh active={sites.some((site) => site.status === 'crawling')} />

      <section className="space-y-3">
        <h2 className="t-h2">Sites</h2>

        {error && (
          <p role="alert" className="rounded-control border border-danger-border bg-danger-bg p-3 text-sm text-danger-text">
            Could not connect to the API: {error}
          </p>
        )}

        {!error && sites.length === 0 && (
          <EmptyState title="No sites yet" description="Create the first one with the form above." />
        )}

        {sites.map((site) => (
          <Link
            key={site.id}
            href={`/dashboard/sites/${site.id}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium text-content">{site.name}</div>
              <div className="truncate text-sm text-content-muted">{site.url}</div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs tabular-nums text-content-muted">
                {site.pageCount} pages · {site.chunkCount} chunks
              </span>
              <StatusPill status={site.status} />
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
