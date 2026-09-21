import { adminCrawlAction, setQuotaAction } from '@/app/actions';
import { adminApi, type AdminSite } from '@/lib/api';
import { money } from '@/lib/format';
import { Alert, Button, Card, CardTitle, EmptyState, Field, Input } from '@/components/ui';

/** A site is flagged red if it has no spending cap at all. */
function isUnbounded(site: AdminSite) {
  return site.monthlyMessageLimit === null && site.monthlyBudgetUsd === null;
}

function usageLabel(site: AdminSite) {
  const parts = [`${site.monthlyMessages} msg`, money(site.monthlyCost)];
  if (site.monthlyMessageLimit !== null) {
    parts[0] = `${site.monthlyMessages}/${site.monthlyMessageLimit} msg`;
  }
  if (site.monthlyBudgetUsd !== null) {
    parts[1] = `${money(site.monthlyCost)} / $${site.monthlyBudgetUsd}`;
  }
  return parts.join(' · ');
}

export default async function AdminSitesPage() {
  let sites: AdminSite[] = [];
  let error: string | null = null;

  try {
    sites = await adminApi.sites();
  } catch (e) {
    error = (e as Error).message;
  }

  if (error) {
    return <Alert tone="danger">Could not load sites: {error}</Alert>;
  }

  const unbounded = sites.filter(isUnbounded).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Quotas by site</CardTitle>
        <p className="t-body mt-1">
          Leave a field empty to not apply that limit. Once reached, the widget
          stops responding and shows a notice. Sorted by spend this month.
        </p>
        {unbounded > 0 && (
          <Alert tone="warning" className="mt-3">
            {unbounded} {unbounded === 1 ? 'site has' : 'sites have'} no
            limit at all: they can spend without a cap.
          </Alert>
        )}
      </Card>

      {sites.length === 0 ? (
        <EmptyState title="No sites on the platform yet." />
      ) : (
        <div className="space-y-3">
          {sites.map((site) => (
            <Card
              key={site.id}
              className={isUnbounded(site) ? 'border-warning-border' : undefined}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-content">{site.name}</p>
                  <p className="truncate text-sm text-content-muted">{site.url}</p>
                  <p className="mt-1 text-xs text-content-muted">
                    {site.ownerEmail} · plan {site.ownerPlan} · {site.status}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-medium tabular-nums text-content">
                    {usageLabel(site)}
                  </p>
                  <p className="text-xs text-content-muted">usage this month</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <form action={setQuotaAction} className="flex w-full flex-wrap items-end gap-3 sm:w-auto">
                  <input type="hidden" name="siteId" value={site.id} />
                  <Field id={`monthlyMessageLimit-${site.id}`} label="Max messages/month" className="min-w-0 flex-1 sm:w-36 sm:flex-none">
                    {(a) => (
                      <Input
                        {...a}
                        name="monthlyMessageLimit"
                        type="number"
                        min="0"
                        placeholder="no limit"
                        defaultValue={site.monthlyMessageLimit ?? ''}
                      />
                    )}
                  </Field>
                  <Field id={`monthlyBudgetUsd-${site.id}`} label="Max spend/month (USD)" className="min-w-0 flex-1 sm:w-36 sm:flex-none">
                    {(a) => (
                      <Input
                        {...a}
                        name="monthlyBudgetUsd"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="no limit"
                        defaultValue={site.monthlyBudgetUsd ?? ''}
                      />
                    )}
                  </Field>
                  <Button type="submit" size="sm">
                    Save
                  </Button>
                </form>

                <form action={adminCrawlAction}>
                  <input type="hidden" name="siteId" value={site.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    Relaunch crawl
                  </Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
