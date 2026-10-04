import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
export * from './schema';
export function createDatabase(url: string) {
  const client = postgres(url, { max: 5, prepare: false, idle_timeout: 20, connect_timeout: 10 });
  return { client, db: drizzle(client, { schema }), close: () => client.end() };
}
export type Database = ReturnType<typeof createDatabase>['db'];
export * from './repositories/auth';
export * from './repositories/brands';
