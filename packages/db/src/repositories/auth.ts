import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../index';
import { users, sessions, authTokens, auditLogs, rateLimits } from '../schema';
export type AuthTokenType = 'VERIFY_EMAIL' | 'RESET_PASSWORD';
export class AuthRepository {
  constructor(private readonly db: Database) {}
  async rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const [bucket] = await this.db.insert(rateLimits).values({ key, count: 1, resetsAt: new Date(Date.now() + windowSeconds * 1000) })
      .onConflictDoUpdate({ target: rateLimits.key, set: {
        count: sql`case when ${rateLimits.resetsAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
        resetsAt: sql`case when ${rateLimits.resetsAt} <= now() then now() + ${windowSeconds} * interval '1 second' else ${rateLimits.resetsAt} end`,
      } }).returning({ count: rateLimits.count });
    return Boolean(bucket && bucket.count <= limit);
  }
  async findUser(email: string) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }
  async register(input: { email: string; name: string; passwordHash: string; tokenHash: string; correlationId: string }) {
    return this.db.transaction(async tx => {
      const [user] = await tx.insert(users).values({ email: input.email, name: input.name, passwordHash: input.passwordHash }).onConflictDoNothing({ target: users.email }).returning();
      if (!user) return undefined;
      await tx.insert(authTokens).values({ userId: user.id, tokenHash: input.tokenHash, type: 'VERIFY_EMAIL', expiresAt: new Date(Date.now() + 24 * 3600_000) });
      await tx.insert(auditLogs).values({ userId: user.id, action: 'AUTH_REGISTER', resourceId: user.id, correlationId: input.correlationId });
      return user;
    });
  }
  async issueToken(userId: string, type: AuthTokenType, tokenHash: string) {
    await this.db.transaction(async tx => {
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.disabledAt))).for('update');
      if (!user) return;
      await tx.update(authTokens).set({ consumedAt: new Date() }).where(and(eq(authTokens.userId, userId), eq(authTokens.type, type), isNull(authTokens.consumedAt)));
      await tx.insert(authTokens).values({ userId, type, tokenHash, expiresAt: new Date(Date.now() + (type === 'VERIFY_EMAIL' ? 24 * 3600_000 : 30 * 60_000)) });
    });
  }
  async consumeToken(tokenHash: string, type: AuthTokenType, correlationId: string, passwordHash?: string) {
    return this.db.transaction(async tx => {
      // User lock serializes token consumption with session issuance and password reset.
      const [candidate] = await tx.select({ userId: authTokens.userId }).from(authTokens).where(eq(authTokens.tokenHash, tokenHash));
      if (!candidate) return false;
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, candidate.userId), isNull(users.disabledAt))).for('update');
      if (!user) return false;
      const [token] = await tx.update(authTokens).set({ consumedAt: new Date() }).where(and(
        eq(authTokens.tokenHash, tokenHash), eq(authTokens.type, type), isNull(authTokens.consumedAt), gt(authTokens.expiresAt, new Date()),
      )).returning();
      if (!token) return false;
      if (type === 'RESET_PASSWORD') {
        if (!passwordHash) throw new Error('Password hash required');
        await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
        await tx.delete(sessions).where(eq(sessions.userId, user.id));
        await tx.update(authTokens).set({ consumedAt: new Date() }).where(and(eq(authTokens.userId, user.id), eq(authTokens.type, type), isNull(authTokens.consumedAt)));
      } else await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
      await tx.insert(auditLogs).values({ userId: user.id, action: type === 'RESET_PASSWORD' ? 'AUTH_PASSWORD_RESET' : 'AUTH_EMAIL_VERIFIED', correlationId });
      return true;
    });
  }
  async createSession(userId: string, expectedPasswordHash: string, tokenHash: string, expiresAt: Date, correlationId: string) {
    return this.db.transaction(async tx => {
      const [user] = await tx.select().from(users).where(and(eq(users.id, userId), isNull(users.disabledAt))).for('update');
      if (!user || user.passwordHash !== expectedPasswordHash) return false;
      await tx.insert(sessions).values({ userId, tokenHash, expiresAt });
      await tx.insert(auditLogs).values({ userId, action: 'AUTH_LOGIN', correlationId });
      return true;
    });
  }
  async getSession(tokenHash: string) {
    const [session] = await this.db.select({ id: sessions.id, userId: users.id, name: users.name, email: users.email, emailVerifiedAt: users.emailVerifiedAt })
      .from(sessions).innerJoin(users, eq(users.id, sessions.userId)).where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt))).limit(1);
    return session;
  }
  async logout(tokenHash: string, correlationId: string) {
    await this.db.transaction(async tx => {
      const [session] = await tx.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).returning();
      if (session) await tx.insert(auditLogs).values({ userId: session.userId, action: 'AUTH_LOGOUT', correlationId });
    });
  }
  async revokeSessions(userId: string, correlationId: string) {
    await this.db.transaction(async tx => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await tx.insert(auditLogs).values({ userId, action: 'AUTH_SESSIONS_REVOKED', correlationId });
    });
  }
}
