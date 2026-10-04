import { sql } from 'drizzle-orm';
import { check, pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull(), resetsAt: timestamp('resets_at', { withTimezone: true }).notNull(),
}, t => [check('rate_limits_count_positive', sql`${t.count} > 0`)]);
