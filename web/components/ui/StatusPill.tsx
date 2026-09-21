import type { SiteStatus } from '@/lib/api';
import { Badge, type BadgeTone } from './Badge';

/**
 * Used to live duplicated: dashboard/page.tsx had STATUS_LABELS/STATUS_STYLES,
 * sites/[id]/page.tsx repeated STATUS_LABELS, and admin/users/page.tsx had
 * its own inline map for the user's plan. This component is the single
 * source of truth for a site's status.
 */
const LABELS: Record<SiteStatus, string> = {
  pending: 'Pending',
  crawling: 'Crawling',
  ready: 'Ready',
  error: 'Error',
};

const TONES: Record<SiteStatus, BadgeTone> = {
  pending: 'neutral',
  crawling: 'warning',
  ready: 'success',
  error: 'danger',
};

export function StatusPill({ status }: { status: SiteStatus }) {
  return <Badge tone={TONES[status]}>{LABELS[status]}</Badge>;
}
