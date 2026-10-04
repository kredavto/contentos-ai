import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthRepository } from '@contentos/db';
import { DomainError, type EmailProvider } from '@contentos/types';
import { createOpaqueToken, hashPassword, hashToken, verifyPassword } from './password';
export const emailSchema = z.email().trim().toLowerCase().max(254);
export const passwordSchema = z.string().min(12).max(128);
export const registerSchema = z.object({ email: emailSchema, name: z.string().trim().min(1).max(120), password: passwordSchema }).strict();
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).strict();
const tokenSchema = z.string().regex(/^[a-zA-Z0-9_-]{43}$/);
const dummyHash = 'scrypt:v1:00000000000000000000000000000000:' + '00'.repeat(64);
export class AuthService {
  constructor(private readonly repository: AuthRepository, private readonly email: EmailProvider, private readonly appUrl: string, private readonly appName: string) {}
  async throttle(action: string, ip: string, email?: string) {
    const allowed = await this.repository.rateLimit(hashToken(`${action}:ip:${ip}`), action === 'onboarding' || action === 'mutation' ? 120 : action === 'login' ? 30 : 15, 900);
    if (!allowed) throw new DomainError('RATE_LIMITED', 429);
    if (email && !await this.repository.rateLimit(hashToken(`${action}:email:${email}`), 8, 900)) throw new DomainError('RATE_LIMITED', 429);
  }
  private async sendToken(email: string, token: string, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD', correlationId: string) {
    const link = new URL(type === 'VERIFY_EMAIL' ? '/verify' : '/reset-password', this.appUrl);
    // Fragment keeps the bearer token out of access logs and Referer headers.
    link.hash = `token=${token}`;
    const id = randomUUID();
    await this.email.send({ recipient: email, subject: `${this.appName}: ${type === 'VERIFY_EMAIL' ? 'подтвердите почту' : 'смена пароля'}`, text: `Откройте ссылку: ${link.toString()}\nЕсли вы не запрашивали это действие, проигнорируйте письмо.` }, {
      internalId: id, tenantId: '', idempotencyKey: id, correlationId, signal: AbortSignal.timeout(10_000),
    });
  }
  async register(raw: unknown, ip: string, correlationId: string) {
    const input = registerSchema.parse(raw);
    await this.throttle('register', ip, input.email);
    const token = createOpaqueToken();
    const user = await this.repository.register({ email: input.email, name: input.name, passwordHash: await hashPassword(input.password), tokenHash: token.hash, correlationId });
    if (user) await this.sendToken(user.email, token.token, 'VERIFY_EMAIL', correlationId);
    return { message: 'Если адрес доступен для регистрации, письмо с подтверждением отправлено. Если вы уже зарегистрированы, войдите или восстановите пароль.' };
  }
  async login(raw: unknown, ip: string, correlationId: string) {
    const input = loginSchema.parse(raw);
    await this.throttle('login', ip, input.email);
    const user = await this.repository.findUser(input.email);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? dummyHash);
    if (!user || !valid || user.disabledAt) throw new DomainError('NOT_AUTHORIZED', 401);
    const token = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600_000);
    if (!await this.repository.createSession(user.id, user.passwordHash, token.hash, expiresAt, correlationId)) throw new DomainError('NOT_AUTHORIZED', 401);
    return { token: token.token, expiresAt };
  }
  async requestToken(raw: unknown, type: 'VERIFY_EMAIL' | 'RESET_PASSWORD', ip: string, correlationId: string) {
    const { email } = z.object({ email: emailSchema }).strict().parse(raw);
    await this.throttle(type, ip, email);
    const user = await this.repository.findUser(email);
    if (user && !user.disabledAt && (type !== 'VERIFY_EMAIL' || !user.emailVerifiedAt)) {
      const token = createOpaqueToken();
      await this.repository.issueToken(user.id, type, token.hash);
      await this.sendToken(email, token.token, type, correlationId);
    }
    return { message: 'Если адрес зарегистрирован и действие доступно, мы отправили письмо.' };
  }
  async verify(raw: unknown, ip: string, correlationId: string) {
    await this.throttle('verify', ip);
    const { token } = z.object({ token: tokenSchema }).strict().parse(raw);
    if (!await this.repository.consumeToken(hashToken(token), 'VERIFY_EMAIL', correlationId)) throw new DomainError('INVALID_INPUT');
    return { message: 'Почта подтверждена. Можно войти.' };
  }
  async reset(raw: unknown, ip: string, correlationId: string) {
    await this.throttle('reset', ip);
    const { token, password } = z.object({ token: tokenSchema, password: passwordSchema }).strict().parse(raw);
    if (!await this.repository.consumeToken(hashToken(token), 'RESET_PASSWORD', correlationId, await hashPassword(password))) throw new DomainError('INVALID_INPUT');
    return { message: 'Пароль изменён. Войдите с новым паролем.' };
  }
  async session(token: string | undefined) {
    if (!token || !tokenSchema.safeParse(token).success) return undefined;
    return this.repository.getSession(hashToken(token));
  }
  async logout(token: string | undefined, correlationId: string) { if (token) await this.repository.logout(hashToken(token), correlationId); }
  async revokeSessions(userId: string, correlationId: string) { await this.repository.revokeSessions(userId, correlationId); }
}
