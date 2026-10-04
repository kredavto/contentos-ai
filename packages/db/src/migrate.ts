import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './index';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const database = createDatabase(url);
try { await migrate(database.db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) }); }
finally { await database.close(); }
