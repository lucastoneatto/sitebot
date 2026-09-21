import { notFound } from 'next/navigation';
import Link from 'next/link';
import { api, embedSnippet, PUBLIC_API_URL } from '@/lib/api';
import {
  crawlSiteAction,
  deleteSiteAction,
  updateSettingsAction,
} from '@/app/actions';
import { ChatPlayground } from '@/components/ChatPlayground';
import { CopyButton } from '@/components/CopyButton';
import { CrawlProgress } from '@/components/CrawlProgress';
import { PageRow } from '@/components/PageDetailModal';
import {
  Alert,
  Button,
  Card,
  CardTitle,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Stat,
  StatusPill,
  TBody,
  TH,
  THead,
  Table,
  Textarea,
} from '@/components/ui';

const PAGES_PER_PAGE = 15;

/**
 * Deliberately different from money() in lib/format.ts: here trailing zeros
 * are trimmed and exact zero shows as "$0.00", while money() always gives 4
 * fixed decimals. These are legitimately different formats: don't unify
 * them without deciding to, or the on-screen amounts would suddenly change.
 */
function formatUsd(value: number): string {
  if (!value || value === 0) return '$0.00';
  const trimmed = value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `$${trimmed}`;
}

export default async function SitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page: pageParam } = await searchParams;
  const currentPage = Math.max(1, Number(pageParam) || 1);
  const offset = (currentPage - 1) * PAGES_PER_PAGE;

  let detail: Awaited<ReturnType<typeof api.getSite>>;
  let pageList: Awaited<ReturnType<typeof api.listPages>>;
  try {
    [detail, pageList] = await Promise.all([
      api.getSite(id),
      api.listPages(id, offset, PAGES_PER_PAGE),
    ]);
  } catch {
    notFound();
  }

  const totalPages = Math.max(1, Math.ceil(pageList.total / PAGES_PER_PAGE));

  const { site, job, stats, usage } = detail;
  const snippet = embedSnippet(site.id);

  return (
    <div className="space-y-10">
      <PageHeader
        back={{ href: '/dashboard', label: 'Sites' }}
        title={site.name}
        description={site.url}
        actions={
          <>
            <StatusPill status={site.status} />
            <LinkButton href={`/dashboard/sites/${site.id}/landing`} variant="secondary">
              View landing
            </LinkButton>
            <form action={crawlSiteAction}>
              <input type="hidden" name="id" value={site.id} />
              <Button type="submit" disabled={site.status === 'crawling'}>
                {site.status === 'crawling' ? 'Crawling...' : 'Crawl site'}
              </Button>
            </form>
            <form action={deleteSiteAction}>
              <input type="hidden" name="id" value={site.id} />
              <Button type="submit" variant="danger">
                Delete
              </Button>
            </form>
          </>
        }
      />

      <CrawlProgress
        status={site.status}
        pagesCrawled={job?.pagesCrawled ?? 0}
        pagesFound={job?.pagesFound ?? 0}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card padding="sm">
          <Stat label="Pages" value={String(stats.pageCount)} />
        </Card>
        <Card padding="sm">
          <Stat label="Indexed chunks" value={String(stats.chunkCount)} />
        </Card>
        <Card padding="sm">
          <Stat label="Messages" value={String(stats.messageCount)} />
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>AI spend</CardTitle>
          <span className="text-sm font-semibold tabular-nums text-content">
            {formatUsd(usage.total)}
          </span>
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <dt className="text-content-muted">Indexing (embeddings)</dt>
            <dd className="tabular-nums sm:text-right">
              {formatUsd(usage.indexing.cost)} · {usage.indexing.pages} pages ·{' '}
              <span className="text-content-muted">
                ~{formatUsd(usage.avgPerPage)}/page
              </span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <dt className="text-content-muted">Chat</dt>
            <dd className="tabular-nums sm:text-right">
              {formatUsd(usage.chat.cost)} · {usage.chat.messages} messages ·{' '}
              <span className="text-content-muted">
                ~{formatUsd(usage.avgPerMessage)}/message
              </span>
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <dt className="text-content-muted">Summaries</dt>
            <dd className="tabular-nums sm:text-right">
              {formatUsd(usage.summary.cost)} · {usage.summary.generations}{' '}
              generations
            </dd>
          </div>
        </dl>

        {(site.monthlyMessageLimit !== null ||
          site.monthlyBudgetUsd !== null) && (
          <p className="mt-3 border-t border-line pt-3 text-xs tabular-nums text-content-muted">
            Site plan:{' '}
            {site.monthlyMessageLimit !== null && (
              <>{site.monthlyMessageLimit.toLocaleString('en')} messages/month</>
            )}
            {site.monthlyMessageLimit !== null &&
              site.monthlyBudgetUsd !== null &&
              ' · '}
            {site.monthlyBudgetUsd !== null && (
              <>cap of ${site.monthlyBudgetUsd}/month</>
            )}
            . To raise it, contact your administrator.
          </p>
        )}

        <a
          href={`/dashboard/sites/${site.id}/conversations`}
          className="mt-3 inline-block text-sm text-accent hover:underline"
        >
          View conversations and analytics →
        </a>
      </Card>

      {job && (
        <Card padding="sm" className="text-sm">
          <div className="font-medium text-content">Last crawl</div>
          <div className="mt-1 text-content-secondary">
            Status: {job.status} · {job.pagesCrawled}/{job.pagesFound} pages
          </div>
          {job.error && <Alert tone="danger" className="mt-2">{job.error}</Alert>}
        </Card>
      )}

      <Card>
        <CardTitle>1. Paste this script on your site</CardTitle>
        <p className="t-body mt-1">
          Add the snippet before <code>&lt;/body&gt;</code>. The widget will appear
          automatically.
        </p>
        <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row">
          {/* min-w-0 so the <pre> can shrink and trigger its own horizontal
              scroll instead of stretching the flex row. */}
          <pre className="w-full min-w-0 flex-1 overflow-x-auto rounded-control bg-inverse p-3 text-xs text-content-inverse">
            {snippet}
          </pre>
          <CopyButton value={snippet} />
        </div>
      </Card>

      <Card>
        <CardTitle>2. Test the chatbot</CardTitle>
        <div className="mt-3">
          <ChatPlayground
            siteId={site.id}
            apiUrl={PUBLIC_API_URL}
            greeting={site.settings.greeting}
            color={site.settings.color}
          />
        </div>
      </Card>

      <Card>
        <CardTitle>3. Settings</CardTitle>
        <form action={updateSettingsAction} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={site.id} />

          <Field id="name" label="Name">
            {(a) => <Input {...a} name="name" defaultValue={site.name} />}
          </Field>

          <Field id="color" label="Color">
            {(a) => (
              <input
                {...a}
                name="color"
                type="color"
                defaultValue={site.settings.color}
                className="h-[38px] w-full rounded-control border border-line-strong px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              />
            )}
          </Field>

          <Field id="greeting" label="Greeting">
            {(a) => <Input {...a} name="greeting" defaultValue={site.settings.greeting} />}
          </Field>

          <Field id="temperature" label="Temperature">
            {(a) => (
              <Input
                {...a}
                name="temperature"
                type="number"
                step="0.1"
                min="0"
                max="1"
                defaultValue={site.settings.temperature}
              />
            )}
          </Field>

          <Field id="maxPages" label="Maximum pages">
            {(a) => (
              <Input
                {...a}
                name="maxPages"
                type="number"
                min="1"
                max="500"
                defaultValue={site.settings.maxPages ?? 20}
              />
            )}
          </Field>

          <Field id="maxDepth" label="Depth (link levels)">
            {(a) => (
              <Input
                {...a}
                name="maxDepth"
                type="number"
                min="0"
                max="10"
                defaultValue={site.settings.maxDepth ?? 2}
              />
            )}
          </Field>

          <Field
            id="customPrompt"
            label="Bot personality (optional)"
            hint="Added to the base instructions. It cannot bypass the safety rules or make up information outside the indexed content."
            className="sm:col-span-2"
          >
            {(a) => (
              <Textarea
                {...a}
                name="customPrompt"
                rows={4}
                placeholder="E.g.: You are the onboarding assistant. Speak informally to the user, be brief, and end by offering the next step."
                defaultValue={site.settings.customPrompt ?? ''}
              />
            )}
          </Field>

          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="autoSync"
              defaultChecked={site.autoSync}
              className="mt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            />
            <span>
              Automatically re-scan the site
              <span className="mt-0.5 block text-xs text-content-muted">
                Keeps the bot up to date when the content changes.
              </span>
            </span>
          </label>

          <Field id="syncIntervalHours" label="Re-scan frequency (hours)">
            {(a) => (
              <Input
                {...a}
                name="syncIntervalHours"
                type="number"
                min="1"
                max="720"
                defaultValue={site.syncIntervalHours ?? 24}
              />
            )}
          </Field>

          <Field
            id="allowedOrigins"
            label="Allowed origins (one per line)"
            className="sm:col-span-2"
          >
            {(a) => (
              <Textarea
                {...a}
                name="allowedOrigins"
                rows={3}
                defaultValue={site.allowedOrigins.join('\n')}
                className="font-mono text-xs"
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <Button type="submit">Save settings</Button>
          </div>
        </form>
      </Card>

      <section className="space-y-3">
        <h2 className="t-h2">Indexed pages ({pageList.total})</h2>

        {pageList.items.length === 0 ? (
          <EmptyState
            title="No pages yet."
            description='Run "Crawl site" to start indexing content.'
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Title</TH>
                  <TH>URL</TH>
                </tr>
              </THead>
              <TBody>
                {pageList.items.map((page) => (
                  <PageRow key={page.id} page={page} siteId={site.id} />
                ))}
              </TBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-content-muted">
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/sites/${site.id}?page=${currentPage - 1}`}
                    scroll={false}
                    aria-disabled={currentPage <= 1}
                    className={
                      currentPage <= 1
                        ? 'pointer-events-none rounded-control border border-line px-3 py-1.5 text-content-subtle'
                        : 'rounded-control border border-line-strong px-3 py-1.5 hover:bg-elevated'
                    }
                  >
                    ← Previous
                  </Link>
                  <Link
                    href={`/dashboard/sites/${site.id}?page=${currentPage + 1}`}
                    scroll={false}
                    aria-disabled={currentPage >= totalPages}
                    className={
                      currentPage >= totalPages
                        ? 'pointer-events-none rounded-control border border-line px-3 py-1.5 text-content-subtle'
                        : 'rounded-control border border-line-strong px-3 py-1.5 hover:bg-elevated'
                    }
                  >
                    Next →
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
