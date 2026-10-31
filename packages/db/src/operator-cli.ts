import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDatabase } from './index';
import { users, platformOperators, auditLogs } from './schema';
async function main() {
const args = process.argv.slice(2);
const options: Record<string, string> = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index], value = args[index + 1];
  if (!key?.startsWith('--') || !value || options[key.slice(2)] !== undefined) throw new Error('Use --mode grant|revoke --userId UUID --role SUPPORT|ADMIN --ticket OPS-123');
  options[key.slice(2)] = value;
}
const input = z.object({ mode: z.enum(['grant', 'revoke']), userId: z.uuid(), role: z.enum(['SUPPORT', 'ADMIN']), ticket: z.string().regex(/^[A-Za-z0-9_-]{3,80}$/) }).strict().parse(options);
let resultingRole = input.role;
const database = createDatabase(z.string().min(1).parse(process.env.DATABASE_URL));
try {
  await database.db.transaction(async tx => {
    const [user] = await tx.select({ id: users.id, verifiedAt: users.emailVerifiedAt, disabledAt: users.disabledAt }).from(users).where(eq(users.id, input.userId)).for('update');
    if (!user || (input.mode === 'grant' && (!user.verifiedAt || user.disabledAt))) throw new Error('Grant requires an existing enabled, verified account');
    const [existing] = await tx.select({ role: platformOperators.role }).from(platformOperators).where(eq(platformOperators.userId, input.userId)).for('update');
    if (input.mode === 'revoke' && existing) resultingRole = existing.role;
    if (input.mode === 'revoke' && !existing) throw new Error('Operator not found');
    if (input.mode === 'grant') await tx.insert(platformOperators).values({ userId: input.userId, role: resultingRole }).onConflictDoUpdate({ target: platformOperators.userId, set: { role: input.role, revokedAt: null } });
    else await tx.update(platformOperators).set({ revokedAt: new Date() }).where(eq(platformOperators.userId, input.userId));
    await tx.insert(auditLogs).values({ action: input.mode === 'grant' ? 'PLATFORM_OPERATOR_GRANTED' : 'PLATFORM_OPERATOR_REVOKED', resourceId: input.userId, correlationId: randomUUID(), metadata: { role: input.mode === 'grant' ? input.role : existing!.role, ticket: input.ticket, actor: 'HOST_OPERATOR' } });
  });
  process.stdout.write(JSON.stringify({ operation: input.mode, userId: input.userId, role: resultingRole }) + '\n');
} finally { await database.close(); }

}
try { await main(); } catch { process.stderr.write('Operator provisioning failed. Check arguments, account status and database access.\n'); process.exitCode = 1; }
