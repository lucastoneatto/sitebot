import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/db.module';
import { sites, users } from '../db/schema';

/** First day of the current month, at midnight. */
function startOfMonth(): Date {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

@Injectable()
export class AdminService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Spend and volume for the current month, to watch the margin at a glance. */
  async overview() {
    const since = startOfMonth();

    const result = await this.db.execute(sql`
      select
        (select count(*)::int from ${users}) as users,
        (select count(*)::int from ${sites}) as sites,
        (select count(*)::int from ${sites} where status = 'error') as sites_error,
        (select count(*)::int from ${sites} where status = 'crawling') as sites_crawling,
        (select coalesce(sum(cost), 0)::float8
           from usage_events where created_at >= ${since}) as cost,
        (select count(*)::int
           from messages m
           join chat_sessions s on s.id = m.session_id
          where m.role = 'assistant' and m.created_at >= ${since}) as messages
    `);

    const row = (result.rows[0] ?? {}) as Record<string, number>;
    return {
      users: row.users ?? 0,
      sites: row.sites ?? 0,
      sitesError: row.sites_error ?? 0,
      sitesCrawling: row.sites_crawling ?? 0,
      monthlyCost: row.cost ?? 0,
      monthlyMessages: row.messages ?? 0,
    };
  }

  async listUsers() {
    const result = await this.db.execute(sql`
      select
        u.id, u.email, u.plan, u.created_at as "createdAt",
        (select count(*)::int from ${sites} s where s.user_id = u.id) as "siteCount",
        coalesce((
          select sum(e.cost)::float8
            from usage_events e
            join ${sites} s on s.id = e.site_id
           where s.user_id = u.id and e.created_at >= ${startOfMonth()}
        ), 0) as "monthlyCost"
      from ${users} u
      order by u.created_at desc
    `);
    return result.rows;
  }

  async setPlan(userId: string, plan: 'free' | 'paid') {
    const [updated] = await this.db
      .update(users)
      .set({ plan })
      .where(eq(users.id, userId))
      .returning({ id: users.id, email: users.email, plan: users.plan });
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  /** All sites on the platform with their usage and their quotas. */
  async listSites() {
    const result = await this.db.execute(sql`
      select
        s.id, s.name, s.url, s.status, s.user_id as "userId",
        u.email as "ownerEmail", u.plan as "ownerPlan",
        s.monthly_message_limit as "monthlyMessageLimit",
        s.monthly_budget_usd as "monthlyBudgetUsd",
        s.auto_sync as "autoSync",
        s.last_crawled_at as "lastCrawledAt",
        coalesce((
          select sum(e.cost)::float8 from usage_events e
           where e.site_id = s.id and e.created_at >= ${startOfMonth()}
        ), 0) as "monthlyCost",
        coalesce((
          select count(*)::int
            from messages m
            join chat_sessions cs on cs.id = m.session_id
           where cs.site_id = s.id and m.role = 'assistant'
             and m.created_at >= ${startOfMonth()}
        ), 0) as "monthlyMessages"
      from ${sites} s
      join ${users} u on u.id = s.user_id
      order by "monthlyCost" desc, s.created_at desc
    `);
    return result.rows;
  }

  async setQuota(
    siteId: string,
    quota: { monthlyMessageLimit?: number | null; monthlyBudgetUsd?: number | null },
  ) {
    const patch: Record<string, number | null> = {};
    if (quota.monthlyMessageLimit !== undefined) {
      patch.monthlyMessageLimit = quota.monthlyMessageLimit;
    }
    if (quota.monthlyBudgetUsd !== undefined) {
      patch.monthlyBudgetUsd = quota.monthlyBudgetUsd;
    }

    const [updated] = await this.db
      .update(sites)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(sites.id, siteId))
      .returning({
        id: sites.id,
        monthlyMessageLimit: sites.monthlyMessageLimit,
        monthlyBudgetUsd: sites.monthlyBudgetUsd,
      });
    if (!updated) throw new NotFoundException('Site not found');
    return updated;
  }
}
