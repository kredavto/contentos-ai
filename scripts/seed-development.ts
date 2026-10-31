import { createDatabase } from '../packages/db/src/index';
import { seedDevelopment, validateSeedEnvironment } from '../packages/db/src/development-seed';
import { hashPassword } from '../packages/core/src/password';

async function main() {
  const { url, password } = validateSeedEnvironment(process.env);
  const passwordHash = await hashPassword(password);
  const database = createDatabase(url);
  try {
    const result = await seedDevelopment(database.db, passwordHash);
    console.log(JSON.stringify({ created: result.created, email: result.email, brandId: result.brand, message: result.created ? 'Local demonstration data created. No external providers called.' : 'Seed already exists; account and edited data were preserved.' }));
  } finally { await database.close(); }
}
void main().catch(() => {
  // Database errors may contain connection strings or query parameters; do not dump them.
  console.error('Development seed failed. Check local database, migrations, opt-in and password settings. Existing account/ID conflicts are never overwritten.');
  process.exitCode = 1;
});
