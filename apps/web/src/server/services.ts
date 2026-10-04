import { AuthService, BrandService } from '@contentos/core';
import { AuthRepository, BrandRepository, createDatabase } from '@contentos/db';
import { parseServerEnvironment } from '@contentos/config';
import { SmtpEmailProvider, UnconfiguredEmailProvider } from '@contentos/providers';
import { DomainError } from '@contentos/types';
function createServices() {
  let env;
  try { env = parseServerEnvironment(process.env); } catch { throw new DomainError('CONFIGURATION_REQUIRED', 503); }
  const { db } = createDatabase(env.DATABASE_URL);
  const email = env.SMTP_URL && env.EMAIL_FROM ? new SmtpEmailProvider(env.SMTP_URL, env.EMAIL_FROM, env.NODE_ENV === 'production') : new UnconfiguredEmailProvider();
  return { env, auth: new AuthService(new AuthRepository(db), email, env.APP_URL, env.APP_NAME), brands: new BrandService(new BrandRepository(db)) };
}
const globalServices = globalThis as typeof globalThis & { contentosServices?: ReturnType<typeof createServices> };
export function services() { return globalServices.contentosServices ??= createServices(); }
export const sessionCookie = 'contentos_session';
